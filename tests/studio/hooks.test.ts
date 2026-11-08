/**
 * Hooks (planning/2026-10-07-tasset-workflow-hooks, adopted by planning/2026-11-08-review-loop §3):
 * queueing from logEvent, the envelope, signed push delivery and its retry schedule, the claim
 * that stops double sends, Send test and Redeliver, the pull feed, and the events the loop needs
 * (share.opened with its throttle, file.ready/failed, version.released). Internal comments never
 * leave.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyWebhook } from "@/lib/tamtree";

import { type Ctx, setup } from "./helpers";

vi.mock("server-only", () => ({}));
const afterFns: (() => unknown)[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => afterFns.push(fn) }));

const HOUR = 3600_000;

let c: Ctx;
let org: Awaited<ReturnType<Ctx["org"]>>;
let other: Awaited<ReturnType<Ctx["org"]>>;
let t: Awaited<ReturnType<Ctx["tree"]>>;
let versionId: string;
let hooks: typeof import("@/services/hooks/subscriptions");
let deliver: typeof import("@/services/hooks/deliver");
let events: typeof import("@/services/studio/events");
let comments: typeof import("@/services/studio/comments");
let feedGET: typeof import("@/app/api/hooks/[hookId]/events/route").GET;

type Call = { url: string; headers: Record<string, string>; body: string };
/** A receiver that answers with the next status in the list (the last one repeats), and records what it got. */
function receiver(...statuses: (number | "timeout")[]) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    const s = statuses[Math.min(calls.length - 1, statuses.length - 1)]!;
    if (s === "timeout") throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    return new Response(s === 200 ? '{"filtered":true}' : "no", { status: s });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

async function pushHook(events: string[], orgId = org.orgId) {
  const made = await hooks.createHook(orgId, { mode: "push", name: "push", events, url: "https://hooks.example.test/in" });
  return { ...made, secret: made.credential };
}

async function deliveriesOf(hookId: string) {
  return c.db.select().from(c.schema.hookDeliveries).where(eq(c.schema.hookDeliveries.subscriptionId, hookId));
}

const guest = (reviewerId: string, label: string) => ({ kind: "reviewer" as const, reviewerId, label });

let share: Awaited<ReturnType<Ctx["share"]>>["share"];
let reviewer: { id: string; name: string; email: string };

beforeAll(async () => {
  c = await setup("hooks");
  org = await c.org("a");
  other = await c.org("b");
  t = await c.tree(org.orgId, "image", { asset: "Banner" });
  versionId = (await c.version(org.orgId, t.variationId)).versionId;
  await c.db.update(c.schema.studioAssets).set({ externalRef: "tamshoot:p/1/banner" }).where(eq(c.schema.studioAssets.id, t.assetId));
  hooks = await import("@/services/hooks/subscriptions");
  deliver = await import("@/services/hooks/deliver");
  events = await import("@/services/studio/events");
  comments = await import("@/services/studio/comments");
  feedGET = (await import("@/app/api/hooks/[hookId]/events/route")).GET;
  share = (await c.share(org.orgId, org.memberId, t.projectId, [t.assetId])).share;
  const [r] = await c.db.insert(c.schema.studioReviewers).values({ shareId: share.id, name: "Sam Lee", email: "sam@acme.co" }).returning();
  reviewer = r!;
});
afterAll(async () => c.cleanup());
beforeEach(async () => {
  afterFns.length = 0;
  // Each test starts with no hooks, so one test's hook never queues another's event.
  await c.db.delete(c.schema.hookSubscriptions).where(eq(c.schema.hookSubscriptions.orgId, org.orgId));
});

