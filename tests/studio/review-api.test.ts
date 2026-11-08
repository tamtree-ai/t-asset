/**
 * The Review API (planning/2026-11-08-review-loop, design §2), through its route handlers: tokens
 * and scopes, org isolation, idempotent creates by externalRef, the file upload round trip,
 * builtFrom, comments and studio replies, and the refusals (401/403/404/409/413/422/429).
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { type Ctx, setup } from "./helpers";

vi.mock("server-only", () => ({}));
const afterFns: (() => unknown)[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => afterFns.push(fn) }));

let c: Ctx;
let org: Awaited<ReturnType<Ctx["org"]>>;
let other: Awaited<ReturnType<Ctx["org"]>>;
let tokens: typeof import("@/services/studio/api-tokens");
let R: {
  projects: typeof import("@/app/api/v1/projects/route");
  assets: typeof import("@/app/api/v1/assets/route");
  versions: typeof import("@/app/api/v1/assets/[assetId]/versions/route");
  version: typeof import("@/app/api/v1/versions/[versionId]/route");
  complete: typeof import("@/app/api/v1/versions/[versionId]/complete/route");
  release: typeof import("@/app/api/v1/versions/[versionId]/release/route");
  comments: typeof import("@/app/api/v1/versions/[versionId]/comments/route");
  replies: typeof import("@/app/api/v1/comments/[commentId]/replies/route");
};
let blobPUT: typeof import("@/app/api/dev-blob/[...key]/route").PUT;
let token: string;
let readOnly: string;
let otherToken: string;

beforeAll(async () => {
  c = await setup("reviewapi");
  org = await c.org("a");
  other = await c.org("b");
  tokens = await import("@/services/studio/api-tokens");
  R = {
    projects: await import("@/app/api/v1/projects/route"),
    assets: await import("@/app/api/v1/assets/route"),
    versions: await import("@/app/api/v1/assets/[assetId]/versions/route"),
    version: await import("@/app/api/v1/versions/[versionId]/route"),
    complete: await import("@/app/api/v1/versions/[versionId]/complete/route"),
    release: await import("@/app/api/v1/versions/[versionId]/release/route"),
    comments: await import("@/app/api/v1/versions/[versionId]/comments/route"),
    replies: await import("@/app/api/v1/comments/[commentId]/replies/route"),
  };
  blobPUT = (await import("@/app/api/dev-blob/[...key]/route")).PUT;
  token = (await tokens.createApiToken(org.orgId, { name: "tamshoot", scopes: ["review:read", "review:write"] })).token;
  readOnly = (await tokens.createApiToken(org.orgId, { name: "reader", scopes: ["review:read"] })).token;
  otherToken = (await tokens.createApiToken(other.orgId, { name: "other", scopes: ["review:read", "review:write"] })).token;
});
afterAll(async () => c.cleanup());
// A fresh write token per test, so no test meets the 60-a-minute limit made by the others.
let tokenId = "";
beforeEach(async () => {
  const made = await tokens.createApiToken(org.orgId, { name: "per-test", scopes: ["review:read", "review:write"] });
  token = made.token;
  tokenId = made.row.id;
});
afterEach(async () => tokens.revokeApiToken(org.orgId, tokenId));

const req = (method: string, path: string, body?: unknown, t: string | null = token) =>
  new Request(`http://t/api/v1${path}`, { method, headers: { ...(t ? { authorization: `Bearer ${t}` } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
const p = <K extends string>(k: K, v: string) => ({ params: Promise.resolve({ [k]: v } as Record<K, string>) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test responses are read loosely
type Loose = Record<string, any>;
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Loose });

async function project(t = token) {
  return json(await R.projects.PUT(req("PUT", "/projects", { client: `Acme ${randomUUID().slice(0, 6)}`, project: "Spring" }, t)));
}
async function asset(projectId: string, kind = "video", ref = `ref:${randomUUID()}`, t = token) {
  return json(await R.assets.PUT(req("PUT", "/assets", { projectId, title: "Skit 1", kind, externalRef: ref }, t)));
}
const file = (bytes = 8) => ({ name: "cut.mp4", contentType: "video/mp4", bytes });
async function newVersion(assetId: string, body: Record<string, unknown>, t = token) {
  return json(await R.versions.POST(req("POST", `/assets/${assetId}/versions`, body, t), p("assetId", assetId)));
}
/** PUTs the bytes to the upload target, as a producer would. */
async function upload(target: { url: string; headers: Record<string, string> }, text: string) {
  const url = new URL(target.url);
  const key = url.pathname.replace(/^\/api\/dev-blob\//, "").split("/");
  return blobPUT(new Request(url, { method: "PUT", headers: target.headers, body: text }), { params: Promise.resolve({ key }) });
}
const complete = async (id: string, t = token) => json(await R.complete.POST(req("POST", `/versions/${id}/complete`, undefined, t), p("versionId", id)));
const getV = async (id: string, t = token) => json(await R.version.GET(req("GET", `/versions/${id}`, undefined, t), p("versionId", id)));

/** A video version all the way to `pending` (bytes uploaded, completed). */
async function uploadedVersion(assetId: string, extra: Record<string, unknown> = {}) {
  const made = await newVersion(assetId, { externalRef: `v:${randomUUID()}`, file: file(8), ...extra });
  expect(made.status).toBe(201);
  expect((await upload(made.body.upload, "12345678")).status).toBe(200);
  const done = await complete(made.body.versionId);
  expect(done.status).toBe(200);
  return made.body.versionId as string;
}

describe("tokens", () => {
  it("no token, a bad token and a revoked token are 401; a read token can't write (403)", async () => {
    expect((await project(null as unknown as string)).status).toBe(401);
    expect((await json(await R.projects.PUT(req("PUT", "/projects", { client: "a", project: "b" }, null)))).body.code).toBe("unauthorized");
    expect((await project("tt_live_nope")).status).toBe(401);
    expect((await project(readOnly)).status).toBe(403);

    const made = await tokens.createApiToken(org.orgId, { name: "temp", scopes: ["review:write"] });
    expect((await project(made.token)).status).toBe(201);
    await tokens.revokeApiToken(org.orgId, made.row.id);
    expect((await project(made.token)).status).toBe(401);
  });

  it("stores only the hash and the last four characters, and records use", async () => {
    const made = await tokens.createApiToken(org.orgId, { name: "hash", scopes: ["review:read"] });
    expect(made.token).toMatch(/^tt_live_/);
    expect(made.row.tokenHash).not.toContain(made.token);
    expect(made.row.tokenHint).toBe(made.token.slice(-4));
    expect(await tokens.callerFor(`Bearer ${made.token}`)).toMatchObject({ orgId: org.orgId, scopes: ["review:read"] });
    const [row] = await c.db.select().from(c.schema.studioApiTokens).where(eq(c.schema.studioApiTokens.id, made.row.id));
    expect(row!.lastUsedAt).not.toBeNull();
  });

  it("refuses a token with no scopes, and another org's revoke", async () => {
    await expect(tokens.createApiToken(org.orgId, { name: "x", scopes: [] })).rejects.toThrow();
    const made = await tokens.createApiToken(org.orgId, { name: "mine", scopes: ["review:read"] });
    await expect(tokens.revokeApiToken(other.orgId, made.row.id)).rejects.toThrow(/not found/);
  });

  it("over 60 requests a minute is 429 with Retry-After", async () => {
    const made = await tokens.createApiToken(org.orgId, { name: "busy", scopes: ["review:read"] });
    const v = randomUUID();
    let last: Response | null = null;
    for (let i = 0; i < 61; i++) last = await R.version.GET(req("GET", `/versions/${v}`, undefined, made.token), p("versionId", v));
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("projects and assets", () => {
  it("PUT /projects finds by client and project name: 201 then 200 with the same ids", async () => {
    const body = { client: `Cli ${randomUUID().slice(0, 6)}`, project: "Launch" };
    const a = await json(await R.projects.PUT(req("PUT", "/projects", body)));
    const b = await json(await R.projects.PUT(req("PUT", "/projects", body)));
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ projectId: a.body.projectId, clientId: a.body.clientId, created: false });
  });

  it("PUT /assets is idempotent by externalRef and makes the Main option", async () => {
    const pr = await project();
    const ref = `tamshoot:project/${randomUUID()}/render`;
    const a = await asset(pr.body.projectId, "video", ref);
    const b = await asset(pr.body.projectId, "video", ref);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.assetId).toBe(a.body.assetId);
    expect(b.body.variationId).toBe(a.body.variationId);
    const [v] = await c.db.select().from(c.schema.studioVariations).where(eq(c.schema.studioVariations.id, a.body.variationId));
    expect(v!.label).toBe("Main");
  });

  it("refuses: a bad ref (422), another kind (409), another project (409), text (422 not yet), another org's project (404)", async () => {
    const pr = await project();
    expect((await asset(pr.body.projectId, "video", "has spaces")).status).toBe(422);
    const ref = `r:${randomUUID()}`;
    await asset(pr.body.projectId, "video", ref);
    expect((await asset(pr.body.projectId, "image", ref)).body.code).toBe("kind_conflict");
    const pr2 = await project();
    expect((await asset(pr2.body.projectId, "video", ref)).body.code).toBe("ref_conflict");
    const text = await asset(pr.body.projectId, "text");
    expect(text.status).toBe(422);
    expect(text.body.code).toBe("not_yet");
    expect((await asset(pr.body.projectId, "video", `r:${randomUUID()}`, otherToken)).status).toBe(404);
  });

  it("the same externalRef in two orgs is two assets", async () => {
    const ref = `shared:${randomUUID()}`;
    const a = await asset((await project()).body.projectId, "video", ref);
    const b = await asset((await project(otherToken)).body.projectId, "video", ref, otherToken);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.assetId).not.toBe(b.body.assetId);
  });
});

describe("versions", () => {
  it("a file version: uploading + signed PUT, then complete → pending (Tamtree told after the response), internal by default", async () => {
    const pr = await project();
    const as = await asset(pr.body.projectId);
    const made = await newVersion(as.body.assetId, { externalRef: "render/v1", changeNote: "First cut", meta: { why: "Opens cold." }, file: file(8) });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ number: 1, status: "in_review", processing: "uploading", created: true });
    expect(made.body.upload).toMatchObject({ method: "PUT" });

    // Not uploaded yet: complete refuses, release refuses.
    expect((await complete(made.body.versionId)).body.code).toBe("not_uploaded");
    expect((await json(await R.release.POST(req("POST", `/versions/${made.body.versionId}/release`), p("versionId", made.body.versionId)))).status).toBe(409);

    // A retry with the same ref returns the same version and a fresh target.
    const again = await newVersion(as.body.assetId, { externalRef: "render/v1", file: file(8) });
    expect(again.status).toBe(200);
    expect(again.body.versionId).toBe(made.body.versionId);
    expect(again.body.upload).toBeTruthy();

    expect((await upload(made.body.upload, "12345678")).status).toBe(200);
    afterFns.length = 0;
    const done = await complete(made.body.versionId);
    expect(done.body).toMatchObject({ id: made.body.versionId, number: 1, processing: "pending", released: false, externalRef: "render/v1", decision: null, builtFrom: null });
    expect(afterFns).toHaveLength(1);
    // Twice is fine and tells Tamtree nothing new.
    afterFns.length = 0;
    expect((await complete(made.body.versionId)).body.processing).toBe("pending");
    expect(afterFns).toHaveLength(0);

    const [row] = await c.db.select().from(c.schema.studioVersions).where(eq(c.schema.studioVersions.id, made.body.versionId));
    expect(row!.meta).toMatchObject({ source: "api", why: "Opens cold." });
    expect(row!.releasedAt).toBeNull();

    const rel = await json(await R.release.POST(req("POST", `/versions/${made.body.versionId}/release`), p("versionId", made.body.versionId)));
    expect(rel.body.released).toBe(true);
  });

  it("internal: false releases on complete", async () => {
    const as = await asset((await project()).body.projectId);
    const id = await uploadedVersion(as.body.assetId, { internal: false });
    expect((await getV(id)).body.released).toBe(true);
  });

  it("complete refuses a short upload (409 incomplete)", async () => {
    const as = await asset((await project()).body.projectId);
    const made = await newVersion(as.body.assetId, { externalRef: "short", file: file(8) });
    await c.store.write((await c.db.select().from(c.schema.studioFiles).innerJoin(c.schema.studioVersions, eq(c.schema.studioVersions.fileId, c.schema.studioFiles.id)).where(eq(c.schema.studioVersions.id, made.body.versionId)))[0]!.studio_files.originalKey!, new Blob(["123"]).stream(), "video/mp4");
    expect((await complete(made.body.versionId)).body.code).toBe("incomplete");
  });

  it("numbers versions in order and keeps refs per option", async () => {
    const as = await asset((await project()).body.projectId);
    await uploadedVersion(as.body.assetId);
    const id2 = await uploadedVersion(as.body.assetId);
    expect((await getV(id2)).body.number).toBe(2);
    const alt = await newVersion(as.body.assetId, { externalRef: "alt/1", variation: "Option B", file: file() });
    expect(alt.body.number).toBe(1);
  });

  it("refuses: wrong type and no file (422), too big (413), a document (422 not yet), a text body (422 not yet), another org (404)", async () => {
    const as = await asset((await project()).body.projectId);
    expect((await newVersion(as.body.assetId, { externalRef: "a", file: { ...file(), contentType: "image/png" } })).body.code).toBe("wrong_type");
    expect((await newVersion(as.body.assetId, { externalRef: "a" })).body.code).toBe("file_required");
    const big = await newVersion(as.body.assetId, { externalRef: "a", file: file(600 * 1024 ** 2) });
    expect(big.status).toBe(413);
    expect((await newVersion(as.body.assetId, { externalRef: "a", text: { v: 1 } })).body.code).toBe("not_yet");
    const doc = await asset((await project()).body.projectId, "document");
    expect((await newVersion(doc.body.assetId, { externalRef: "a", file: { name: "a.pdf", contentType: "application/pdf", bytes: 10 } })).body.code).toBe("not_yet");
    expect((await newVersion(as.body.assetId, { externalRef: "a", file: file() }, otherToken)).status).toBe(404);
    expect((await getV(randomUUID())).status).toBe(404);
    expect((await getV("not-a-uuid")).status).toBe(404);
  });

  it("an image goes to Tamtree too", async () => {
    const as = await asset((await project()).body.projectId, "image");
    const made = await newVersion(as.body.assetId, { externalRef: "img/1", file: { name: "a.png", contentType: "image/png", bytes: 4 } });
    expect(made.status).toBe(201);
    await upload(made.body.upload, "abcd");
    expect((await complete(made.body.versionId)).body.processing).toBe("pending");
  });

  it("builtFrom by id or by externalRef, same project only, shown on GET", async () => {
    const pr = await project();
    const script = await asset(pr.body.projectId, "video", `s:${randomUUID()}`);
    const scriptV = await newVersion(script.body.assetId, { externalRef: "script/v2", file: file() });
    const render = await asset(pr.body.projectId);
    const byId = await newVersion(render.body.assetId, { externalRef: "r1", builtFrom: scriptV.body.versionId, file: file() });
    expect((await getV(byId.body.versionId)).body.builtFrom).toEqual({ versionId: scriptV.body.versionId, assetId: script.body.assetId, assetTitle: "Skit 1", number: 1 });
    const byRef = await newVersion(render.body.assetId, { externalRef: "r2", builtFrom: { externalRef: "script/v2" }, file: file() });
    expect((await getV(byRef.body.versionId)).body.builtFrom.versionId).toBe(scriptV.body.versionId);

    expect((await newVersion(render.body.assetId, { externalRef: "r3", builtFrom: { externalRef: "nope" }, file: file() })).body.code).toBe("built_from_not_found");
    const elsewhere = await asset((await project()).body.projectId);
    const far = await newVersion(elsewhere.body.assetId, { externalRef: "far", file: file() });
    expect((await newVersion(render.body.assetId, { externalRef: "r4", builtFrom: far.body.versionId, file: file() })).body.code).toBe("built_from_other_project");
    const foreign = await newVersion((await asset((await project(otherToken)).body.projectId, "video", `f:${randomUUID()}`, otherToken)).body.assetId, { externalRef: "f", file: file() }, otherToken);
    expect((await newVersion(render.body.assetId, { externalRef: "r5", builtFrom: foreign.body.versionId, file: file() })).body.code).toBe("built_from_not_found");
  });

  it("GET shows the latest decision", async () => {
    const as = await asset((await project()).body.projectId);
    const id = await uploadedVersion(as.body.assetId);
    await c.db.insert(c.schema.studioDecisions).values({ versionId: id, decision: "approved", signedName: "Sam Client", email: "sam@x.co", fileSha256: "0".repeat(64), note: "Lovely" });
    expect((await getV(id)).body.decision).toMatchObject({ kind: "approved", by: "Sam Client", note: "Lovely" });
  });

  it("a malformed body is 400", async () => {
    const res = await R.projects.PUT(req("PUT", "/projects", "{nope"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("bad_json");
  });
});

describe("comments", () => {
  it("lists roots and replies (internal flagged, hidden left out, since filters), and a studio reply can resolve", async () => {
    const as = await asset((await project()).body.projectId);
    const id = await uploadedVersion(as.body.assetId);
    const cm = await import("@/services/studio/comments");
    const scope = (await cm.ownerScope(org.orgId, id))!;
    const author = { kind: "member" as const, memberId: org.memberId, label: "Owner" };
    const root = await cm.addRoot(scope, author, { body: "Line 3 is too long", annotation: { v: 1, shape: "time", x: 0.5, y: 0.5, t: 2 } });
    await cm.addRoot(scope, author, { body: "studio only", internal: true });
    const gone = await cm.addRoot(scope, author, { body: "hidden" });
    await c.db.update(c.schema.studioComments).set({ deletedAt: new Date() }).where(eq(c.schema.studioComments.id, gone.id));

    const list = async (q = "") => json(await R.comments.GET(req("GET", `/versions/${id}/comments${q}`), p("versionId", id)));
    const all = await list();
    expect(all.body.comments.map((x: { body: string }) => x.body)).toEqual(["Line 3 is too long", "studio only"]);
    expect(all.body.comments[1].internal).toBe(true);
    expect(all.body.comments[0]).toMatchObject({ number: 1, parentId: null, resolved: false, annotation: { shape: "time", t: 2 } });

    const rep = await json(await R.replies.POST(req("POST", `/comments/${root.id}/replies`, { body: "Changed in v2", resolve: true }), p("commentId", root.id)));
    expect(rep.status).toBe(201);
    expect(rep.body).toMatchObject({ parentId: root.id, resolved: true });
    const after = await list(`?since=${encodeURIComponent(all.body.comments[1].createdAt)}`);
    expect(after.body.comments.map((x: { body: string }) => x.body)).toEqual(["Changed in v2"]);
    expect(after.body.comments[0]).toMatchObject({ parentId: root.id, byStudio: true, author: "Studio a" });
    expect((await list()).body.comments.find((x: { id: string }) => x.id === root.id).resolved).toBe(true);

    // A reply to a reply lands on the root.
    const rep2 = await json(await R.replies.POST(req("POST", `/comments/${rep.body.id}/replies`, { body: "And v3" }), p("commentId", rep.body.id)));
    expect(rep2.body.parentId).toBe(root.id);

    expect((await list("?since=yesterday")).status).toBe(400);
    expect((await json(await R.comments.GET(req("GET", `/versions/${id}/comments`, undefined, otherToken), p("versionId", id)))).status).toBe(404);
    expect((await json(await R.replies.POST(req("POST", `/comments/${root.id}/replies`, { body: "x" }, otherToken), p("commentId", root.id)))).status).toBe(404);
    expect((await json(await R.replies.POST(req("POST", `/comments/${root.id}/replies`, { body: "x" }, readOnly), p("commentId", root.id)))).status).toBe(403);
    expect((await json(await R.replies.POST(req("POST", `/comments/${root.id}/replies`, { body: "  " }), p("commentId", root.id)))).status).toBe(422);
  });
});

describe("cleanup", () => {
  it("an API version whose bytes never arrived goes with its file after a day", async () => {
    const as = await asset((await project()).body.projectId);
    const made = await newVersion(as.body.assetId, { externalRef: "abandoned", file: file() });
    const [v] = await c.db.select().from(c.schema.studioVersions).where(eq(c.schema.studioVersions.id, made.body.versionId));
    await c.db.update(c.schema.studioFiles).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(c.schema.studioFiles.id, v!.fileId));
    const { cleanup } = await import("@/services/studio/cleanup");
    await cleanup(new Date(), async () => true);
    expect(await c.db.select().from(c.schema.studioVersions).where(eq(c.schema.studioVersions.id, made.body.versionId))).toHaveLength(0);
  });
});
