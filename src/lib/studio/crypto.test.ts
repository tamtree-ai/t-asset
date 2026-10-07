import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decrypt, encrypt, secretKey } from "./crypto";

const key = randomBytes(32);

describe("studio crypto (AES-256-GCM)", () => {
  it("round-trips text, including unicode and the empty string", () => {
    for (const plain of ["hello", "pässcode ✓ 日本語", "", "x".repeat(10_000)]) expect(decrypt(encrypt(plain, key), key)).toBe(plain);
  });

  it("uses a fresh IV, so the same text seals differently each time", () => {
    expect(encrypt("same", key)).not.toBe(encrypt("same", key));
  });

  it("refuses the wrong key", () => {
    expect(() => decrypt(encrypt("secret", key), randomBytes(32))).toThrow();
  });

  it("refuses a tampered value (GCM authenticates)", () => {
    const [v, iv, tag, body] = encrypt("secret", key).split(".");
    const flipped = Buffer.from(body!, "base64url");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => decrypt([v, iv, tag, flipped.toString("base64url")].join("."), key)).toThrow();
  });

  it("refuses something t-shoot didn't seal", () => {
    expect(() => decrypt("not-sealed", key)).toThrow(/not sealed/);
    expect(() => decrypt("v2.a.b.c", key)).toThrow(/not sealed/);
  });

  it("uses a dev key outside production, but never in production without STUDIO_SECRET", () => {
    expect(secretKey({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toHaveLength(32);
    expect(() => secretKey({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/STUDIO_SECRET/);
    expect(secretKey({ NODE_ENV: "production", STUDIO_SECRET: key.toString("hex") } as NodeJS.ProcessEnv).equals(key)).toBe(true);
  });
});
