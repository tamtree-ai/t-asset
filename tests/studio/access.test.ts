/** The guest side: passcode gate, lockout, sessions, identity, and what ends a session. */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { type Ctx, setup } from "./helpers";

vi.mock("server-only", () => ({}));

let c: Ctx;
let org: Awaited<ReturnType<Ctx["org"]>>;
let t: Awaited<ReturnType<Ctx["tree"]>>;
let access: typeof import("@/services/studio/access");
let shares: typeof import("@/services/studio/shares");
let n = 0;
const ip = () => `10.0.0.${++n}`;

async function newShare(over: Record<string, unknown> = {}) {
  return c.share(org.orgId, org.memberId, t.projectId, [t.assetId], over);
}

beforeAll(async () => {
  c = await setup("access");
  org = await c.org("a");
  t = await c.tree(org.orgId);
  await c.version(org.orgId, t.variationId);
  access = await import("@/services/studio/access");
  shares = await import("@/services/studio/shares");
});
afterAll(async () => c.cleanup());

describe("finding a share", () => {
  it("looks up by the token's hash, and rejects malformed tokens without touching the database", async () => {
    const { share, token } = await newShare();
    expect((await access.findShareByToken(token))!.id).toBe(share.id);
    expect(await access.findShareByToken(token + "x")).toBeNull();
    expect(await access.findShareByToken("short")).toBeNull();
    expect(await access.findShareByToken("../../etc/passwd")).toBeNull();
    expect(await access.findShareByToken("")).toBeNull();
  });
});