describe("queueing", () => {
  it("queues one delivery per enabled push hook that wants the type, and sends it after the response", async () => {
    const wants = await pushHook(["comment.added"]);
    const not = await pushHook(["decision.approved"]);
    const off = await pushHook(["comment.added"]);
    await hooks.updateHook(org.orgId, off.hook.id, { enabled: false });
    const pull = await hooks.createHook(org.orgId, { mode: "pull", name: "pull", events: ["comment.added"] });
    const theirs = await pushHook(["comment.added"], other.orgId);

    const scope = (await comments.guestScope(share, versionId))!;
    await comments.addRoot(scope, guest(reviewer.id, reviewer.name), { body: "Logo bigger" });

    expect(await deliveriesOf(wants.hook.id)).toHaveLength(1);
    for (const h of [not, off, pull, theirs]) expect(await deliveriesOf(h.hook.id)).toHaveLength(0);
    expect(afterFns).toHaveLength(1);
  });

  it("never queues an internal comment, and logEvent returns the event id", async () => {
    const h = await pushHook(["comment.added", "comment.replied", "comment.resolved"]);
    const owner = (await comments.ownerScope(org.orgId, versionId))!;
    const root = await comments.addRoot(owner, { kind: "member", memberId: org.memberId, label: "Dilhan" }, { body: "note to self", internal: true });
    await comments.addReply(owner, { kind: "member", memberId: org.memberId, label: "Dilhan" }, { parentId: root.id, body: "still internal" });
    await comments.setResolved(owner, root.id, "Dilhan", true);
    expect(await deliveriesOf(h.hook.id)).toHaveLength(0);

    const id = await events.logEvent({ orgId: org.orgId, projectId: t.projectId, actorLabel: "You", type: "comment.resolved", payload: {} }, undefined, { dispatch: false });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(afterFns).toHaveLength(0);
    expect(await deliveriesOf(h.hook.id)).toMatchObject([{ eventId: id, status: "pending" }]);
  });
});

