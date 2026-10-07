/**
 * The guest side of a share (plan §4.6): find a share by its URL token, check the passcode, keep a
 * session cookie, ask for a name and email once. Nothing here trusts the browser: the cookie is a
 * random token whose hash is looked up, and every call re-checks that the share is still live.
 */
import "server-only";

import { and, eq, gt, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { hashToken, newToken } from "@/lib/session-token";
import { decrypt } from "@/lib/studio/crypto";
import { StudioError } from "@/lib/studio/errors";
import { type LimitRule, minutesLabel, RULES, retryAfterSeconds, windowStart } from "@/lib/studio/limits";
import { passcodeMatches } from "@/lib/studio/passcode";

import { logEvent } from "./events";
import { shareState } from "./shares";

export type ShareRow = typeof schema.studioShares.$inferSelect;
export type ReviewerRow = typeof schema.studioReviewers.$inferSelect;

export const SESSION_DAYS = 30;

/** `sr_` plus the first 8 characters of the share id: one cookie per share, so two reviews don't overwrite each other. */
export const sessionCookieName = (shareId: string) => `sr_${shareId.replace(/-/g, "").slice(0, 8)}`;

export async function findShareByToken(token: string): Promise<ShareRow | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [row] = await db.select().from(schema.studioShares).where(eq(schema.studioShares.tokenHash, hashToken(token))).limit(1);
  return row ?? null;
}

/** Counts one hit in the current window; says whether it was within the limit. */
export async function hit(bucket: string, key: string, rule: LimitRule, now = Date.now()): Promise<{ allowed: boolean; count: number; retryAfterS: number }> {
  const start = new Date(windowStart(now, rule.windowMs));
  const [row] = await db
    .insert(schema.studioRateLimits)
    .values({ bucket, key, windowStart: start, count: 1 })
    .onConflictDoUpdate({ target: [schema.studioRateLimits.bucket, schema.studioRateLimits.key, schema.studioRateLimits.windowStart], set: { count: sql`${schema.studioRateLimits.count} + 1` } })
    .returning({ count: schema.studioRateLimits.count });
  return { allowed: row!.count <= rule.limit, count: row!.count, retryAfterS: retryAfterSeconds(now, rule.windowMs) };
}

/** The count so far in the current window, without adding to it. */
export async function peek(bucket: string, key: string, rule: LimitRule, now = Date.now()): Promise<{ count: number; locked: boolean; retryAfterS: number }> {
  const [row] = await db
    .select({ count: schema.studioRateLimits.count })
    .from(schema.studioRateLimits)
    .where(and(eq(schema.studioRateLimits.bucket, bucket), eq(schema.studioRateLimits.key, key), eq(schema.studioRateLimits.windowStart, new Date(windowStart(now, rule.windowMs)))))
    .limit(1);
  const count = row?.count ?? 0;
  return { count, locked: count >= rule.limit, retryAfterS: retryAfterSeconds(now, rule.windowMs) };
}

/** Throws a message fit to show when `bucket/key` is over its rule. */
export async function limitOrThrow(bucket: keyof typeof RULES, key: string, what: string): Promise<void> {
  const r = await hit(bucket, key, RULES[bucket]);
  if (!r.allowed) throw new StudioError(`You're ${what} too quickly. Try again in ${minutesLabel(r.retryAfterS)}.`);
}

/**
 * Checks the passcode and opens a session. Wrong tries count per IP and share; the fifth locks the
 * gate until the window ends, and a right passcode doesn't unlock while locked.
 */
export async function unlockShare(token: string, passcode: string, meta: { ip: string | null; ua: string | null }): Promise<{ sessionToken: string; shareId: string; expiresAt: Date }> {
  const share = await findShareByToken(token);
  if (!share || shareState(share) !== "live") throw new StudioError("This link has ended.");
  const key = `${share.id}:${meta.ip ?? "unknown"}`;
  const before = await peek("gate", key, RULES.gate);
  if (before.locked) throw new StudioError(`Too many wrong passcodes. Try again in ${minutesLabel(before.retryAfterS)}.`);
  if (!passcode.trim() || !passcodeMatches(passcode, decrypt(share.passcodeEnc))) {
    const r = await hit("gate", key, RULES.gate);
    const left = RULES.gate.limit - r.count;
    throw new StudioError(left > 0 ? `That passcode isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : `Too many wrong passcodes. Try again in ${minutesLabel(r.retryAfterS)}.`);
  }
  const sessionToken = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.studioShareSessions).values({ shareId: share.id, tokenHash: hashToken(sessionToken), ip: meta.ip, ua: meta.ua?.slice(0, 300) ?? null, expiresAt });
  return { sessionToken, shareId: share.id, expiresAt };
}

export type Session = { id: string; shareId: string; reviewer: ReviewerRow | null };

/** The session behind a cookie value for this share, or null (unknown, expired, or the share has ended since). */
export async function sessionFor(share: ShareRow, cookieValue: string | undefined): Promise<Session | null> {
  if (!cookieValue || shareState(share) !== "live") return null;
  const [s] = await db
    .select()
    .from(schema.studioShareSessions)
    .where(and(eq(schema.studioShareSessions.tokenHash, hashToken(cookieValue)), eq(schema.studioShareSessions.shareId, share.id), gt(schema.studioShareSessions.expiresAt, new Date())))
    .limit(1);
  if (!s) return null;
  let reviewer: ReviewerRow | null = null;
  if (s.reviewerId) {
    [reviewer] = await db.select().from(schema.studioReviewers).where(eq(schema.studioReviewers.id, s.reviewerId)).limit(1);
    reviewer ??= null;
  }
  return { id: s.id, shareId: s.shareId, reviewer };
}

/** Same address in the same share = same person: a second browser or a cleared cookie keeps their comments. */
export async function identify(share: ShareRow, sessionId: string, input: { name: string; email: string }): Promise<ReviewerRow> {
  const name = input.name.trim().replace(/\s+/g, " ");
  const email = input.email.trim().toLowerCase();
  if (name.length < 1) throw new StudioError("Enter your name.");
  if (name.length > 60) throw new StudioError("Keep your name under 60 characters.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new StudioError("Enter an email address.");

  const [existing] = await db.select().from(schema.studioReviewers).where(and(eq(schema.studioReviewers.shareId, share.id), eq(schema.studioReviewers.email, email))).limit(1);
  let reviewer = existing;
  if (reviewer) {
    await db.update(schema.studioReviewers).set({ name, lastSeenAt: new Date() }).where(eq(schema.studioReviewers.id, reviewer.id));
    reviewer = { ...reviewer, name };
  } else {
    const [created] = await db.insert(schema.studioReviewers).values({ shareId: share.id, name, email, lastSeenAt: new Date() }).returning();
    reviewer = created!;
    await logEvent({ orgId: share.orgId, projectId: share.projectId, shareId: share.id, actorLabel: name, type: "reviewer.joined" });
  }
  await db.update(schema.studioShareSessions).set({ reviewerId: reviewer.id }).where(eq(schema.studioShareSessions.id, sessionId));
  return reviewer;
}

export async function touchReviewer(reviewerId: string): Promise<void> {
  await db.update(schema.studioReviewers).set({ lastSeenAt: new Date() }).where(eq(schema.studioReviewers.id, reviewerId));
}

/** The client address. On Vercel, X-Forwarded-For is set by Vercel's edge and a client can't forge it; elsewhere it is only as honest as the proxy in front. */
export function clientIp(h: { get(name: string): string | null }): string | null {
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || h.get("x-real-ip") || null;
}
