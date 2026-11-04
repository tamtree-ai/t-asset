/** Internal drafts: guests never see them, the owner's queue lists them, and a release shows them. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { type Ctx, setup } from "./helpers";

vi.mock("server-only", () => ({}));

let c: Ctx;
let org: Awaited<ReturnType<Ctx["org"]>>;
let other: Awaited<ReturnType<Ctx["org"]>>;
let room: typeof import("@/services/studio/room");
let release: typeof import("@/services/studio/release");

beforeAll(async () => {
  c = await setup("release");
  org = await c.org("a");
  other = await c.org("b");
  room = await import("@/services/studio/room");
  release = await import("@/services/studio/release");
});
afterAll(async () => c.cleanup());

const internal = (versionId: string) => c.db.update(c.schema.studioVersions).set({ releasedAt: null, meta: { source: "shorts", why: "Works cold." } }).where(eq(c.schema.studioVersions.id, versionId));

describe("internal drafts", () => {
  it("a guest sees only released versions, and sees a draft once it is released", async () => {
    const t = await c.tree(org.orgId, "video");
    await c.version(org.orgId, t.variationId, { mime: "video/mp4" });
    const draft = await c.version(org.orgId, t.variationId, { mime: "video/mp4" });
    await internal(draft.versionId);
    const { share } = await c.share(org.orgId, org.memberId, t.projectId, [t.assetId]);

    let content = await room.loadShareContent(share);
    expect(content[0]!.variations[0]!.versions.map((v) => v.number)).toEqual([1]);
    expect(room.findVersion(content, draft.versionId)).toBeNull();

    expect(await release.releaseVersions(org.orgId, [draft.versionId])).toBe(1);
    content = await room.loadShareContent(share);
    expect(content[0]!.variations[0]!.versions.map((v) => v.number)).toEqual([1, 2]);
  });

  it("an asset whose only version is internal is not in the room at all", async () => {
    const t = await c.tree(org.orgId, "video", { asset: "Short 1" });
    const draft = await c.version(org.orgId, t.variationId, { mime: "video/mp4" });
    await internal(draft.versionId);
    const { share } = await c.share(org.orgId, org.memberId, t.projectId, [t.assetId]);
    expect(await room.loadShareContent(share)).toEqual([]);
  });

  it("pinned mode never pins an internal draft", async () => {
    const t = await c.tree(org.orgId, "video");
    const v1 = await c.version(org.orgId, t.variationId, { mime: "video/mp4" });
    const draft = await c.version(org.orgId, t.variationId, { mime: "video/mp4" });
    await internal(draft.versionId);
    const { share } = await c.share(org.orgId, org.memberId, t.projectId, [t.assetId], { versionMode: "pinned" });
    await release.releaseVersions(org.orgId, [draft.versionId]);
    const content = await room.loadShareContent(share);
    expect(content[0]!.variations[0]!.versions.map((v) => v.id)).toEqual([v1.versionId]);
  });

  it("the queue lists the studio's own drafts with their notes; another studio can't release them", async () => {
    const t = await c.tree(org.orgId, "video", { client: "Why-Why Hill", project: "Shorts", asset: "Make a Wish" });
    const draft = await c.version(org.orgId, t.variationId, { mime: "video/mp4" });
    await internal(draft.versionId);

    const queue = await release.internalQueue(org.orgId);
    const item = queue.find((q) => q.versionId === draft.versionId);
    expect(item).toMatchObject({ assetTitle: "Make a Wish", clientName: "Why-Why Hill", projectName: "Shorts", meta: { why: "Works cold." } });
    expect((await release.internalQueue(other.orgId)).some((q) => q.versionId === draft.versionId)).toBe(false);

    expect(await release.releaseVersions(other.orgId, [draft.versionId])).toBe(0);
    expect((await release.internalQueue(org.orgId)).some((q) => q.versionId === draft.versionId)).toBe(true);

    await release.releaseVersions(org.orgId, [draft.versionId]);
    expect((await release.internalQueue(org.orgId)).some((q) => q.versionId === draft.versionId)).toBe(false);
  });

  it("unrelease takes a version back to internal", async () => {
    const t = await c.tree(org.orgId, "video");
    const v = await c.version(org.orgId, t.variationId, { mime: "video/mp4" });
    await release.unreleaseVersion(org.orgId, v.versionId);
    expect((await release.internalQueue(org.orgId)).some((q) => q.versionId === v.versionId)).toBe(true);
  });
});
