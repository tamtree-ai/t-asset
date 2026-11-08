/**
 * Review API tokens (planning/2026-11-08-review-loop, design §2.1). A producer (tamshoot, a
 * pipeline script) sends `Authorization: Bearer tt_live_…`. Only the SHA-256 is stored; the token
 * is shown once. Each token belongs to one org and carries scopes; revoking is immediate.
 */
import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import type { ApiScope } from "@/db/schema";
import { hashToken, newToken } from "@/lib/session-token";
import { StudioError } from "@/lib/studio/errors";

export const API_SCOPES = ["review:read", "review:write"] as const satisfies readonly ApiScope[];
export const TOKEN_PREFIX = "tt_live_";
/** Requests a minute per token (the `studio_rate_limits` counters). */
export const API_RATE = { limit: 60, windowMs: 60_000 };
/** A studio can hold this many live tokens. */
export const MAX_TOKENS = 20;

export type ApiToken = typeof schema.studioApiTokens.$inferSelect;
export type ApiCaller = { tokenId: string; orgId: string; scopes: ApiScope[] };

const createInput = z.object({
  name: z.string().trim().min(1, "Give the token a name.").max(80, "Keep the name under 80 characters."),
  scopes: z.array(z.enum(API_SCOPES)).min(1, "Pick at least one scope.").transform((s) => [...new Set(s)]),
});

/** Makes a token. The plain token is returned here and never again. */
export async function createApiToken(orgId: string, raw: unknown): Promise<{ token: string; row: ApiToken }> {
  const input = createInput.parse(raw);
  const live = await db.select({ id: schema.studioApiTokens.id }).from(schema.studioApiTokens).where(and(eq(schema.studioApiTokens.orgId, orgId), isNull(schema.studioApiTokens.revokedAt)));
  if (live.length >= MAX_TOKENS) throw new StudioError(`A studio holds up to ${MAX_TOKENS} tokens. Revoke one first.`);
  const token = `${TOKEN_PREFIX}${newToken(32)}`;
  const [row] = await db.insert(schema.studioApiTokens).values({ orgId, name: input.name, tokenHash: hashToken(token), tokenHint: token.slice(-4), scopes: input.scopes }).returning();
  return { token, row: row! };
}

export async function listApiTokens(orgId: string): Promise<ApiToken[]> {
  return db.select().from(schema.studioApiTokens).where(eq(schema.studioApiTokens.orgId, orgId)).orderBy(desc(schema.studioApiTokens.createdAt));
}

export async function revokeApiToken(orgId: string, id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new StudioError("That token was not found.");
  const [row] = await db
    .update(schema.studioApiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.studioApiTokens.id, id), eq(schema.studioApiTokens.orgId, orgId), isNull(schema.studioApiTokens.revokedAt)))
    .returning({ id: schema.studioApiTokens.id });
  if (!row) throw new StudioError("That token was not found, or is already revoked.");
}

/** The caller behind an `Authorization` header, or null for a missing, unknown or revoked token. */
export async function callerFor(header: string | null, now = new Date()): Promise<ApiCaller | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? "");
  if (!m || !m[1]!.startsWith(TOKEN_PREFIX)) return null;
  const [row] = await db.select().from(schema.studioApiTokens).where(eq(schema.studioApiTokens.tokenHash, hashToken(m[1]!))).limit(1);
  if (!row || row.revokedAt) return null;
  // At most one write a minute per token for the "last used" column.
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(schema.studioApiTokens).set({ lastUsedAt: now }).where(eq(schema.studioApiTokens.id, row.id));
  }
  return { tokenId: row.id, orgId: row.orgId, scopes: row.scopes };
}
