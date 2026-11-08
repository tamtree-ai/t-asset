/**
 * The owner's hooks (hooks plan §5.1, §5.5–5.7). Push hooks get a signing secret (stored sealed,
 * since it is needed to sign); pull hooks get a feed token (stored hashed). Either is shown once.
 * Every function is scoped to the org; the settings actions add the owner check.
 */
import "server-only";

import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { FEED_LIMIT, FEED_WINDOW_MS, HOOK_EVENT_TYPES, MAX_HOOKS, TEST_EVENT, urlProblem } from "@/lib/hooks";
import { hashToken, newToken } from "@/lib/session-token";
import { decrypt, encrypt } from "@/lib/studio/crypto";
import { StudioError } from "@/lib/studio/errors";

import { hit } from "../studio/access";
import { logEvent } from "../studio/events";
import { deliver, type Sent } from "./deliver";
import { buildEnvelopes, type Envelope } from "./envelope";

export type Hook = typeof schema.hookSubscriptions.$inferSelect;
export const SECRET_PREFIX = "whsec_";
export const FEED_TOKEN_PREFIX = "ttf_";
/** Feed reads a minute per hook. */
export const FEED_RATE = { limit: 60, windowMs: 60_000 };

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const production = () => process.env.NODE_ENV === "production";

const eventsSchema = z
  .array(z.string())
  .min(1, "Pick at least one event.")
  .transform((e) => [...new Set(e)])
  .refine((e) => e.every((t) => HOOK_EVENT_TYPES.includes(t)), "One of those events isn't one t-asset sends.");
const nameSchema = z.string().trim().min(1, "Give the hook a name.").max(80, "Keep the name under 80 characters.");
const urlSchema = z
  .string()
  .trim()
  .max(2000)
  .superRefine((u, ctx) => {
    const problem = urlProblem(u, production());
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

const createInput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("push"), name: nameSchema, events: eventsSchema, url: urlSchema }),
  z.object({ mode: z.literal("pull"), name: nameSchema, events: eventsSchema }),
]);

function newCredential(mode: "push" | "pull") {
  if (mode === "push") {
    const secret = `${SECRET_PREFIX}${newToken(32)}`;
    return { plain: secret, cols: { secretEnc: encrypt(secret), feedTokenHash: null, credentialHint: secret.slice(-4) } };
  }
  const token = `${FEED_TOKEN_PREFIX}${newToken(32)}`;
  return { plain: token, cols: { secretEnc: null, feedTokenHash: hashToken(token), credentialHint: token.slice(-4) } };
}

/** Makes a hook. The secret (push) or feed token (pull) is returned here and never again. */
export async function createHook(orgId: string, raw: unknown): Promise<{ credential: string; hook: Hook }> {
  const input = createInput.parse(raw);
  const [{ n }] = (await db.select({ n: sql<number>`count(*)` }).from(schema.hookSubscriptions).where(eq(schema.hookSubscriptions.orgId, orgId))) as [{ n: number }];
  if (Number(n) >= MAX_HOOKS) throw new StudioError(`A studio holds up to ${MAX_HOOKS} hooks. Delete one first.`);
  const c = newCredential(input.mode);
  const [hook] = await db
    .insert(schema.hookSubscriptions)
    .values({ orgId, name: input.name, mode: input.mode, events: input.events, url: input.mode === "push" ? input.url : null, ...c.cols })
    .returning();
  return { credential: c.plain, hook: hook! };
}

export async function listHooks(orgId: string): Promise<Hook[]> {
  return db.select().from(schema.hookSubscriptions).where(eq(schema.hookSubscriptions.orgId, orgId)).orderBy(desc(schema.hookSubscriptions.createdAt));
}

export async function getHook(orgId: string, id: string): Promise<Hook> {
  if (!isUuid(id)) throw new StudioError("That hook was not found.");
  const [hook] = await db.select().from(schema.hookSubscriptions).where(and(eq(schema.hookSubscriptions.id, id), eq(schema.hookSubscriptions.orgId, orgId))).limit(1);
  if (!hook) throw new StudioError("That hook was not found.");
  return hook;
}

/** The last deliveries, newest first, for the hook page. */
export async function recentDeliveries(orgId: string, id: string, limit = 20) {
  const hook = await getHook(orgId, id);
  return db
    .select({
      eventId: schema.hookDeliveries.eventId,
      type: schema.studioEvents.type,
      status: schema.hookDeliveries.status,
      attempts: schema.hookDeliveries.attempts,
      lastHttpStatus: schema.hookDeliveries.lastHttpStatus,
      lastError: schema.hookDeliveries.lastError,
      nextAttemptAt: schema.hookDeliveries.nextAttemptAt,
      deliveredAt: schema.hookDeliveries.deliveredAt,
      createdAt: schema.hookDeliveries.createdAt,
    })
    .from(schema.hookDeliveries)
    .innerJoin(schema.studioEvents, eq(schema.studioEvents.id, schema.hookDeliveries.eventId))
    .where(eq(schema.hookDeliveries.subscriptionId, hook.id))
    .orderBy(desc(schema.hookDeliveries.createdAt))
    .limit(limit);
}

const updateInput = z.object({ name: nameSchema.optional(), events: eventsSchema.optional(), url: urlSchema.optional(), enabled: z.boolean().optional() });