describe("push delivery", () => {
  it("POSTs a signed envelope Tamtree's verifier accepts, with asset, version, comment and reviewer", async () => {
    const h = await pushHook(["comment.added"]);
    const scope = (await comments.guestScope(share, versionId))!;
    const root = await comments.addRoot(scope, guest(reviewer.id, reviewer.name), { body: "Logo bigger, please", annotation: { v: 1, shape: "pin", x: 0.4, y: 0.6 } });
    const [d] = await deliveriesOf(h.hook.id);
    const r = receiver(200);
    const [sent] = await deliver.deliver([{ eventId: d!.eventId, subscriptionId: h.hook.id }], { fetcher: r.fetcher });

    expect(sent).toMatchObject({ status: "delivered", httpStatus: 200 });
    const call = r.calls[0]!;
    expect(call.url).toBe("https://hooks.example.test/in");
    expect(verifyWebhook(h.secret, call.headers["x-tamtree-timestamp"]!, call.body, call.headers["x-tamtree-signature"]!)).toBe(true);
    expect(call.headers).toMatchObject({ "x-tasset-event": "comment.added", "x-tasset-event-id": d!.eventId, "x-tasset-delivery-attempt": "1" });
    const env = JSON.parse(call.body);
    expect(env).toMatchObject({
      id: d!.eventId,
      type: "comment.added",
      v: 1,
      studio: { name: "Studio a", ownerEmail: org.email },
      project: { id: t.projectId, name: "Spring" },
      client: { name: "Acme" },
      share: { id: share.id },
      actor: { kind: "reviewer", name: "Sam Lee", email: "sam@acme.co" },
      asset: { id: t.assetId, title: "Banner", kind: "image", externalRef: "tamshoot:p/1/banner" },
      version: { id: versionId, number: 1 },
      comment: { id: root.id, number: root.number, parentId: null, body: "Logo bigger, please", annotation: { shape: "pin" } },
    });
    const [row] = await deliveriesOf(h.hook.id);
    expect(row).toMatchObject({ status: "delivered", attempts: 1, lastHttpStatus: 200 });
    expect((await hooks.getHook(org.orgId, h.hook.id)).lastSuccessAt).not.toBeNull();
  });

  it("backs off 1 h, 6 h, 24 h on a 503 or a timeout, then fails; a 401 fails at once and shows on the hook", async () => {
    const h = await pushHook(["comment.resolved"]);
    const eventId = await events.logEvent({ orgId: org.orgId, actorLabel: "You", type: "comment.resolved" }, undefined, { dispatch: false });
    const key = { eventId, subscriptionId: h.hook.id };
    const r = receiver(503, "timeout", 503, 503);
    let now = new Date();
    for (const [i, wait] of [HOUR, 6 * HOUR, 24 * HOUR].entries()) {
      const [s] = await deliver.deliver([key], { fetcher: r.fetcher, now });
      expect(s!.status).toBe("pending");
      const [row] = await deliveriesOf(h.hook.id);
      expect(row!.attempts).toBe(i + 1);
      expect(Math.abs(row!.nextAttemptAt!.getTime() - (Date.now() + wait))).toBeLessThan(60_000);
      // Not due yet: nothing is sent.
      expect(await deliver.deliver([key], { fetcher: r.fetcher, now })).toHaveLength(0);
      now = new Date(row!.nextAttemptAt!.getTime() + 1000);
    }
    const [last] = await deliver.deliver([key], { fetcher: r.fetcher, now });
    expect(last!.status).toBe("failed");
    expect(r.calls).toHaveLength(4);
    expect(r.calls.map((x) => x.headers["x-tasset-delivery-attempt"])).toEqual(["1", "2", "3", "4"]);

    const h2 = await pushHook(["comment.resolved"]);
    const e2 = await events.logEvent({ orgId: org.orgId, actorLabel: "You", type: "comment.resolved" }, undefined, { dispatch: false });
    const [refused] = await deliver.deliver([{ eventId: e2, subscriptionId: h2.hook.id }], { fetcher: receiver(401).fetcher });
    expect(refused).toMatchObject({ status: "failed", httpStatus: 401 });
    expect((await hooks.getHook(org.orgId, h2.hook.id)).lastError).toMatch(/signature/);
  });

  it("never sends the same delivery twice when the sweep and an after() race", async () => {
    const h = await pushHook(["comment.resolved"]);
    const eventId = await events.logEvent({ orgId: org.orgId, actorLabel: "You", type: "comment.resolved" }, undefined, { dispatch: false });
    const r = receiver(200);
    const key = { eventId, subscriptionId: h.hook.id };
    const both = await Promise.all([deliver.deliver([key], { fetcher: r.fetcher }), deliver.deliver([key], { fetcher: r.fetcher })]);
    expect(both.flat()).toHaveLength(1);
    expect(r.calls).toHaveLength(1);
  });

  it("Send test reaches only that hook; Redeliver sends a failed one again", async () => {
    const a = await pushHook(["comment.added"]);
    const b = await pushHook(["comment.added"]);
    const ok = receiver(200);
    expect(await hooks.sendTest(org.orgId, a.hook.id, "Dilhan", ok.fetcher)).toMatchObject({ status: "delivered" });
    expect(JSON.parse(ok.calls[0]!.body)).toMatchObject({ type: "test.ping", data: { subscriptionId: a.hook.id } });
    expect(await deliveriesOf(b.hook.id)).toHaveLength(0);

    const down = await hooks.sendTest(org.orgId, b.hook.id, "Dilhan", receiver(404).fetcher);
    expect(down).toMatchObject({ status: "failed", httpStatus: 404 });
    const back = await hooks.redeliver(org.orgId, b.hook.id, down!.eventId, receiver(200).fetcher);
    expect(back).toMatchObject({ status: "delivered" });
    await expect(hooks.redeliver(other.orgId, b.hook.id, down!.eventId)).rejects.toThrow(/not found/);
  });

  it("the sweep sends what is due", async () => {
    const h = await pushHook(["comment.resolved"]);
    await events.logEvent({ orgId: org.orgId, actorLabel: "You", type: "comment.resolved" }, undefined, { dispatch: false });
    const r = receiver(200);
    const swept = await deliver.sweepDeliveries(new Date(), r.fetcher);
    expect(swept.delivered).toBeGreaterThanOrEqual(1);
    expect((await deliveriesOf(h.hook.id))[0]!.status).toBe("delivered");
  });
});