describe("the gate", () => {
  it("opens with the right passcode, in any case and with a dash, and not with a wrong one", async () => {
    const { token, passcode } = await newShare();
    const me = ip();
    await expect(access.unlockShare(token, "WRONG1", { ip: me, ua: "t" })).rejects.toThrow(/isn't right\. 4 tries left/);
    await expect(access.unlockShare(token, "", { ip: me, ua: "t" })).rejects.toThrow(/isn't right/);
    const ok = await access.unlockShare(token, `${passcode.slice(0, 3)}-${passcode.slice(3)}`.toLowerCase(), { ip: me, ua: "t" });
    expect(ok.sessionToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(ok.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });

  it("stores only the hash of the session token", async () => {
    const { share, token, passcode } = await newShare();
    const ok = await access.unlockShare(token, passcode, { ip: ip(), ua: "agent" });
    const rows = await c.db.select().from(c.schema.studioShareSessions).where(eq(c.schema.studioShareSessions.shareId, share.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(ok.sessionToken);
    expect(rows[0]).toMatchObject({ reviewerId: null, ua: "agent" });
  });

  it("locks after five wrong tries from one address, even for the right passcode, and counts per address and per share", async () => {
    const { token, passcode } = await newShare();
    const other = await newShare();
    const me = ip();
    for (let i = 0; i < 4; i++) await expect(access.unlockShare(token, "BADBAD", { ip: me, ua: "t" })).rejects.toThrow(/isn't right/);
    await expect(access.unlockShare(token, "BADBAD", { ip: me, ua: "t" })).rejects.toThrow(/Too many wrong passcodes/);
    await expect(access.unlockShare(token, passcode, { ip: me, ua: "t" })).rejects.toThrow(/Too many wrong passcodes\. Try again in/);
    // Someone else, and the same person on a different share, are not locked.
    await expect(access.unlockShare(token, passcode, { ip: ip(), ua: "t" })).resolves.toBeTruthy();
    await expect(access.unlockShare(other.token, other.passcode, { ip: me, ua: "t" })).resolves.toBeTruthy();
  });

  it("refuses a revoked, an expired and an unknown link", async () => {
    const revoked = await newShare();
    await shares.revokeShare(org.orgId, revoked.share.id);
    await expect(access.unlockShare(revoked.token, revoked.passcode, { ip: ip(), ua: "t" })).rejects.toThrow(/has ended/);
    const expired = await newShare();
    await c.db.update(c.schema.studioShares).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(c.schema.studioShares.id, expired.share.id));
    await expect(access.unlockShare(expired.token, expired.passcode, { ip: ip(), ua: "t" })).rejects.toThrow(/has ended/);
    await expect(access.unlockShare("A".repeat(32), "ABCDEF", { ip: ip(), ua: "t" })).rejects.toThrow(/has ended/);
  });

  it("counts hits in fixed windows", async () => {
    const rule = { limit: 2, windowMs: 60_000 };
    const key = `k-${Math.random()}`;
    const t0 = 1_700_000_000_000;
    expect((await access.hit("test", key, rule, t0)).allowed).toBe(true);
    expect((await access.hit("test", key, rule, t0 + 1000)).allowed).toBe(true);
    const third = await access.hit("test", key, rule, t0 + 2000);
    expect(third).toMatchObject({ allowed: false, count: 3 });
    expect(third.retryAfterS).toBeGreaterThan(0);
    // The next window starts clean.
    expect((await access.hit("test", key, rule, t0 + 60_000)).allowed).toBe(true);
    expect(await access.peek("test", key, rule, t0 + 60_000)).toMatchObject({ count: 1, locked: false });
  });

  it("limitOrThrow words the refusal", async () => {
    const key = `lim-${Math.random()}`;
    for (let i = 0; i < 10; i++) await access.limitOrThrow("identify", key, "joining");
    await expect(access.limitOrThrow("identify", key, "joining")).rejects.toThrow(/joining too quickly\. Try again in/);
  });
});

describe("sessions", () => {
  it("find the reviewer behind a cookie, for this share only", async () => {
    const a = await newShare();
    const b = await newShare();
    const ok = await access.unlockShare(a.token, a.passcode, { ip: ip(), ua: "t" });
    expect(await access.sessionFor(a.share, ok.sessionToken)).toMatchObject({ shareId: a.share.id, reviewer: null });
    expect(await access.sessionFor(b.share, ok.sessionToken)).toBeNull();
    expect(await access.sessionFor(a.share, "garbage")).toBeNull();
    expect(await access.sessionFor(a.share, undefined)).toBeNull();
  });

  it("end when they expire", async () => {
    const a = await newShare();
    const ok = await access.unlockShare(a.token, a.passcode, { ip: ip(), ua: "t" });
    await c.db.update(c.schema.studioShareSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(c.schema.studioShareSessions.shareId, a.share.id));
    expect(await access.sessionFor(a.share, ok.sessionToken)).toBeNull();
  });

  it("revoking a share kills its sessions, and so does expiring it", async () => {
    const a = await newShare();
    const ok = await access.unlockShare(a.token, a.passcode, { ip: ip(), ua: "t" });
    expect(await access.sessionFor(a.share, ok.sessionToken)).not.toBeNull();
    await shares.revokeShare(org.orgId, a.share.id);
    const [revoked] = await c.db.select().from(c.schema.studioShares).where(eq(c.schema.studioShares.id, a.share.id));
    expect(await access.sessionFor(revoked!, ok.sessionToken)).toBeNull();
    expect(await c.db.select().from(c.schema.studioShareSessions).where(eq(c.schema.studioShareSessions.shareId, a.share.id))).toHaveLength(0);

    const b = await newShare();
    const ok2 = await access.unlockShare(b.token, b.passcode, { ip: ip(), ua: "t" });
    const expiredRow = { ...b.share, expiresAt: new Date(Date.now() - 1000) };
    expect(await access.sessionFor(expiredRow, ok2.sessionToken)).toBeNull();
  });

  it("a new passcode signs everyone out, and the old one stops working", async () => {
    const a = await newShare();
    const ok = await access.unlockShare(a.token, a.passcode, { ip: ip(), ua: "t" });
    const fresh = await shares.regeneratePasscode(org.orgId, a.share.id);
    expect(fresh).not.toBe(a.passcode);
    expect(await access.sessionFor(a.share, ok.sessionToken)).toBeNull();
    await expect(access.unlockShare(a.token, a.passcode, { ip: ip(), ua: "t" })).rejects.toThrow(/isn't right/);
    await expect(access.unlockShare(a.token, fresh, { ip: ip(), ua: "t" })).resolves.toBeTruthy();
  });

  it("only the owning org can revoke or regenerate", async () => {
    const other = await c.org("b");
    const a = await newShare();
    await expect(shares.revokeShare(other.orgId, a.share.id)).rejects.toThrow(/not found/);
    await expect(shares.regeneratePasscode(other.orgId, a.share.id)).rejects.toThrow(/not found/);
  });

  it("reopening a revoked link makes it live again, with no old sessions", async () => {
    const a = await newShare();
    await shares.revokeShare(org.orgId, a.share.id);
    await shares.restoreShare(org.orgId, a.share.id);
    await expect(access.unlockShare(a.token, a.passcode, { ip: ip(), ua: "t" })).resolves.toBeTruthy();
  });
});

describe("identity", () => {
  it("creates a reviewer, ties the session to them, and logs that they joined", async () => {
    const a = await newShare();
    const ok = await access.unlockShare(a.token, a.passcode, { ip: ip(), ua: "t" });
    const session = (await access.sessionFor(a.share, ok.sessionToken))!;
    const r = await access.identify(a.share, session.id, { name: "  Sam   Lee ", email: " SAM@Acme.com " });
    expect(r).toMatchObject({ name: "Sam Lee", email: "sam@acme.com" });
    expect((await access.sessionFor(a.share, ok.sessionToken))!.reviewer!.id).toBe(r.id);
    const events = await c.db.select().from(c.schema.studioEvents).where(and(eq(c.schema.studioEvents.shareId, a.share.id), eq(c.schema.studioEvents.type, "reviewer.joined")));
    expect(events).toHaveLength(1);
    expect(events[0]!.actorLabel).toBe("Sam Lee");
  });

  it("recognises the same email in the same share as the same person", async () => {
    const a = await newShare();
    const s1 = await access.unlockShare(a.token, a.passcode, { ip: ip(), ua: "phone" });
    const s2 = await access.unlockShare(a.token, a.passcode, { ip: ip(), ua: "laptop" });
    const first = await access.identify(a.share, (await access.sessionFor(a.share, s1.sessionToken))!.id, { name: "Sam", email: "sam@acme.com" });
    const second = await access.identify(a.share, (await access.sessionFor(a.share, s2.sessionToken))!.id, { name: "Samuel", email: "SAM@acme.com" });
    expect(second.id).toBe(first.id);
    expect(await c.db.select().from(c.schema.studioReviewers).where(eq(c.schema.studioReviewers.shareId, a.share.id))).toHaveLength(1);
  });

  it("validates the name and email", async () => {
    const a = await newShare();
    const ok = await access.unlockShare(a.token, a.passcode, { ip: ip(), ua: "t" });
    const id = (await access.sessionFor(a.share, ok.sessionToken))!.id;
    await expect(access.identify(a.share, id, { name: "", email: "a@b.co" })).rejects.toThrow(/Enter your name/);
    await expect(access.identify(a.share, id, { name: "x".repeat(61), email: "a@b.co" })).rejects.toThrow(/60 characters/);
    await expect(access.identify(a.share, id, { name: "Sam", email: "not-an-email" })).rejects.toThrow(/email address/);
  });
});

describe("client address", () => {
  it("takes the first forwarded hop, else the real-ip header, else nothing", () => {
    const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
    expect(access.clientIp(h({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(access.clientIp(h({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(access.clientIp(h({}))).toBeNull();
  });
});
