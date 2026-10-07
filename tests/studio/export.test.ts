/** Comment CSV and the certificate's data. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { type Ctx, setup } from "./helpers";

vi.mock("server-only", () => ({}));

let c: Ctx;
let org: Awaited<ReturnType<Ctx["org"]>>;
let other: Awaited<ReturnType<Ctx["org"]>>;
let exp: typeof import("@/services/studio/export");
let comments: typeof import("@/services/studio/comments");

beforeAll(async () => {
  c = await setup("export");
  org = await c.org("a");
  other = await c.org("b");
  exp = await import("@/services/studio/export");
  comments = await import("@/services/studio/comments");
});
afterAll(async () => c.cleanup());

/** A video version with a client comment at a frame, a reply, a resolved one and an internal one. */
async function fixture() {
  const t = await c.tree(org.orgId, "video", { project: "Spring Campaign", asset: "Launch teaser" });
  const v = await c.version(org.orgId, t.variationId, { mime: "video/mp4" });
  const { share } = await c.share(org.orgId, org.memberId, t.projectId, [t.assetId]);
  const [reviewer] = await c.db.insert(c.schema.studioReviewers).values({ shareId: share.id, name: "Sam", email: "sam@x.co" }).returning();
  const guest = (await comments.guestScope(share, v.versionId))!;
  const owner = (await comments.ownerScope(org.orgId, v.versionId))!;
  const sam = { kind: "reviewer" as const, reviewerId: reviewer!.id, label: "Sam" };
  const studio = { kind: "member" as const, memberId: org.memberId, label: "Dilhan" };
  return { t, v, guest, owner, sam, studio };
}

describe("comments csv", () => {
  it("has one row per root with where, when, who and the replies folded in", async () => {
    const f = await fixture();
    const root = await comments.addRoot(f.guest, f.sam, { body: "Logo too small, \"really\"", annotation: { v: 1, shape: "rect", x: 0.1, y: 0.2, w: 0.3, h: 0.4, t: 12.5, tEnd: 15, frame: 375 } });
    await comments.addReply(f.owner, f.studio, { parentId: root.id, body: "Fixed in v2" });
    await comments.addRoot(f.guest, f.sam, { body: "General thought" });
    await comments.addRoot(f.owner, f.studio, { body: "internal gripe", internal: true });
    await comments.setResolved(f.owner, root.id, "Dilhan", true);

    const { csv, name } = await exp.commentsCsv(org.orgId, { versionId: f.v.versionId });
    expect(name).toBe("Launch-teaser-Main-v1-comments.csv");
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toBe("Project,Asset,Option,Version,#,Status,Resolved by,Author,From,Posted,Where,Time,Time out,Frame,X,Y,Width,Height,Comment,Replies,Internal");
    expect(csv).toContain("Spring Campaign,Launch teaser,Main,v1,1,Resolved,Dilhan,Sam,Client,");
    expect(csv).toContain(",Box,0:12.15,0:15.00,375,0.1000,0.2000,0.3000,0.4000,");
    expect(csv).toContain('"Logo too small, ""really"""');
    expect(csv).toContain("Dilhan: Fixed in v2");
    expect(csv).toContain(",General,,,,,,,,General thought,");
    // Internal comments are exported too, but marked, since this export is for the studio.
    expect(csv).toContain("internal gripe");
    expect(csv).toContain(",Yes");
  });

  it("exports a whole project, and refuses another org's, an empty one, or no scope", async () => {
    const f = await fixture();
    await comments.addRoot(f.guest, f.sam, { body: "one" });
    const { csv } = await exp.commentsCsv(org.orgId, { projectId: f.t.projectId });
    expect(csv).toContain("one");
    await expect(exp.commentsCsv(other.orgId, { projectId: f.t.projectId })).rejects.toThrow(/Nothing to export/);
    await expect(exp.commentsCsv(other.orgId, { versionId: f.v.versionId })).rejects.toThrow(/Nothing to export/);
    await expect(exp.commentsCsv(org.orgId, {})).rejects.toThrow(/Say which/);
  });

  it("leaves hidden comments out, and can't be turned into a formula", async () => {
    const f = await fixture();
    const evil = await comments.addRoot(f.guest, f.sam, { body: "=HYPERLINK(\"http://evil\",\"click\")" });
    const gone = await comments.addRoot(f.guest, f.sam, { body: "hidden one" });
    await comments.hideComment(f.owner, "Dilhan", gone.id);
    const { csv } = await exp.commentsCsv(org.orgId, { versionId: f.v.versionId });
    expect(csv).not.toContain("hidden one");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/,=HYPERLINK/);
    void evil;
  });
});

describe("certificate data", () => {
  it("has the file, its fingerprint and every decision in order", async () => {
    const f = await fixture();
    await c.db.insert(c.schema.studioDecisions).values({ versionId: f.v.versionId, decision: "changes_requested", signedName: "Sam", email: "s@x.co", fileSha256: f.v.sha256, createdAt: new Date(Date.now() - 60_000) });
    await c.db.insert(c.schema.studioDecisions).values({ versionId: f.v.versionId, decision: "approved", signedName: "Sam Lee", email: "s@x.co", ip: "1.2.3.4", ua: "UA", fileSha256: f.v.sha256 });
    const data = (await exp.certificateData(org.orgId, f.v.versionId))!;
    expect(data).toMatchObject({ clientName: "Acme", asset: "Launch teaser", variation: "Main", assetId: f.t.assetId });
    expect(data.project.name).toBe("Spring Campaign");
    expect(data.file.sha256).toBe(f.v.sha256);
    expect(data.decisions.map((d) => d.decision)).toEqual(["changes_requested", "approved"]);
    expect(data.decisions[1]).toMatchObject({ signedName: "Sam Lee", ip: "1.2.3.4", fileSha256: f.v.sha256 });
  });

  it("is not available to another org", async () => {
    const f = await fixture();
    expect(await exp.certificateData(other.orgId, f.v.versionId)).toBeNull();
  });
});
