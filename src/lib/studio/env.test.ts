import { describe, expect, it } from "vitest";

import { assertStudioEnv, studioEnv, studioSecret } from "./env";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
const HEX = "a".repeat(64);
const prod = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "production",
  STUDIO_SECRET: HEX,
  APP_URL: "https://review.example.com",
  OWNER_EMAIL: "Me@Example.com",
  OWNER_PASSWORD_HASH: "scrypt:x",
  TAMTREE_API_TOKEN: "t",
  TAMTREE_WEBHOOK_URL: "https://tamtree.example.com/webhook/tasset",
  TAMTREE_WEBHOOK_SECRET: "s",
  CRON_SECRET: "c",
};

describe("studioEnv", () => {
  it("has defaults when nothing is set", () => {
    const e = studioEnv(env({}));
    expect(e.blob).toBe("local");
    expect(e.appUrl).toBeNull();
    expect(e.softCapBytes).toBe(900 * 1024 * 1024);
    expect(e.keepVideoOriginals).toBe(false);
    expect(e.owner.studioName).toBe("Studio");
  });

  it("uses Vercel Blob on Vercel unless told otherwise", () => {
    expect(studioEnv(env({ VERCEL: "1" })).blob).toBe("vercel");
    expect(studioEnv(env({ VERCEL: "1", BLOB_DRIVER: "local" })).blob).toBe("local");
    expect(() => studioEnv(env({ BLOB_DRIVER: "s3" }))).toThrow(/not a store/);
  });

  it("reads a hex or base64 key of 32 bytes, and refuses a short one", () => {
    expect(studioEnv(env({ STUDIO_SECRET: HEX })).secret?.length).toBe(32);
    expect(studioEnv(env({ STUDIO_SECRET: Buffer.alloc(32, 7).toString("base64") })).secret?.length).toBe(32);
    expect(() => studioEnv(env({ STUDIO_SECRET: "short" }))).toThrow(/32 bytes/);
    expect(() => studioSecret(env({}))).toThrow(/not set/);
  });

  it("trims APP_URL, lower-cases the owner email, and refuses a bad cap", () => {
    expect(studioEnv(env({ APP_URL: "https://x.test/" })).appUrl).toBe("https://x.test");
    expect(() => studioEnv(env({ APP_URL: "x.test" }))).toThrow(/not a URL/);
    expect(studioEnv(env({ OWNER_EMAIL: " Me@Example.com " })).owner.email).toBe("me@example.com");
    expect(() => studioEnv(env({ BLOB_SOFT_CAP_BYTES: "lots" }))).toThrow(/not a number/);
  });
});

describe("assertStudioEnv", () => {
  it("lets development and preview deployments start with nothing set", () => {
    expect(() => assertStudioEnv(env({}))).not.toThrow();
    expect(() => assertStudioEnv(env({ NODE_ENV: "production", VERCEL_ENV: "preview" }))).not.toThrow();
  });

  it("passes a complete production environment", () => {
    expect(() => assertStudioEnv(env(prod))).not.toThrow();
  });

  it("names everything missing in production", () => {
    expect(() => assertStudioEnv(env({ NODE_ENV: "production", VERCEL_ENV: "production" }))).toThrow(/STUDIO_SECRET.*APP_URL.*OWNER_EMAIL.*OWNER_PASSWORD_HASH.*TAMTREE_API_TOKEN.*CRON_SECRET/);
    expect(() => assertStudioEnv(env({ ...prod, APP_URL: "http://review.example.com" }))).toThrow(/APP_URL/);
  });

  it("refuses the local blob driver in production", () => {
    expect(() => assertStudioEnv(env({ ...prod, BLOB_DRIVER: "local" }))).toThrow(/for development/);
  });
});
