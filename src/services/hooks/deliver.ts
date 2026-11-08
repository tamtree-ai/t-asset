/**
 * Push delivery (hooks plan §5.2–5.4). `logEvent` queues one `hook_deliveries` row per enabled push
 * hook that wants the type, and sends them from `after()` once the response is out. Outside a
 * request (scripts, tests) the rows wait for the sweep: a pending row is never lost, only late.
 * At least once: a timeout after the receiver acted means it may see the event twice, with the same
 * `X-Tasset-Event-Id`.
 */
import "server-only";

import { and, arrayContains, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { after } from "next/server";

import { db, schema } from "@/db";
import { CLAIM_LEASE_MS, DELIVERY_CONCURRENCY, DELIVERY_TIMEOUT_MS, type DeliveryResult, hookHeaders, isHookEvent, outcomeOf } from "@/lib/hooks";
import { decrypt } from "@/lib/studio/crypto";

import { buildEnvelopes } from "./envelope";

type Conn = Pick<typeof db, "insert" | "select">;
export type DeliveryKey = { eventId: string; subscriptionId: string };

/** Queues the event for every enabled push hook of the org that wants it. Returns the queued keys. */
export async function queueDeliveries(e: { id: string; orgId: string; type: string }, conn: Conn = db): Promise<DeliveryKey[]> {
  if (!isHookEvent(e.type)) return [];
  const subs = await conn
    .select({ id: schema.hookSubscriptions.id })
    .from(schema.hookSubscriptions)
    .where(and(eq(schema.hookSubscriptions.orgId, e.orgId), eq(schema.hookSubscriptions.mode, "push"), eq(schema.hookSubscriptions.enabled, true), arrayContains(schema.hookSubscriptions.events, [e.type])));
  if (!subs.length) return [];
  const keys = subs.map((s) => ({ eventId: e.id, subscriptionId: s.id }));
  await conn
    .insert(schema.hookDeliveries)
    .values(keys.map((k) => ({ ...k, nextAttemptAt: new Date() })))
    .onConflictDoNothing();
  return keys;
}

/**
 * Sends the keys after the response. `after` only works inside a request; anywhere else the rows
 * stay pending for the sweep. In a transaction this runs after the commit (after the response).
 */
export function dispatchAfterResponse(keys: DeliveryKey[]): void {
  if (!keys.length) return;
  try {
    after(() => deliver(keys));
  } catch {
    // Not in a request: the daily sweep or POST /api/hooks/redeliver sends them.
  }
}

/**
 * Takes the deliveries that are due (or the given ones, if due) for one sender: their
 * `next_attempt_at` moves out by the lease and `attempts` goes up, so the sweep and an `after()`
 * running together never send the same row twice.
 */
async function claim(keys: DeliveryKey[] | null, now: Date, limit: number) {
  const d = schema.hookDeliveries;
  const due = and(eq(d.status, "pending"), lte(d.nextAttemptAt, now));
  const which = keys ? or(...keys.map((k) => and(eq(d.eventId, k.eventId), eq(d.subscriptionId, k.subscriptionId)))) : undefined;
  const picked = db
    .select({ eventId: d.eventId, subscriptionId: d.subscriptionId })
    .from(d)
    .where(and(due, which))
    .orderBy(d.nextAttemptAt)
    .limit(limit)
    .for("update", { skipLocked: true });
  return db
    .update(d)
    .set({ attempts: sql`${d.attempts} + 1`, nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS) })
    .where(and(due, sql`(${d.eventId}, ${d.subscriptionId}) in (${picked})`))
    .returning({ eventId: d.eventId, subscriptionId: d.subscriptionId, attempts: d.attempts });
}

export type Sent = DeliveryKey & { status: "delivered" | "pending" | "failed"; httpStatus: number | null; error: string | null };

