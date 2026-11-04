/**
 * Logos, brand guides and paid delivery (planning/2026-10-31-tasset-deliverables): deliverables
 * attached to a version, checked by their first bytes, and released by the share's download policy,
 * including `after_payment`, which reads the linked invoice on every request.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { type Ctx, setup } from "./helpers";

vi.mock("server-only", () => ({}));

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) }),
  headers: async () => new Headers(),
}));

let c: Ctx;
let org: Awaited<ReturnType<Ctx["org"]>>;
let other: Awaited<ReturnType<Ctx["org"]>>;
let fileGET: typeof import("@/app/review/[token]/file/[fileId]/route").GET;
let deliverableGET: typeof import("@/app/review/[token]/deliverable/[fileId]/route").GET;
let blobGET: typeof import("@/app/api/dev-blob/[...key]/route").GET;
let access: typeof import("@/services/studio/access");
let del: typeof import("@/services/studio/deliverables");
let inv: typeof import("@/services/studio/invoices");
let shares: typeof import("@/services/studio/shares");

const SVG = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>';
const LINES = { projectId: null, issueDate: "2026-10-31", dueDate: "2026-11-30", lines: [{ description: "Logo design", qty: 1, unitCents: 90000 }], discount: null, notes: "" };

/** Attaches a deliverable the way the owner's browser does: start, PUT the bytes, finish. */
async function attach(orgId: string, versionId: string, name: string, body: string) {
  const s = await del.startDeliverableUpload(orgId, { versionId, name, bytes: Buffer.byteLength(body) });
  await c.put(s.key, body, s.mime);
  return { started: s, row: await del.finishDeliverable(orgId, { versionId, fileId: s.fileId }) };
}

async function issued(orgId: string, clientId: string) {
  const d = await inv.createInvoice(orgId, { clientId });
  await inv.updateDraft(orgId, d.id, LINES);
  return inv.issueInvoice(orgId, d.id, "You");
}

const setStatus = (versionId: string, status: "in_review" | "approved") => c.db.update(c.schema.studioVersions).set({ status }).where(eq(c.schema.studioVersions.id, versionId));

/** What signing in and asking the routes need of a fixture. */
type Fx = Pick<Awaited<ReturnType<typeof fixture>>, "share" | "token" | "passcode">;

/** A logo version with an SVG deliverable, an issued invoice for the client, and a share on it. */
async function fixture(over: Record<string, unknown> = {}) {
  const t = await c.tree(org.orgId, "image");
  const v = await c.version(org.orgId, t.variationId);
  const { row } = await attach(org.orgId, v.versionId, "primary-logo.svg", SVG);
  const invoice = await issued(org.orgId, t.clientId);
  const made = await c.share(org.orgId, org.memberId, t.projectId, [t.assetId], { downloadPolicy: "after_payment", invoiceId: invoice.id, ...over });
  return { t, v, row, invoice, ...made };
}

