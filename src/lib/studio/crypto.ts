/**
 * AES-256-GCM for the share token and passcode (plan §4.6): encrypted, not hashed, so the owner
 * can copy the link and re-send the passcode. Format: `v1.<iv>.<tag>.<ciphertext>`, base64url.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { studioEnv } from "./env";

/** Outside production, with no STUDIO_SECRET, a fixed key keeps dev working. Production refuses to start without it (assertStudioEnv). */
const DEV_KEY = createHash("sha256").update("t-asset dev key").digest();

export function secretKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const { secret } = studioEnv(env);
  if (secret) return secret;
  if (env.NODE_ENV === "production") throw new Error("STUDIO_SECRET is not set. Make one with: openssl rand -hex 32, and add it to the environment.");
  return DEV_KEY;
}

export function encrypt(plain: string, key: Buffer = secretKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decrypt(sealed: string, key: Buffer = secretKey()): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || body === undefined) throw new Error("That value was not sealed by t-asset.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