/** Sends the given deliveries if they are due (all due ones when `keys` is null), at most `limit`. */
export async function deliver(keys: DeliveryKey[] | null, opts: { fetcher?: typeof fetch; now?: Date; limit?: number } = {}): Promise<Sent[]> {
  const now = opts.now ?? new Date();
  const fetcher = opts.fetcher ?? fetch;
  if (keys && !keys.length) return [];
  const claimed = await claim(keys, now, opts.limit ?? 100);
  if (!claimed.length) return [];

  const events = await db.select().from(schema.studioEvents).where(inArray(schema.studioEvents.id, [...new Set(claimed.map((c) => c.eventId))]));
  const subs = await db.select().from(schema.hookSubscriptions).where(inArray(schema.hookSubscriptions.id, [...new Set(claimed.map((c) => c.subscriptionId))]));
  const envelopes = new Map((await buildEnvelopes(events)).map((env) => [env.id, env]));
  const subById = new Map(subs.map((s) => [s.id, s]));

  const out: Sent[] = [];
  for (let i = 0; i < claimed.length; i += DELIVERY_CONCURRENCY) {
    const batch = claimed.slice(i, i + DELIVERY_CONCURRENCY);
    out.push(...(await Promise.all(batch.map((c) => sendOne(c, subById.get(c.subscriptionId), envelopes.get(c.eventId), fetcher)))));
  }
  return out;
}

async function sendOne(
  c: DeliveryKey & { attempts: number },
  sub: typeof schema.hookSubscriptions.$inferSelect | undefined,
  envelope: Awaited<ReturnType<typeof buildEnvelopes>>[number] | undefined,
  fetcher: typeof fetch,
): Promise<Sent> {
  let result: DeliveryResult;
  if (!sub || !envelope || !sub.url || !sub.secretEnc) result = { httpStatus: 410, error: "The hook or its event is gone." };
  else if (!sub.enabled) result = { httpStatus: 410, error: "The hook is turned off." };
  else result = await post(sub.url, decrypt(sub.secretEnc), envelope, c.attempts, fetcher);

  const now = new Date();
  const o = outcomeOf(result, c.attempts, now.getTime());
  await db
    .update(schema.hookDeliveries)
    .set({ status: o.status, nextAttemptAt: o.nextAttemptAt, lastHttpStatus: result.httpStatus, lastError: o.error, deliveredAt: o.status === "delivered" ? now : null })
    .where(and(eq(schema.hookDeliveries.eventId, c.eventId), eq(schema.hookDeliveries.subscriptionId, c.subscriptionId)));
  if (sub) {
    await db
      .update(schema.hookSubscriptions)
      .set(o.status === "delivered" ? { lastSuccessAt: now } : { lastErrorAt: now, lastError: o.error })
      .where(eq(schema.hookSubscriptions.id, sub.id));
  }
  return { eventId: c.eventId, subscriptionId: c.subscriptionId, status: o.status, httpStatus: result.httpStatus, error: o.error };
}

async function post(url: string, secret: string, envelope: { id: string; type: string }, attempt: number, fetcher: typeof fetch): Promise<DeliveryResult> {
  const body = JSON.stringify(envelope);
  try {
    const res = await fetcher(url, { method: "POST", headers: hookHeaders(secret, body, { id: envelope.id, type: envelope.type, attempt }), body, redirect: "manual", signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS) });
    await res.body?.cancel().catch(() => undefined);
    return { httpStatus: res.status, error: null };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { httpStatus: null, error: timeout ? `No answer in ${DELIVERY_TIMEOUT_MS / 1000} seconds.` : `Couldn't reach it: ${e instanceof Error ? e.message.slice(0, 200) : "network error"}.` };
  }
}

/** The retry sweep: the daily cleanup and POST /api/hooks/redeliver. Also drops delivery rows older than 30 days. */
export async function sweepDeliveries(now = new Date(), fetcher?: typeof fetch): Promise<{ sent: number; delivered: number; pruned: number }> {
  const sent = await deliver(null, { now, fetcher, limit: 100 });
  const pruned = await db
    .delete(schema.hookDeliveries)
    .where(lt(schema.hookDeliveries.createdAt, new Date(now.getTime() - 30 * 86_400_000)))
    .returning({ eventId: schema.hookDeliveries.eventId });
  return { sent: sent.length, delivered: sent.filter((s) => s.status === "delivered").length, pruned: pruned.length };
}