describe("hooks settings service", () => {
  it("checks the input, keeps the secret sealed and the token hashed, and rotates", async () => {
    await expect(hooks.createHook(org.orgId, { mode: "push", name: "x", events: [], url: "https://a.example" })).rejects.toThrow();
    await expect(hooks.createHook(org.orgId, { mode: "push", name: "x", events: ["test.ping"], url: "https://a.example" })).rejects.toThrow();
    await expect(hooks.createHook(org.orgId, { mode: "push", name: "x", events: ["comment.added"], url: "nope" })).rejects.toThrow();
    const push = await pushHook(["comment.added"]);
    expect(push.secret).toMatch(/^whsec_/);
    expect(push.hook.secretEnc).not.toContain(push.secret);
    expect(hooks.secretOf(push.hook)).toBe(push.secret);
    const { credential } = await hooks.rotateCredential(org.orgId, push.hook.id);
    expect(credential).not.toBe(push.secret);
    expect(hooks.secretOf(await hooks.getHook(org.orgId, push.hook.id))).toBe(credential);
    await expect(hooks.getHook(other.orgId, push.hook.id)).rejects.toThrow(/not found/);
    const pull = await hooks.createHook(org.orgId, { mode: "pull", name: "pull", events: ["comment.added"] });
    expect(pull.credential).toMatch(/^ttf_/);
    expect(pull.hook.feedTokenHash).not.toBe(pull.credential);
  });
});

describe("the pull feed", () => {
  const read = (id: string, token?: string) => feedGET(new Request(`http://t/api/hooks/${id}/events`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), { params: Promise.resolve({ hookId: id }) });

  it("needs the hook's token, filters by type, starts at the hook's creation, and stamps last_polled_at", async () => {
    await events.logEvent({ orgId: org.orgId, actorLabel: "You", type: "decision.approved", payload: { versionId } }, undefined, { dispatch: false }); // before the hook: not in the feed
    const pull = await hooks.createHook(org.orgId, { mode: "pull", name: "pull", events: ["decision.approved"] });
    const other1 = await hooks.createHook(org.orgId, { mode: "pull", name: "other", events: ["decision.approved"] });
    const want = await events.logEvent({ orgId: org.orgId, actorLabel: "You", type: "decision.approved", payload: { versionId } }, undefined, { dispatch: false });
    await events.logEvent({ orgId: org.orgId, actorLabel: "You", type: "comment.resolved" }, undefined, { dispatch: false });
    await events.logEvent({ orgId: other.orgId, actorLabel: "You", type: "decision.approved" }, undefined, { dispatch: false });
    await hooks.sendTest(org.orgId, other1.hook.id, "Dilhan");
    const test = await hooks.sendTest(org.orgId, pull.hook.id, "Dilhan");
    expect(test).toBeNull();

    expect((await read(pull.hook.id)).status).toBe(401);
    expect((await read(pull.hook.id, other1.credential)).status).toBe(401);
    const res = await read(pull.hook.id, pull.credential);
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: { id: string; type: string; version: { id: string } | null }[] };
    expect(items.map((i) => i.type)).toEqual(["test.ping", "decision.approved"]);
    expect(items[1]).toMatchObject({ id: want, version: { id: versionId } });
    // The same read again returns the same ids: the reader dedupes.
    const again = (await (await read(pull.hook.id, pull.credential)).json()) as { items: { id: string }[] };
    expect(again.items.map((i) => i.id)).toEqual(items.map((i) => i.id));
    expect((await hooks.getHook(org.orgId, pull.hook.id)).lastPolledAt).not.toBeNull();

    await hooks.updateHook(org.orgId, pull.hook.id, { enabled: false });
    expect((await read(pull.hook.id, pull.credential)).status).toBe(403);
  });
});

