/** Owner services: org scoping everywhere, and deletes that take their files with them. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { type Ctx, setup } from "./helpers";

vi.mock("server-only", () => ({}));

let c: Ctx;
let a: Awaited<ReturnType<Ctx["org"]>>;
let b: Awaited<ReturnType<Ctx["org"]>>;
type Mods = { clients: typeof import("@/services/studio/clients"); projects: typeof import("@/services/studio/projects"); assets: typeof import("@/services/studio/assets"); shares: typeof import("@/services/studio/shares"); brand: typeof import("@/services/studio/brand") };
let m: Mods;

beforeAll(async () => {
  c = await setup("crud");
  a = await c.org("a");
  b = await c.org("b");
  m = {
    clients: await import("@/services/studio/clients"),
    projects: await import("@/services/studio/projects"),
    assets: await import("@/services/studio/assets"),
    shares: await import("@/services/studio/shares"),
    brand: await import("@/services/studio/brand"),
  };
});
afterAll(async () => c.cleanup());

describe("clients", () => {
  it("validates, and scopes by org", async () => {
    await expect(m.clients.createClient(a.orgId, { name: "  " })).rejects.toThrow(/name/);
    await expect(m.clients.createClient(a.orgId, { name: "X", contacts: [{ name: "n", email: "not-an-email" }] })).rejects.toThrow(/email/);
    const acme = await m.clients.createClient(a.orgId, { name: "Acme", company: "Acme Inc", contacts: [{ name: "Sam", email: "SAM@acme.com" }] });
    expect(acme.contacts[0]!.email).toBe("sam@acme.com");
    expect(await m.clients.getClient(a.orgId, acme.id)).not.toBeNull();
    expect(await m.clients.getClient(b.orgId, acme.id)).toBeNull();
    await expect(m.clients.updateClient(b.orgId, acme.id, { name: "Hijacked" })).rejects.toThrow(/not found/);
    await expect(m.clients.setClientArchived(b.orgId, acme.id, true)).rejects.toThrow(/not found/);
    await expect(m.clients.deleteClient(b.orgId, acme.id)).rejects.toThrow(/not found/);
    expect((await m.clients.listClients(b.orgId)).map((x) => x.id)).not.toContain(acme.id);
    expect((await m.clients.listClients(a.orgId)).map((x) => x.id)).toContain(acme.id);
  });

  it("searches by name or company, and archives out of the default list", async () => {
    const one = await m.clients.createClient(a.orgId, { name: "Zebra Crossing", company: "Stripes Ltd" });
    expect((await m.clients.listClients(a.orgId, { q: "zebra" })).map((x) => x.id)).toEqual([one.id]);
    expect((await m.clients.listClients(a.orgId, { q: "stripes" })).map((x) => x.id)).toEqual([one.id]);
    // % is a literal, not a wildcard.
    expect(await m.clients.listClients(a.orgId, { q: "%" })).toEqual([]);
    await m.clients.setClientArchived(a.orgId, one.id, true);
    expect((await m.clients.listClients(a.orgId)).map((x) => x.id)).not.toContain(one.id);
    expect((await m.clients.listClients(a.orgId, { archived: true })).map((x) => x.id)).toContain(one.id);
  });

  it("counts what waits on the client and on the studio, per asset", async () => {
    const t = await c.tree(a.orgId, "image", { client: "Waiting Co" });
    await c.version(a.orgId, t.variationId); // in review
    const t2 = await c.tree(a.orgId, "image", { client: "Waiting Co 2" });
    await c.version(a.orgId, t2.variationId, { status: "changes_requested" });
    const rows = await m.clients.listClients(a.orgId);
    expect(rows.find((r) => r.id === t.clientId)).toMatchObject({ waitingOnClient: 1, waitingOnMe: 0, activeProjects: 1 });
    expect(rows.find((r) => r.id === t2.clientId)).toMatchObject({ waitingOnClient: 0, waitingOnMe: 1 });
  });
});

describe("projects and assets", () => {
  it("won't create under another org's client or project", async () => {
    const t = await c.tree(a.orgId);
    await expect(m.projects.createProject(b.orgId, t.clientId, { name: "P", roundsIncluded: 2 })).rejects.toThrow(/not found/);
    await expect(m.assets.createAsset(b.orgId, t.projectId, { title: "A", kind: "image" })).rejects.toThrow(/not found/);
    await expect(m.assets.addVariation(b.orgId, t.assetId, "Option B")).rejects.toThrow(/not found/);
    await expect(m.assets.renameVariation(b.orgId, t.variationId, "x")).rejects.toThrow(/not found/);
    await expect(m.assets.deleteAsset(b.orgId, t.assetId)).rejects.toThrow(/not found/);
    expect(await m.projects.getProject(b.orgId, t.projectId)).toBeNull();
    expect(await m.assets.assetDetail(b.orgId, t.assetId)).toBeNull();
  });

  it("validates project fields", async () => {
    const t = await c.tree(a.orgId);
    await expect(m.projects.createProject(a.orgId, t.clientId, { name: "", roundsIncluded: 2 })).rejects.toThrow(/name/);
    await expect(m.projects.createProject(a.orgId, t.clientId, { name: "P", roundsIncluded: -1 })).rejects.toThrow(/negative/);
    await expect(m.projects.createProject(a.orgId, t.clientId, { name: "P", roundsIncluded: 2, dueDate: "next week" })).rejects.toThrow(/due date/);
    const p = await m.projects.createProject(a.orgId, t.clientId, { name: "P", roundsIncluded: "3", dueDate: "2026-11-30" });
    expect(p).toMatchObject({ roundsIncluded: 3, dueDate: "2026-11-30", status: "active" });
  });

  it("a new asset starts with one option called Main; options are capped at six and the last can't go", async () => {
    const t = await c.tree(a.orgId);
    const made = await m.assets.createAsset(a.orgId, t.projectId, { title: "Poster", kind: "image" });
    expect(made.variation.label).toBe("Main");
    for (let i = 2; i <= 6; i++) await m.assets.addVariation(a.orgId, made.asset.id, `Option ${i}`);
    await expect(m.assets.addVariation(a.orgId, made.asset.id, "Seventh")).rejects.toThrow(/up to 6/);
    const detail = await m.assets.assetDetail(a.orgId, made.asset.id);
    expect(detail!.variations).toHaveLength(6);
    for (const v of detail!.variations.slice(1)) await m.assets.deleteVariation(a.orgId, v.id);
    await expect(m.assets.deleteVariation(a.orgId, made.variation.id)).rejects.toThrow(/at least one/);
  });

  it("rolls a project's status up from its assets, and shows rounds from its decisions", async () => {
    const t = await c.tree(a.orgId);
    const v = await c.version(a.orgId, t.variationId, { status: "approved" });
    let overview = await m.projects.projectOverview(a.orgId, t.projectId);
    expect(overview!.status).toBe("approved");
    expect(overview!.assets[0]).toMatchObject({ status: "approved", variationCount: 1 });
    expect(overview!.rounds.label).toBe("Round 1 of 2");
    await c.db.insert(c.schema.studioDecisions).values({ versionId: v.versionId, decision: "changes_requested", signedName: "Sam", email: "s@x.co", fileSha256: v.sha256 });
    overview = await m.projects.projectOverview(a.orgId, t.projectId);
    expect(overview!.rounds).toMatchObject({ used: 1, label: "Round 2 of 2" });
  });
});

describe("deleting takes the files with it", () => {
  it("deleting a version removes its file row and every blob", async () => {
    const t = await c.tree(a.orgId);
    const keep = await c.version(a.orgId, t.variationId);
    const gone = await c.version(a.orgId, t.variationId);
    const [row] = await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, gone.fileId));
    expect(await c.store.head(row!.originalKey!)).not.toBeNull();
    await m.assets.deleteVersion(a.orgId, gone.versionId);
    expect(await c.store.head(row!.originalKey!)).toBeNull();
    expect(await c.store.head(row!.previewKey!)).toBeNull();
    expect(await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, gone.fileId))).toHaveLength(0);
    expect(await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, keep.fileId))).toHaveLength(1);
  });

  it("refuses to delete a version that has a sign-off on record", async () => {
    const t = await c.tree(a.orgId);
    const v = await c.version(a.orgId, t.variationId, { status: "approved" });
    await c.db.insert(c.schema.studioDecisions).values({ versionId: v.versionId, decision: "approved", signedName: "Sam", email: "s@x.co", fileSha256: v.sha256 });
    await expect(m.assets.deleteVersion(a.orgId, v.versionId)).rejects.toThrow(/sign-off/);
  });

  it("deleting a client removes its whole tree and all its blobs, and not another client's", async () => {
    const t = await c.tree(a.orgId, "image", { client: "Doomed" });
    const other = await c.tree(a.orgId, "image", { client: "Survivor" });
    const v1 = await c.version(a.orgId, t.variationId);
    const v2 = await c.version(a.orgId, other.variationId);
    const [f1] = await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, v1.fileId));
    const [f2] = await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, v2.fileId));
    await m.clients.deleteClient(a.orgId, t.clientId);
    expect(await c.store.head(f1!.originalKey!)).toBeNull();
    expect(await c.store.head(f2!.originalKey!)).not.toBeNull();
    expect(await m.projects.getProject(a.orgId, t.projectId)).toBeNull();
    expect(await m.projects.getProject(a.orgId, other.projectId)).not.toBeNull();
  });

  it("deleting an asset or a project does the same", async () => {
    const t = await c.tree(a.orgId);
    const v = await c.version(a.orgId, t.variationId);
    const [f] = await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, v.fileId));
    await m.assets.deleteAsset(a.orgId, t.assetId);
    expect(await c.store.head(f!.originalKey!)).toBeNull();
    const t2 = await c.tree(a.orgId);
    const v2 = await c.version(a.orgId, t2.variationId);
    const [f2] = await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, v2.fileId));
    await m.projects.deleteProject(a.orgId, t2.projectId);
    expect(await c.store.head(f2!.originalKey!)).toBeNull();
  });
});

describe("shares (owner side)", () => {
  it("makes a link and a passcode that can be shown again, and keeps neither in the clear", async () => {
    const t = await c.tree(a.orgId);
    await c.version(a.orgId, t.variationId);
    const { share, token, passcode } = await c.share(a.orgId, a.memberId, t.projectId, [t.assetId]);
    expect(share.tokenHash).not.toContain(token);
    expect(share.tokenEnc).not.toContain(token);
    expect(share.passcodeEnc).not.toContain(passcode);
    expect(passcode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const found = await m.shares.getShare(a.orgId, share.id);
    expect(m.shares.shareSecrets(found!.share, "https://studio.test")).toMatchObject({ token, passcode, url: `https://studio.test/review/${token}` });
    expect(await m.shares.getShare(b.orgId, share.id)).toBeNull();
  });

  it("refuses assets from another project, none at all, and bad dates", async () => {
    const t = await c.tree(a.orgId);
    const other = await c.tree(a.orgId);
    await expect(c.share(a.orgId, a.memberId, t.projectId, [other.assetId])).rejects.toThrow(/isn't in this project/);
    await expect(c.share(a.orgId, a.memberId, t.projectId, [])).rejects.toThrow(/at least one/);
    await expect(c.share(a.orgId, a.memberId, t.projectId, [t.assetId], { expiresAt: "garbage" })).rejects.toThrow(/expiry/);
    await expect(c.share(b.orgId, b.memberId, t.projectId, [t.assetId])).rejects.toThrow(/not found/);
  });

  it("pins the versions that exist when the share is made", async () => {
    const t = await c.tree(a.orgId);
    const v1 = await c.version(a.orgId, t.variationId);
    const { share } = await c.share(a.orgId, a.memberId, t.projectId, [t.assetId], { versionMode: "pinned" });
    await c.version(a.orgId, t.variationId);
    const found = await m.shares.getShare(a.orgId, share.id);
    expect(found!.items[0]!.pinnedVersionIds).toEqual([v1.versionId]);
  });

  it("works out whether a link is live", () => {
    const now = new Date();
    expect(m.shares.shareState({ revokedAt: null, expiresAt: null }, now)).toBe("live");
    expect(m.shares.shareState({ revokedAt: null, expiresAt: new Date(now.getTime() + 1000) }, now)).toBe("live");
    expect(m.shares.shareState({ revokedAt: null, expiresAt: new Date(now.getTime() - 1000) }, now)).toBe("expired");
    expect(m.shares.shareState({ revokedAt: now, expiresAt: null }, now)).toBe("revoked");
  });
});

describe("brand", () => {
  it("falls back to the org name, validates, and saves", async () => {
    const x = await c.org("brandless");
    await c.db.delete(c.schema.studioBrand).where(eq(c.schema.studioBrand.orgId, x.orgId));
    expect((await m.brand.getBrand(x.orgId)).studioName).toContain("brandless");
    await expect(m.brand.saveBrand(x.orgId, { studioName: "", accentHex: "#fff", roomTheme: "light" })).rejects.toThrow(/name/);
    await expect(m.brand.saveBrand(x.orgId, { studioName: "S", accentHex: "red", roomTheme: "light" })).rejects.toThrow(/hex/);
    await expect(m.brand.saveBrand(x.orgId, { studioName: "S", accentHex: "#fff", roomTheme: "light", supportEmail: "nope" })).rejects.toThrow(/support email/);
    const saved = await m.brand.saveBrand(x.orgId, { studioName: "Dilhan Studio", accentHex: "F80", roomTheme: "auto", website: "dilhan.studio", supportEmail: "HELLO@dilhan.studio" });
    expect(saved).toMatchObject({ studioName: "Dilhan Studio", accentHex: "#ff8800", roomTheme: "auto", website: "https://dilhan.studio", supportEmail: "hello@dilhan.studio" });
  });
});
