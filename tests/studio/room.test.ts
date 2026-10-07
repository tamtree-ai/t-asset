/** What a share shows: latest vs pinned, order, archived assets, and the watermark and download flags. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { type Ctx, setup } from "./helpers";

vi.mock("server-only", () => ({}));

let c: Ctx;
let org: Awaited<ReturnType<Ctx["org"]>>;
let room: typeof import("@/services/studio/room");
let data: typeof import("@/services/studio/room-data");

beforeAll(async () => {
  c = await setup("room");
  org = await c.org("a");
  room = await import("@/services/studio/room");
  data = await import("@/services/studio/room-data");
});
afterAll(async () => c.cleanup());

describe("what a share shows", () => {
  it("latest mode: every version up to the newest, oldest first, including ones added later", async () => {
    const t = await c.tree(org.orgId);
    await c.version(org.orgId, t.variationId);
    await c.version(org.orgId, t.variationId);
    const { share } = await c.share(org.orgId, org.memberId, t.projectId, [t.assetId]);
    let content = await room.loadShareContent(share);
    expect(content[0]!.variations[0]!.versions.map((v) => v.number)).toEqual([1, 2]);
    await c.version(org.orgId, t.variationId);
    content = await room.loadShareContent(share);
    expect(content[0]!.variations[0]!.versions.map((v) => v.number)).toEqual([1, 2, 3]);
  });

  it("pinned mode: stops at what was pinned, and hides an option added afterwards", async () => {
    const t = await c.tree(org.orgId);
    await c.version(org.orgId, t.variationId);
    const v2 = await c.version(org.orgId, t.variationId);
    const { share } = await c.share(org.orgId, org.memberId, t.projectId, [t.assetId], { versionMode: "pinned" });
    await c.version(org.orgId, t.variationId);
    const [optionB] = await c.db.insert(c.schema.studioVariations).values({ assetId: t.assetId, label: "Option B", sort: 1 }).returning();
    await c.version(org.orgId, optionB!.id);
    const content = await room.loadShareContent(share);
    expect(content[0]!.variations.map((v) => v.label)).toEqual(["Main"]);
    expect(content[0]!.variations[0]!.versions.map((v) => v.number)).toEqual([1, 2]);
    expect(room.findVersion(content, v2.versionId)).toMatchObject({ latest: true });
  });

  it("an option with nothing uploaded, and an archived asset, are left out", async () => {
    const t = await c.tree(org.orgId);
    await c.version(org.orgId, t.variationId);
    await c.db.insert(c.schema.studioVariations).values({ assetId: t.assetId, label: "Empty", sort: 1 });
    const [second] = await c.db.insert(c.schema.studioAssets).values({ projectId: t.projectId, title: "Hidden", kind: "image", sort: 1 }).returning();
    const [sv] = await c.db.insert(c.schema.studioVariations).values({ assetId: second!.id }).returning();
    await c.version(org.orgId, sv!.id);
    const { share } = await c.share(org.orgId, org.memberId, t.projectId, [t.assetId, second!.id]);
    await c.db.update(c.schema.studioAssets).set({ archivedAt: new Date() }).where(eq(c.schema.studioAssets.id, second!.id));
    const content = await room.loadShareContent(share);
    expect(content.map((a) => a.title)).toEqual(["Banner"]);
    expect(content[0]!.variations.map((v) => v.label)).toEqual(["Main"]);
  });

  it("keeps the order the owner chose for the assets", async () => {
    const t = await c.tree(org.orgId, "image", { asset: "First" });
    const [b] = await c.db.insert(c.schema.studioAssets).values({ projectId: t.projectId, title: "Second", kind: "image", sort: 1 }).returning();
    const [bv] = await c.db.insert(c.schema.studioVariations).values({ assetId: b!.id }).returning();
    await c.version(org.orgId, t.variationId);
    await c.version(org.orgId, bv!.id);
    const { share } = await c.share(org.orgId, org.memberId, t.projectId, [b!.id, t.assetId]);
    expect((await room.loadShareContent(share)).map((a) => a.title)).toEqual(["Second", "First"]);
  });

  it("finds a version or a file by id, and says nothing about ones outside the share", async () => {
    const t = await c.tree(org.orgId);
    const v = await c.version(org.orgId, t.variationId);
    const { share } = await c.share(org.orgId, org.memberId, t.projectId, [t.assetId]);
    const content = await room.loadShareContent(share);
    expect(room.findVersion(content, v.versionId)?.version.number).toBe(1);
    expect(room.findFile(content, v.fileId)?.version.id).toBe(v.versionId);
    expect(room.findVersion(content, "x")).toBeNull();
    expect(room.findFile(content, "x")).toBeNull();
    expect(room.whereLabel(room.findVersion(content, v.versionId)!)).toBe("Banner · Main v1");
  });
});

describe("watermark and download flags", () => {
  const share = (over: Partial<{ watermark: boolean; downloadPolicy: "none" | "after_approval" | "always" }> = {}) => ({ watermark: true, downloadPolicy: "after_approval" as const, ...over });
  it("watermarks until approved, when the share has it on", () => {
    expect(room.watermarked(share(), "in_review")).toBe(true);
    expect(room.watermarked(share(), "changes_requested")).toBe(true);
    expect(room.watermarked(share(), "approved")).toBe(false);
    expect(room.watermarked(share({ watermark: false }), "in_review")).toBe(false);
  });
  it("lets the original go by policy", () => {
    expect(room.canDownloadOriginal(share({ downloadPolicy: "none" }), "approved")).toBe(false);
    expect(room.canDownloadOriginal(share({ downloadPolicy: "after_approval" }), "in_review")).toBe(false);
    expect(room.canDownloadOriginal(share({ downloadPolicy: "after_approval" }), "approved")).toBe(true);
    expect(room.canDownloadOriginal(share({ downloadPolicy: "always" }), "in_review")).toBe(true);
  });
});

describe("the view the room renders", () => {
  it("carries each version's flags, the newest marked latest, and the last sign-off", async () => {
    const t = await c.tree(org.orgId);
    const v1 = await c.version(org.orgId, t.variationId, { status: "changes_requested" });
    const v2 = await c.version(org.orgId, t.variationId);
    await c.db.insert(c.schema.studioDecisions).values({ versionId: v1.versionId, decision: "changes_requested", signedName: "Sam", email: "s@x.co", fileSha256: v1.sha256 });
    const { share } = await c.share(org.orgId, org.memberId, t.projectId, [t.assetId]);
    const content = await room.loadShareContent(share);
    const signoffs = await data.latestSignoffs([v1.versionId, v2.versionId]);
    const [asset] = data.toView(share, content, signoffs);
    const [one, two] = asset!.variations[0]!.versions;
    expect([one!.latest, two!.latest]).toEqual([false, true]);
    expect([one!.marked, two!.marked]).toEqual([true, true]);
    expect([one!.canDownload, two!.canDownload]).toEqual([false, false]);
    expect(one!.signoff).toMatchObject({ decision: "changes_requested", name: "Sam" });
    expect(two!.signoff).toBeNull();
    expect(typeof one!.createdAt).toBe("string");
  });

  it("starts on the version in ?v=, else the first asset's newest", async () => {
    const t = await c.tree(org.orgId);
    const v1 = await c.version(org.orgId, t.variationId);
    const v2 = await c.version(org.orgId, t.variationId);
    const { share } = await c.share(org.orgId, org.memberId, t.projectId, [t.assetId]);
    const content = await room.loadShareContent(share);
    expect(data.initialSelection(content, v1.versionId)).toEqual({ assetId: t.assetId, variationId: t.variationId, versionId: v1.versionId });
    expect(data.initialSelection(content, undefined).versionId).toBe(v2.versionId);
    expect(data.initialSelection(content, "not-in-this-share").versionId).toBe(v2.versionId);
  });

  it("keeps the latest signoff per version, newest first", async () => {
    const t = await c.tree(org.orgId);
    const v = await c.version(org.orgId, t.variationId);
    await c.db.insert(c.schema.studioDecisions).values({ versionId: v.versionId, decision: "changes_requested", signedName: "Sam", email: "s@x.co", fileSha256: v.sha256, createdAt: new Date(Date.now() - 60_000) });
    await c.db.insert(c.schema.studioDecisions).values({ versionId: v.versionId, decision: "approved", signedName: "Sam Lee", email: "s@x.co", fileSha256: v.sha256 });
    const map = await data.latestSignoffs([v.versionId]);
    expect(map.get(v.versionId)).toMatchObject({ decision: "approved", name: "Sam Lee" });
    expect((await data.latestSignoffs([])).size).toBe(0);
  });
});