async function signIn(f: Fx) {
  const ok = await access.unlockShare(f.token, f.passcode, { ip: `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ua: "t" });
  const session = (await access.sessionFor(f.share, ok.sessionToken))!;
  await access.identify(f.share, session.id, { name: "Sam", email: `s${Math.random().toString(36).slice(2)}@x.co` });
  jar.clear();
  jar.set(access.sessionCookieName(f.share.id), ok.sessionToken);
}

const askFile = (f: Fx, fileId: string, q: string) => fileGET(new Request(`http://t/review/${f.token}/file/${fileId}${q}`), { params: Promise.resolve({ token: f.token, fileId }) });
const askDeliverable = (f: Fx, fileId: string) => deliverableGET(new Request(`http://t/review/${f.token}/deliverable/${fileId}`), { params: Promise.resolve({ token: f.token, fileId }) });

async function follow(res: Response): Promise<Response> {
  if (res.status !== 302) return res;
  const location = new URL(res.headers.get("location")!);
  const key = location.pathname.replace(/^\/api\/dev-blob\//, "").split("/");
  return blobGET(new Request(location), { params: Promise.resolve({ key }) });
}

beforeAll(async () => {
  c = await setup("deliver");
  org = await c.org("a");
  other = await c.org("b");
  access = await import("@/services/studio/access");
  del = await import("@/services/studio/deliverables");
  inv = await import("@/services/studio/invoices");
  shares = await import("@/services/studio/shares");
  fileGET = (await import("@/app/review/[token]/file/[fileId]/route")).GET;
  deliverableGET = (await import("@/app/review/[token]/deliverable/[fileId]/route")).GET;
  blobGET = (await import("@/app/api/dev-blob/[...key]/route")).GET;
});
afterAll(async () => c.cleanup());

describe("attaching deliverables", () => {
  it("checks the type by extension first, then by the bytes that arrived", async () => {
    const t = await c.tree(org.orgId);
    const v = await c.version(org.orgId, t.variationId);
    await expect(del.startDeliverableUpload(org.orgId, { versionId: v.versionId, name: "page.html", bytes: 10 })).rejects.toThrow(/isn't a type we deliver/);
    await expect(del.startDeliverableUpload(org.orgId, { versionId: v.versionId, name: "huge.zip", bytes: 201 * 1024 * 1024 })).rejects.toThrow(/200 MB/);
    await expect(del.startDeliverableUpload(other.orgId, { versionId: v.versionId, name: "a.svg", bytes: 10 })).rejects.toThrow(/not found/);

    const s = await del.startDeliverableUpload(org.orgId, { versionId: v.versionId, name: "fake.svg", bytes: 19 });
    expect(s.mime).toBe("image/svg+xml");
    await c.put(s.key, "<html><script>x</sc", s.mime);
    await expect(del.finishDeliverable(org.orgId, { versionId: v.versionId, fileId: s.fileId })).rejects.toThrow(/real SVG/);
    // A file that lied is gone, row and blob.
    expect(await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, s.fileId))).toEqual([]);
    expect(await c.store.head(s.key)).toBeNull();
  });

  it("lists them in order with a default label, and renames, reorders and deletes them", async () => {
    const t = await c.tree(org.orgId);
    const v = await c.version(org.orgId, t.variationId);
    const one = await attach(org.orgId, v.versionId, "primary-logo.svg", SVG);
    const two = await attach(org.orgId, v.versionId, "logo.eps", "%!PS-Adobe-3.0 EPSF-3.0\n");
    expect(one.row).toMatchObject({ label: "primary-logo — SVG", ext: "svg", mime: "image/svg+xml", sort: 0 });
    expect(two.row).toMatchObject({ label: "logo — EPS", sort: 1 });
    // Finishing twice answers with the same row.
    expect((await del.finishDeliverable(org.orgId, { versionId: v.versionId, fileId: one.started.fileId })).id).toBe(one.row.id);

    await del.renameDeliverable(org.orgId, two.row.id, "Logo — print EPS");
    await del.moveDeliverable(org.orgId, two.row.id, -1);
    expect((await del.listDeliverables([v.versionId])).map((d) => d.label)).toEqual(["Logo — print EPS", "primary-logo — SVG"]);
    await expect(del.renameDeliverable(other.orgId, two.row.id, "x")).rejects.toThrow(/not found/);

    await del.removeDeliverable(org.orgId, one.row.id);
    expect((await del.listDeliverables([v.versionId])).map((d) => d.fileId)).toEqual([two.started.fileId]);
    expect(await c.store.head(one.started.key)).toBeNull();
  });

  it("counts toward the storage meter", async () => {
    const x = await c.org("meter");
    const storage = await import("@/services/studio/storage");
    const t = await c.tree(x.orgId);
    const v = await c.version(x.orgId, t.variationId);
    const before = (await storage.storageUsed(x.orgId)).bytes;
    await attach(x.orgId, v.versionId, "logo.svg", SVG);
    expect((await storage.storageUsed(x.orgId)).bytes).toBe(before + SVG.length);
  });

  it("goes with its version: deleting the version removes the deliverable's file and blob", async () => {
    const t = await c.tree(org.orgId);
    const v = await c.version(org.orgId, t.variationId);
    const { started } = await attach(org.orgId, v.versionId, "logo.svg", SVG);
    await (await import("@/services/studio/assets")).deleteVersion(org.orgId, v.versionId);
    expect(await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, started.fileId))).toEqual([]);
    expect(await c.store.head(started.key)).toBeNull();
  });
});

describe("a share that waits on an invoice", () => {
  it("needs an issued or paid invoice for the project's client", async () => {
    const t = await c.tree(org.orgId);
    await c.version(org.orgId, t.variationId);
    await expect(c.share(org.orgId, org.memberId, t.projectId, [t.assetId], { downloadPolicy: "after_payment" })).rejects.toThrow(/Pick the invoice/);
    const draft = await inv.createInvoice(org.orgId, { clientId: t.clientId });
    await expect(c.share(org.orgId, org.memberId, t.projectId, [t.assetId], { downloadPolicy: "after_payment", invoiceId: draft.id })).rejects.toThrow(/draft/);
    const elsewhere = await c.tree(org.orgId, "image", { client: "Other client" });
    const theirs = await issued(org.orgId, elsewhere.clientId);
    await expect(c.share(org.orgId, org.memberId, t.projectId, [t.assetId], { downloadPolicy: "after_payment", invoiceId: theirs.id })).rejects.toThrow(/isn't for this client/);
    const mine = await issued(org.orgId, t.clientId);
    await inv.voidInvoice(org.orgId, mine.id, "You");
    await expect(c.share(org.orgId, org.memberId, t.projectId, [t.assetId], { downloadPolicy: "after_payment", invoiceId: mine.id })).rejects.toThrow(/void/);
    const ok = await issued(org.orgId, t.clientId);
    const { share } = await c.share(org.orgId, org.memberId, t.projectId, [t.assetId], { downloadPolicy: "after_payment", invoiceId: ok.id });
    expect(share.invoiceId).toBe(ok.id);
    expect((await shares.unlockInvoices(org.orgId, t.projectId)).map((i) => i.id)).toContain(ok.id);
  });

  it("forgets the invoice under any other policy", async () => {
    const f = await fixture();
    await shares.updateShare(org.orgId, f.share.id, { title: "R", message: "", notes: [], expiresAt: null, downloadPolicy: "after_approval", invoiceId: f.invoice.id, watermark: true, commentsOpen: true, versionMode: "latest", assetIds: [f.t.assetId] });
    const [row] = await c.db.select().from(c.schema.studioShares).where(eq(c.schema.studioShares.id, f.share.id));
    expect(row!.invoiceId).toBeNull();
  });

  it("keeps everything locked and marked until approved and paid; marking paid flips the deliverable from 403 to 302", async () => {
    const f = await fixture();
    await signIn(f);
    expect((await askDeliverable(f, f.row.fileId)).status).toBe(403);
    expect((await askFile(f, f.v.fileId, "?r=original")).status).toBe(403);

    await setStatus(f.v.versionId, "approved");
    // Approved but unpaid: still locked, and the preview is still the watermarked one.
    expect((await askDeliverable(f, f.row.fileId)).status).toBe(403);
    expect(await (await follow(await askFile(f, f.v.fileId, "?r=preview"))).text()).toBe("MARKED-PREVIEW");

    await inv.setInvoicePaid(org.orgId, f.invoice.id, true, "You");
    const res = await askDeliverable(f, f.row.fileId);
    expect(res.status).toBe(302);
    const got = await follow(res);
    expect(await got.text()).toBe(SVG);
    // Always a download, so an SVG is never opened inline.
    expect(got.headers.get("content-disposition")).toMatch(/attachment/);
    expect(await (await follow(await askFile(f, f.v.fileId, "?r=preview"))).text()).toBe("CLEAN-PREVIEW");
    expect(await (await follow(await askFile(f, f.v.fileId, "?r=original"))).text()).toBe("ORIGINAL");

    // Taking the payment back locks it again on the next request.
    await inv.setInvoicePaid(org.orgId, f.invoice.id, false, "You");
    expect((await askDeliverable(f, f.row.fileId)).status).toBe(403);
  });

  it("never unlocks on a void invoice", async () => {
    const f = await fixture();
    await setStatus(f.v.versionId, "approved");
    await inv.voidInvoice(org.orgId, f.invoice.id, "You");
    await signIn(f);
    expect((await askDeliverable(f, f.row.fileId)).status).toBe(403);
  });

  it("logs every download in the project activity, with who took what", async () => {
    const f = await fixture({ downloadPolicy: "always", invoiceId: null });
    await signIn(f);
    expect((await askDeliverable(f, f.row.fileId)).status).toBe(302);
    expect((await askFile(f, f.v.fileId, "?r=original&download=1")).status).toBe(302);
    const events = await c.db.select().from(c.schema.studioEvents).where(eq(c.schema.studioEvents.shareId, f.share.id));
    const downloads = events.filter((e) => e.type === "file.downloaded");
    expect(downloads).toHaveLength(2);
    expect(downloads.every((e) => e.actorLabel === "Sam")).toBe(true);
    const { describeEvent } = await import("@/services/studio/events");
    expect(downloads.map((e) => describeEvent(e))).toContain("Sam downloaded “primary-logo — SVG” on Banner · Main v1");
  });
});

describe("who may take a deliverable", () => {
  it("nobody without a session, and not a file from a version the share doesn't show", async () => {
    const f = await fixture({ downloadPolicy: "always", invoiceId: null });
    jar.clear();
    expect((await askDeliverable(f, f.row.fileId)).status).toBe(401);
    const g = await fixture({ downloadPolicy: "always", invoiceId: null });
    await signIn(f);
    expect((await askDeliverable(f, g.row.fileId)).status).toBe(404);
    // A version's own file isn't a deliverable.
    expect((await askDeliverable(f, f.v.fileId)).status).toBe(404);
  });

  it("not under policy none", async () => {
    const f = await fixture({ downloadPolicy: "none", invoiceId: null });
    await setStatus(f.v.versionId, "approved");
    await signIn(f);
    expect((await askDeliverable(f, f.row.fileId)).status).toBe(403);
  });
});

describe("the room's view", () => {
  it("lists each version's deliverables, and the flags follow payment", async () => {
    const f = await fixture();
    await setStatus(f.v.versionId, "approved");
    const room = await import("@/services/studio/room");
    const data = await import("@/services/studio/room-data");
    const content = await room.loadShareContent(f.share);
    const list = await del.listDeliverables([f.v.versionId]);
    const unpaid = data.toView(f.share, content, new Map(), { deliverables: list, paid: false })[0]!.variations[0]!.versions[0]!;
    expect(unpaid).toMatchObject({ marked: true, canDownload: false, deliverables: [{ fileId: f.row.fileId, label: "primary-logo — SVG", ext: "svg" }] });
    const paid = data.toView(f.share, content, new Map(), { deliverables: list, paid: true })[0]!.variations[0]!.versions[0]!;
    expect(paid).toMatchObject({ marked: false, canDownload: true });
  });
});

describe("brand guide documents in the room", () => {
  async function guide(over: Record<string, unknown>) {
    const t = await c.tree(org.orgId, "document");
    const v = await c.version(org.orgId, t.variationId, { mime: "application/pdf" });
    await c.db.update(c.schema.studioFiles).set({ pageCount: 3 }).where(eq(c.schema.studioFiles.id, v.fileId));
    const invoice = await issued(org.orgId, t.clientId);
    const made = await c.share(org.orgId, org.memberId, t.projectId, [t.assetId], { downloadPolicy: "after_payment", invoiceId: invoice.id, ...over });
    return { t, v, invoice, ...made };
  }

  it("serves the marked proof while unpaid, the clean proof once paid, and the real PDF only when allowed", async () => {
    const f = await guide({});
    await signIn(f);
    expect(await (await follow(await askFile(f, f.v.fileId, "?r=preview"))).text()).toBe("MARKED-PREVIEW");
    expect((await askFile(f, f.v.fileId, "?r=original")).status).toBe(403);
    await setStatus(f.v.versionId, "approved");
    expect(await (await follow(await askFile(f, f.v.fileId, "?r=preview"))).text()).toBe("MARKED-PREVIEW");
    expect((await askFile(f, f.v.fileId, "?r=original")).status).toBe(403);
    await inv.setInvoicePaid(org.orgId, f.invoice.id, true, "You");
    expect(await (await follow(await askFile(f, f.v.fileId, "?r=preview"))).text()).toBe("CLEAN-PREVIEW");
    expect(await (await follow(await askFile(f, f.v.fileId, "?r=original&download=1"))).text()).toBe("ORIGINAL");
  });

  it("keeps a pin's page within the guide", async () => {
    const f = await guide({ downloadPolicy: "none", invoiceId: null });
    const comments = await import("@/services/studio/comments");
    const scope = (await comments.ownerScope(org.orgId, f.v.versionId))!;
    expect(scope.pageCount).toBe(3);
    const author = { kind: "member" as const, memberId: org.memberId, label: "You" };
    await comments.addRoot(scope, author, { body: "Logo too small here", annotation: { v: 1, shape: "pin", x: 0.4, y: 0.4, page: 7 } });
    const threads = await comments.listThreads(scope, { memberId: org.memberId });
    expect(threads[0]!.annotation).toMatchObject({ page: 3 });
  });
});
