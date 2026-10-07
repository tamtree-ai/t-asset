/**
 * Owner sign-in (plan §5.5): the one owner in `OWNER_EMAIL` with the password in
 * `OWNER_PASSWORD_HASH`. The first good sign-in creates the studio (org, member, brand).
 * Five wrong tries per address lock sign-in for the rest of a 15-minute window.
 */
import "server-only";

import { and, eq, lt } from "drizzle-orm";

import { db, schema } from "@/db";
import { verifyPassword } from "@/lib/password";
import { hashToken, newToken } from "@/lib/session-token";
import { studioEnv } from "@/lib/studio/env";
import { StudioError } from "@/lib/studio/errors";
import { minutesLabel, RULES } from "@/lib/studio/limits";

import { hit, peek } from "./studio/access";

export const SESSION_DAYS = 30;

/** Checks the email and password; returns a new session token for the cookie. */
export async function signIn(input: { email: string; password: string }, meta: { ip: string | null }, env: NodeJS.ProcessEnv = process.env): Promise<{ token: string; expiresAt: Date }> {
  const { owner } = studioEnv(env);
  if (!owner.email || !owner.passwordHash) throw new StudioError("Sign-in isn't set up yet. Set OWNER_EMAIL and OWNER_PASSWORD_HASH (pnpm hash-password).");
  const key = meta.ip ?? "unknown";
  const before = await peek("signin", key, RULES.signin);
  if (before.locked) throw new StudioError(`Too many wrong tries. Try again in ${minutesLabel(before.retryAfterS)}.`);

  const email = input.email.trim().toLowerCase();
  const ok = (await verifyPassword(input.password, owner.passwordHash)) && email === owner.email;
  if (!ok) {
    const r = await hit("signin", key, RULES.signin);
    if (r.count >= RULES.signin.limit) throw new StudioError(`Too many wrong tries. Try again in ${minutesLabel(r.retryAfterS)}.`);
    throw new StudioError("That email and password don't match.");
  }

  const member = await ensureOwner(email, owner.studioName);
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.sessions).values({ memberId: member.id, tokenHash: hashToken(token), expiresAt });
  // Old sessions are swept here rather than by a job.
  await db.delete(schema.sessions).where(and(eq(schema.sessions.memberId, member.id), lt(schema.sessions.expiresAt, new Date())));
  return { token, expiresAt };
}

/** The owner's member row, made with its studio on first sign-in. */
export async function ensureOwner(email: string, studioName: string) {
  const [existing] = await db.select().from(schema.members).where(eq(schema.members.email, email)).limit(1);
  if (existing) return existing;
  return db.transaction(async (tx) => {
    const [org] = await tx.insert(schema.orgs).values({ name: studioName }).returning();
    const [member] = await tx.insert(schema.members).values({ orgId: org!.id, email, name: null, role: "owner" }).returning();
    await tx.insert(schema.studioBrand).values({ orgId: org!.id, studioName }).onConflictDoNothing();
    return member!;
  });
}

export async function signOut(token: string | undefined): Promise<void> {
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
}
