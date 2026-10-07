import { describe, expect, it } from "vitest";

import { bearerMatches, outputsFor, signWebhook, verifyWebhook } from "./tamtree";

describe("outputsFor", () => {
  it("asks for preview, watermark and thumb for an image, plus a poster for a video", () => {
    expect(outputsFor("f1", "image").map((o) => o.name)).toEqual(["preview", "wm_preview", "thumb"]);
    expect(outputsFor("f1", "video").map((o) => o.name)).toEqual(["preview", "wm_preview", "poster", "thumb"]);
  });
  it("puts every output under d/<fileId>/", () => {
    for (const o of [...outputsFor("abc", "image"), ...outputsFor("abc", "video")]) expect(o.key.startsWith("d/abc/")).toBe(true);
  });
});

describe("webhook signature", () => {
  const now = 1_800_000_000_000;
  const ts = now / 1000;
  it("verifies its own signature", () => {
    const sig = signWebhook("s3cret", ts, '{"a":1}');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyWebhook("s3cret", String(ts), '{"a":1}', sig, now)).toBe(true);
  });
  it("refuses a changed body, another secret, or an old timestamp", () => {
    const sig = signWebhook("s3cret", ts, '{"a":1}');
    expect(verifyWebhook("s3cret", String(ts), '{"a":2}', sig, now)).toBe(false);
    expect(verifyWebhook("other", String(ts), '{"a":1}', sig, now)).toBe(false);
    expect(verifyWebhook("s3cret", String(ts), '{"a":1}', sig, now + 301_000)).toBe(false);
    expect(verifyWebhook("s3cret", null, '{"a":1}', sig, now)).toBe(false);
  });
});

describe("bearerMatches", () => {
  it("matches the token and nothing else", () => {
    expect(bearerMatches("Bearer abc123", "abc123")).toBe(true);
    expect(bearerMatches("bearer abc123", "abc123")).toBe(true);
    expect(bearerMatches("Bearer abc124", "abc123")).toBe(false);
    expect(bearerMatches("abc123", "abc123")).toBe(false);
    expect(bearerMatches(null, "abc123")).toBe(false);
  });
  it("refuses everyone when no token is configured", () => {
    expect(bearerMatches("Bearer ", null)).toBe(false);
    expect(bearerMatches("Bearer x", null)).toBe(false);
  });
});
