/**
 * The owner's password (plan §5.5), checked against `OWNER_PASSWORD_HASH`. scrypt from node:crypto,
 * stored as `scrypt:<N>:<r>:<p>:<salt>:<hash>` (base64url). `:` rather than `$`, because .env loaders
 * expand `$`. `pnpm hash-password` makes one.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 32;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 10) throw new Error("Use a password of at least 10 characters.");
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join(":");
}

/** False for a wrong password or a malformed hash; never throws on input. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split(":");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const nn = Number(n);
  if (!Number.isInteger(nn) || nn < 2 ** 14 || nn > 2 ** 20 || want.length !== KEYLEN) return false;
  const got = await derive(password, Buffer.from(salt, "base64url"), nn, Number(r), Number(p));
  return timingSafeEqual(got, want);
}