export async function updateHook(orgId: string, id: string, raw: unknown): Promise<Hook> {
  const hook = await getHook(orgId, id);
  const input = updateInput.parse(raw);
  if (input.url !== undefined && hook.mode !== "push") throw new StudioError("A pull hook has no address.");
  const [row] = await db
    .update(schema.hookSubscriptions)
    .set({ ...input, ...(input.enabled ? { lastError: null } : {}), updatedAt: new Date() })
    .where(eq(schema.hookSubscriptions.id, hook.id))
    .returning();
  return row!;
}

/** A new secret or token at once; the old one stops working (one owner, so no grace period). */
export async function rotateCredential(orgId: string, id: string): Promise<{ credential: string }> {
  const hook = await getHook(orgId, id);
  const c = newCredential(hook.mode);
  await db.update(schema.hookSubscriptions).set({ ...c.cols, updatedAt: new Date() }).where(eq(schema.hookSubscriptions.id, hook.id));
  return { credential: c.plain };
}

export async function deleteHook(orgId: string, id: string): Promise<void> {
  const hook = await getHook(orgId, id);
  await db.delete(schema.hookSubscriptions).where(eq(schema.hookSubscriptions.id, hook.id));
}

/**
 * Send test: a `test.ping` to this hook only. A push hook is sent it now and the result returned;
 * a pull hook sees it on its next read of the feed.
 */
export async function sendTest(orgId: string, id: string, actorLabel: string, fetcher?: typeof fetch): Promise<Sent | null> {
  const hook = await getHook(orgId, id);
  const eventId = await logEvent({ orgId, actorLabel, type: TEST_EVENT, payload: { subscriptionId: hook.id, hook: hook.name } }, db, { dispatch: false });
  if (hook.mode === "pull") return null;
  await db.insert(schema.hookDeliveries).values({ eventId, subscriptionId: hook.id, nextAttemptAt: new Date() });
  const [sent] = await deliver([{ eventId, subscriptionId: hook.id }], { fetcher });
  return sent ?? null;
}

/** The owner's Redeliver: the delivery goes again now, whatever state it was in. */
export async function redeliver(orgId: string, id: string, eventId: string, fetcher?: typeof fetch): Promise<Sent | null> {
  const hook = await getHook(orgId, id);
  if (!isUuid(eventId)) throw new StudioError("That delivery was not found.");
  const [row] = await db
    .update(schema.hookDeliveries)
    .set({ status: "pending", nextAttemptAt: new Date() })
    .where(and(eq(schema.hookDeliveries.subscriptionId, hook.id), eq(schema.hookDeliveries.eventId, eventId)))
    .returning({ eventId: schema.hookDeliveries.eventId });
  if (!row) throw new StudioError("That delivery was not found.");
  const [sent] = await deliver([{ eventId, subscriptionId: hook.id }], { fetcher });
  return sent ?? null;
}

export class FeedError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterS?: number,
  ) {
    super(message);
  }
}

/**
 * The pull feed (hooks plan §5.5): the newest 200 events of the hook's types from the last 7 days,
 * and none from before the hook was made. The reader dedupes by `id`. Stamps `last_polled_at`.
 */
export async function readFeed(id: string, authorization: string | null, now = new Date()): Promise<{ items: Envelope[] }> {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? "");
  if (!isUuid(id) || !m || !m[1]!.startsWith(FEED_TOKEN_PREFIX)) throw new FeedError("Not allowed.", 401);
  const [hook] = await db
    .select()
    .from(schema.hookSubscriptions)
    .where(and(eq(schema.hookSubscriptions.id, id), eq(schema.hookSubscriptions.feedTokenHash, hashToken(m[1]!)), eq(schema.hookSubscriptions.mode, "pull")))
    .limit(1);
  if (!hook) throw new FeedError("Not allowed.", 401);
  if (!hook.enabled) throw new FeedError("This hook is turned off.", 403);
  const r = await hit("hookfeed", hook.id, FEED_RATE, now.getTime());
  if (!r.allowed) throw new FeedError("Too many reads. Check every few minutes at most.", 429, r.retryAfterS);

  const since = new Date(Math.max(hook.createdAt.getTime(), now.getTime() - FEED_WINDOW_MS));
  const e = schema.studioEvents;
  const rows = await db
    .select()
    .from(e)
    .where(and(eq(e.orgId, hook.orgId), gt(e.createdAt, since), or(inArray(e.type, hook.events), and(eq(e.type, TEST_EVENT), sql`${e.payload}->>'subscriptionId' = ${hook.id}`))))
    .orderBy(desc(e.createdAt))
    .limit(FEED_LIMIT);
  await db.update(schema.hookSubscriptions).set({ lastPolledAt: now }).where(eq(schema.hookSubscriptions.id, hook.id));
  return { items: await buildEnvelopes(rows) };
}

/** For the hook page: the secret's tail only. Kept here so the sealed value never leaves the service. */
export function credentialLabel(hook: Hook): string {
  return hook.credentialHint ? `…${hook.credentialHint}` : "";
}

/** Tests only: the plain push secret, to verify signatures the way a receiver would. */
export function secretOf(hook: Hook): string | null {
  return hook.secretEnc ? decrypt(hook.secretEnc) : null;
}
