/** Comment rules: two levels, quoting, numbering, internal notes, the edit window, hiding. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { type Ctx, setup } from "./helpers";

vi.mock("server-only", () => ({}));

let c: Ctx;
let org: Awaited<ReturnType<Ctx["org"]>>;
let versionId: string;
let t: Awaited<ReturnType<Ctx["tree"]>>;
let mod: typeof import("@/services/studio/comments");
let ownerScope: Awaited<ReturnType<typeof import("@/services/studio/comments").ownerScope>>;
let guestScope: NonNullable<Awaited<ReturnType<typeof import("@/services/studio/comments").guestScope>>>;
let reviewer: { id: string; name: string };
let reviewer2: { id: string; name: string };

const studio = () => ({ kind: "member" as const, memberId: org.memberId, label: "Dilhan" });
const sam = () => ({ kind: "reviewer" as const, reviewerId: reviewer.id, label: reviewer.name });
const kim = () => ({ kind: "reviewer" as const, reviewerId: reviewer2.id, label: reviewer2.name });
const pin = { v: 1, shape: "pin", x: 0.4, y: 0.6 };

beforeAll(async () => {
  c = await setup("comments");
  org = await c.org("a");
  t = await c.tree(org.orgId);
  versionId = (await c.version(org.orgId, t.variationId)).versionId;
  mod = await import("@/services/studio/comments");
  const { share } = await c.share(org.orgId, org.memberId, t.projectId, [t.assetId]);
  const [r1] = await c.db.insert(c.schema.studioReviewers).values({ shareId: share.id, name: "Sam", email: "sam@x.co" }).returning();
  const [r2] = await c.db.insert(c.schema.studioReviewers).values({ shareId: share.id, name: "Kim", email: "kim@x.co" }).returning();
  reviewer = r1!;
  reviewer2 = r2!;
  ownerScope = await mod.ownerScope(org.orgId, versionId);
  guestScope = (await mod.guestScope(share, versionId))!;
});
afterAll(async () => c.cleanup());

describe("scopes", () => {
  it("an owner scope exists only inside the org, and a guest scope only for versions the share shows", async () => {
    expect(ownerScope).not.toBeNull();
    const other = await c.org("b");
    expect(await mod.ownerScope(other.orgId, versionId)).toBeNull();
    expect(await mod.ownerScope(org.orgId, "not-a-uuid")).toBeNull();
    const t2 = await c.tree(org.orgId);
    const v2 = await c.version(org.orgId, t2.variationId);
    const { share } = await c.share(org.orgId, org.memberId, t.projectId, [t.assetId]);
    expect(await mod.guestScope(share, v2.versionId)).toBeNull();
    expect(guestScope).toMatchObject({ internalAllowed: false, commentsOpen: true });
    expect(ownerScope).toMatchObject({ internalAllowed: true });
  });
});

describe("roots", () => {
  it("numbers per version from 1, and keeps numbers when a comment is hidden", async () => {
    const one = await mod.addRoot(guestScope, sam(), { body: "Logo bigger", annotation: pin });
    const two = await mod.addRoot(guestScope, kim(), { body: "Colour is off" });
    expect([one.number, two.number]).toEqual([1, 2]);
    await mod.hideComment(ownerScope!, "Dilhan", two.id);
    const three = await mod.addRoot(guestScope, sam(), { body: "Third" });
    expect(three.number).toBe(3);
  });

  it("stores a clamped annotation, and refuses a bad one", async () => {
    const row = await mod.addRoot(guestScope, sam(), { body: "x", annotation: { v: 1, shape: "pin", x: 9, y: -3 } });
    expect(row.annotation).toMatchObject({ x: 1, y: 0 });
    await expect(mod.addRoot(guestScope, sam(), { body: "x", annotation: { v: 1, shape: "blob", x: 0, y: 0 } })).rejects.toThrow();
  });

  it("refuses an empty or oversized body, and trims", async () => {
    await expect(mod.addRoot(guestScope, sam(), { body: "   " })).rejects.toThrow(/Write a comment/);
    await expect(mod.addRoot(guestScope, sam(), { body: "x".repeat(4001) })).rejects.toThrow(/4000/);
    expect((await mod.addRoot(guestScope, sam(), { body: "  hi  " })).body).toBe("hi");
  });

  it("stores no html transformation: the text is kept as typed", async () => {
    const row = await mod.addRoot(guestScope, sam(), { body: "<b>bold</b> & <script>x</script>" });
    expect(row.body).toBe("<b>bold</b> & <script>x</script>");
  });

  it("only the studio may leave an internal comment, and guests never see it", async () => {
    await expect(mod.addRoot(guestScope, sam(), { body: "secret", internal: true })).rejects.toThrow(/Only the studio/);
    const internal = await mod.addRoot(ownerScope!, studio(), { body: "client is difficult", internal: true });
    expect(internal.internal).toBe(true);
    const asGuest = await mod.listThreads(guestScope, { reviewerId: reviewer.id });
    expect(asGuest.map((x) => x.body)).not.toContain("client is difficult");
    const asOwner = await mod.listThreads(ownerScope!, { memberId: org.memberId });
    expect(asOwner.map((x) => x.body)).toContain("client is difficult");
    // …and a guest can't reply to, resolve or hide what they can't see.
    await expect(mod.addReply(guestScope, sam(), { parentId: internal.id, body: "peek" })).rejects.toThrow(/not found/);
    await expect(mod.setResolved(guestScope, internal.id, "Sam", true)).rejects.toThrow(/not found/);
  });

  it("pauses comments when the share says so, for roots and replies", async () => {
    const root = await mod.addRoot(guestScope, sam(), { body: "before pause" });
    const paused = { ...guestScope, commentsOpen: false };
    await expect(mod.addRoot(paused, sam(), { body: "nope" })).rejects.toThrow(/paused/);
    await expect(mod.addReply(paused, sam(), { parentId: root.id, body: "nope" })).rejects.toThrow(/paused/);
  });
});

describe("replies", () => {
  it("go one level deep: a reply to a reply is refused", async () => {
    const root = await mod.addRoot(guestScope, sam(), { body: "root" });
    const reply = await mod.addReply(ownerScope!, studio(), { parentId: root.id, body: "reply" });
    expect(reply).toMatchObject({ parentId: root.id, number: null, annotation: null });
    await expect(mod.addReply(guestScope, sam(), { parentId: reply.id, body: "deeper" })).rejects.toThrow(/not on another reply/);
  });

  it("can quote another reply in the same thread, and no other", async () => {
    const root = await mod.addRoot(guestScope, sam(), { body: "root" });
    const r1 = await mod.addReply(ownerScope!, studio(), { parentId: root.id, body: "first" });
    const r2 = await mod.addReply(guestScope, sam(), { parentId: root.id, quoteId: r1.id, body: "second" });
    expect(r2.quoteId).toBe(r1.id);
    const elsewhere = await mod.addRoot(guestScope, sam(), { body: "other thread" });
    const stray = await mod.addReply(ownerScope!, studio(), { parentId: elsewhere.id, body: "stray" });
    await expect(mod.addReply(guestScope, sam(), { parentId: root.id, quoteId: stray.id, body: "x" })).rejects.toThrow(/same thread/);
    await expect(mod.addReply(guestScope, sam(), { parentId: root.id, quoteId: root.id, body: "x" })).rejects.toThrow(/same thread/);
    const threads = await mod.listThreads(guestScope, { reviewerId: reviewer.id });
    const thread = threads.find((x) => x.id === root.id)!;
    expect(thread.replies.map((r) => r.body)).toEqual(["first", "second"]);
    expect(thread.replies[1]!.quote).toMatchObject({ authorLabel: "Dilhan", excerpt: "first" });
  });

  it("the database also refuses a reply that carries an annotation or a number", async () => {
    const root = await mod.addRoot(guestScope, sam(), { body: "root" });
    await expect(c.db.insert(c.schema.studioComments).values({ versionId, parentId: root.id, number: 99, authorLabel: "x", body: "x" })).rejects.toThrow();
    await expect(c.db.insert(c.schema.studioComments).values({ versionId, parentId: root.id, annotation: pin, authorLabel: "x", body: "x" })).rejects.toThrow();
    await expect(c.db.insert(c.schema.studioComments).values({ versionId, quoteId: root.id, number: 98, authorLabel: "x", body: "x" })).rejects.toThrow();
    await expect(c.db.insert(c.schema.studioComments).values({ versionId, authorLabel: "x", body: "no number" })).rejects.toThrow();
  });

  it("a reply to a hidden or missing comment is refused", async () => {
    const root = await mod.addRoot(guestScope, sam(), { body: "root" });
    await mod.hideComment(ownerScope!, "Dilhan", root.id);
    await expect(mod.addReply(guestScope, sam(), { parentId: root.id, body: "late" })).rejects.toThrow(/not found/);
    await expect(mod.addReply(guestScope, sam(), { parentId: "00000000-0000-0000-0000-000000000000", body: "x" })).rejects.toThrow(/not found/);
  });
});

describe("resolve, edit, delete, hide", () => {
  it("resolves and reopens a root with who did it; replies can't be resolved", async () => {
    const root = await mod.addRoot(guestScope, sam(), { body: "to resolve" });
    const reply = await mod.addReply(guestScope, sam(), { parentId: root.id, body: "r" });
    await mod.setResolved(ownerScope!, root.id, "Dilhan", true);
    let t1 = (await mod.listThreads(guestScope, { reviewerId: reviewer.id })).find((x) => x.id === root.id)!;
    expect(t1).toMatchObject({ resolved: true, resolvedByLabel: "Dilhan" });
    await mod.setResolved(guestScope, root.id, "Sam", false);
    t1 = (await mod.listThreads(guestScope, { reviewerId: reviewer.id })).find((x) => x.id === root.id)!;
    expect(t1.resolved).toBe(false);
    await expect(mod.setResolved(guestScope, reply.id, "Sam", true)).rejects.toThrow(/not found/);
  });

  it("only the author edits, and only within ten minutes", async () => {
    const root = await mod.addRoot(guestScope, sam(), { body: "typo" });
    await mod.editComment(guestScope, sam(), root.id, "fixed");
    const edited = (await c.db.select().from(c.schema.studioComments).where(eq(c.schema.studioComments.id, root.id)))[0]!;
    expect(edited.body).toBe("fixed");
    expect(edited.editedAt).not.toBeNull();
    await expect(mod.editComment(guestScope, kim(), root.id, "hijack")).rejects.toThrow(/your own/);
    await expect(mod.editComment(ownerScope!, studio(), root.id, "hijack")).rejects.toThrow(/your own/);
    await expect(mod.editComment(guestScope, sam(), root.id, "late", new Date(Date.now() + 11 * 60_000))).rejects.toThrow(/10 minutes/);
    await expect(mod.editComment(guestScope, sam(), root.id, "  ")).rejects.toThrow(/Write a comment/);
  });

  it("an author deletes their own for ten minutes, unless others replied", async () => {
    const lone = await mod.addRoot(guestScope, sam(), { body: "oops" });
    await expect(mod.deleteOwn(guestScope, kim(), lone.id)).rejects.toThrow(/your own/);
    await expect(mod.deleteOwn(guestScope, sam(), lone.id, new Date(Date.now() + 11 * 60_000))).rejects.toThrow(/10 minutes/);
    await mod.deleteOwn(guestScope, sam(), lone.id);
    expect((await mod.listThreads(guestScope, { reviewerId: reviewer.id })).map((x) => x.id)).not.toContain(lone.id);

    const busy = await mod.addRoot(guestScope, sam(), { body: "busy" });
    await mod.addReply(ownerScope!, studio(), { parentId: busy.id, body: "answer" });
    await expect(mod.deleteOwn(guestScope, sam(), busy.id)).rejects.toThrow(/replied/);
  });

  it("only the owner hides, anyone's comment, and it shows in the activity log", async () => {
    const root = await mod.addRoot(guestScope, sam(), { body: "rude" });
    await expect(mod.hideComment(guestScope, "Sam", root.id)).rejects.toThrow(/Only the studio/);
    await mod.hideComment(ownerScope!, "Dilhan", root.id);
    expect((await mod.listThreads(ownerScope!, { memberId: org.memberId })).map((x) => x.id)).not.toContain(root.id);
    const events = await c.db.select().from(c.schema.studioEvents).where(eq(c.schema.studioEvents.orgId, org.orgId));
    expect(events.some((e) => e.type === "comment.hidden" && e.payload.commentId === root.id)).toBe(true);
  });

  it("marks which comments the viewer may still edit", async () => {
    const root = await mod.addRoot(guestScope, sam(), { body: "mine" });
    const asSam = (await mod.listThreads(guestScope, { reviewerId: reviewer.id })).find((x) => x.id === root.id)!;
    const asKim = (await mod.listThreads(guestScope, { reviewerId: reviewer2.id })).find((x) => x.id === root.id)!;
    expect([asSam.canEdit, asKim.canEdit]).toEqual([true, false]);
    const later = (await mod.listThreads(guestScope, { reviewerId: reviewer.id }, new Date(Date.now() + 11 * 60_000))).find((x) => x.id === root.id)!;
    expect(later.canEdit).toBe(false);
  });

  it("logs events for client-visible changes, never for internal ones", async () => {
    const before = (await c.db.select().from(c.schema.studioEvents).where(eq(c.schema.studioEvents.orgId, org.orgId))).length;
    await mod.addRoot(ownerScope!, studio(), { body: "private note", internal: true });
    expect((await c.db.select().from(c.schema.studioEvents).where(eq(c.schema.studioEvents.orgId, org.orgId))).length).toBe(before);
    await mod.addRoot(guestScope, sam(), { body: "public one" });
    const events = await c.db.select().from(c.schema.studioEvents).where(eq(c.schema.studioEvents.orgId, org.orgId));
    expect(events.length).toBe(before + 1);
    expect(events.some((e) => e.type === "comment.added" && e.actorLabel === "Sam" && e.payload.excerpt === "public one" && e.payload.byStudio === false)).toBe(true);
  });
});