describe("events the loop needs", () => {
  it("share.opened on every sign-in, at most once per reviewer in 30 minutes", async () => {
    const access = await import("@/services/studio/access");
    const { share: s, token, passcode } = await c.share(org.orgId, org.memberId, t.projectId, [t.assetId]);
    const signIn = async (name: string, email: string) => {
      const { sessionToken } = await access.unlockShare(token, passcode, { ip: `10.9.0.${Math.floor(Math.random() * 250)}`, ua: "t" });
      const session = (await access.sessionFor(s, sessionToken))!;
      return access.identify(s, session.id, { name, email });
    };
    const opened = async () => (await c.db.select().from(c.schema.studioEvents).where(eq(c.schema.studioEvents.shareId, s.id))).filter((e) => e.type === "share.opened");

    const kim = await signIn("Kim", "kim@acme.co");
    await signIn("Kim", "kim@acme.co");
    await signIn("Ana", "ana@acme.co");
    const rows = await opened();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.payload.reviewerId === kim.id)!.payload).toMatchObject({ firstVisit: true });
    // Over 30 minutes later, the same person counts again.
    await c.db.update(c.schema.studioEvents).set({ createdAt: new Date(Date.now() - 31 * 60_000) }).where(eq(c.schema.studioEvents.shareId, s.id));
    await signIn("Kim", "kim@acme.co");
    const after = await opened();
    expect(after).toHaveLength(3);
    expect(after.filter((r) => r.payload.reviewerId === kim.id).some((r) => r.payload.firstVisit === false)).toBe(true);
  });

  it("file.ready and file.failed carry the version; version.released lists its versions", async () => {
    const tamtree = await import("@/services/studio/tamtree");
    const { outputsFor } = await import("@/lib/tamtree");
    const h = await pushHook(["file.ready", "file.failed", "version.released"]);

    const ready = await c.version(org.orgId, t.variationId);
    await c.db.update(c.schema.studioFiles).set({ processing: "pending" }).where(eq(c.schema.studioFiles.id, ready.fileId));
    const outputs: Record<string, { key: string }> = {};
    for (const o of outputsFor(ready.fileId, "image")) {
      await c.put(o.key, o.name, o.contentType);
      outputs[o.name] = { key: o.key };
    }
    await tamtree.complete(ready.fileId, { sha256: ready.sha256, width: 10, height: 10, outputs });

    const failed = await c.version(org.orgId, t.variationId);
    await c.db.update(c.schema.studioFiles).set({ processing: "pending" }).where(eq(c.schema.studioFiles.id, failed.fileId));
    await tamtree.fail(failed.fileId, { message: "Corrupt file", retryable: false });

    const internal = await c.version(org.orgId, t.variationId);
    await c.db.update(c.schema.studioVersions).set({ releasedAt: null }).where(eq(c.schema.studioVersions.id, internal.versionId));
    const { releaseVersions } = await import("@/services/studio/release");
    await releaseVersions(org.orgId, [internal.versionId]);

    const r = receiver(200);
    await deliver.deliver((await deliveriesOf(h.hook.id)).map((d) => ({ eventId: d.eventId, subscriptionId: h.hook.id })), { fetcher: r.fetcher });
    const got = Object.fromEntries(r.calls.map((x) => JSON.parse(x.body)).map((e) => [e.type, e]));
    expect(got["file.ready"]).toMatchObject({ actor: { kind: "system" }, version: { id: ready.versionId }, asset: { id: t.assetId }, data: { fileId: ready.fileId } });
    expect(got["file.failed"]).toMatchObject({ version: { id: failed.versionId }, data: { error: "Corrupt file" } });
    expect(got["version.released"]).toMatchObject({ version: { id: internal.versionId, released: true }, data: { versions: [{ id: internal.versionId, asset: { id: t.assetId } }] } });
  });
});
