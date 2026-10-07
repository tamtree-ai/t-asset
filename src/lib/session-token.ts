import { createHash, randomBytes } from "node:crypto";

/** The member session cookie. Here, not in auth.ts, so `proxy.ts` can read it without server-only imports. */
export const SESSION_COOKIE = "tasset_session";

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
