/** The review file route: every file goes through the session, the share's contents, and the download rules, then a redirect to a signed URL. */
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
let GET: typeof import("@/app/review/[token]/file/[fileId]/route").GET;
let blobGET: typeof import("@/app/api/dev-blob/[...key]/route").GET;
let access: typeof import("@/services/studio/access");

type Fx = Awaited<ReturnType<typeof fixture>>;

/** A share with one image version; signs in a named reviewer (cookie in the jar). */
async function fixture(over: Record<string, unknown> = {}, kind: "image" | "video" = "image", status: "in_review" | "approved" = "in_review") {
  const t = await c.tree(org.orgId, kind);
  const v = await c.version(org.orgId, t.variationId, { mime: kind === "video" ? "video/mp4" : "image/png", status });
  const made = await c.share(org.orgId, org.memberId, t.projectId, [t.assetId], over);
  return { t, v, ...made };
}

async function signIn(f: Fx) {
  const ok = await access.unlockShare(f.token, f.passcode, { ip: `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ua: "t" });
  const session = (await access.sessionFor(f.share, ok.sessionToken))!;
  await access.identify(f.share, session.id, { name: "Sam", email: `s${Math.random().toString(36).slice(2)}@x.co` });
  jar.clear();
  jar.set(access.sessionCookieName(f.share.id), ok.sessionToken);
}

/** The route's own answer: 302 to a signed URL, or a refusal. */
const ask = (f: Fx, fileId: string, query: string) => GET(new Request(`http://t/review/${f.token}/file/${fileId}${query}`), { params: Promise.resolve({ token: f.token, fileId }) });

/** Follows the redirect into the local store, as a browser would. A refusal comes back as it is. */
async function fetchFile(f: Fx, fileId: string, query: string, headers: Record<string, string> = {}): Promise<Response> {
  const res = await ask(f, fileId, query);
  if (res.status !== 302) return res;
  const location = new URL(res.headers.get("location")!);
  const key = location.pathname.replace(/^\/api\/dev-blob\//, "").split("/");
  return blobGET(new Request(location, { headers }), { params: Promise.resolve({ key }) });
}

beforeAll(async () => {
  c = await setup("route");
  org = await c.org("a");
  access = await import("@/services/studio/access");
  GET = (await import("@/app/review/[token]/file/[fileId]/route")).GET;
  blobGET = (await import("@/app/api/dev-blob/[...key]/route")).GET;
});
afterAll(async () => c.cleanup());

describe("who may fetch", () => {
  it("nobody without a session", async () => {
    const f = await fixture();
    jar.clear();
    expect((await ask(f, f.v.fileId, "?r=preview")).status).toBe(401);
  });

  it("not a session from a different share", async () => {
    const a = await fixture();
    const b = await fixture();
    await signIn(a);
    expect((await ask(b, b.v.fileId, "?r=preview")).status).toBe(401);
  });

  it("not a session that has passed the gate but not given a name yet", async () => {
    const f = await fixture();
    const ok = await access.unlockShare(f.token, f.passcode, { ip: "10.9.9.9", ua: "t" });
    jar.clear();
    jar.set(access.sessionCookieName(f.share.id), ok.sessionToken);
    expect((await ask(f, f.v.fileId, "?r=preview")).status).toBe(401);
  });

  it("not once the link is revoked", async () => {
    const f = await fixture();
    await signIn(f);
    expect((await ask(f, f.v.fileId, "?r=preview")).status).toBe(302);
    await (await import("@/services/studio/shares")).revokeShare(org.orgId, f.share.id);
    expect((await ask(f, f.v.fileId, "?r=preview")).status).toBe(401);
  });

  it("not a file that isn't in the share, even another file in the same org", async () => {
    const f = await fixture();
    const other = await fixture();
    await signIn(f);
    expect((await ask(f, other.v.fileId, "?r=preview")).status).toBe(404);
    expect((await ask(f, "00000000-0000-0000-0000-000000000000", "?r=preview")).status).toBe(404);
  });

  it("not a version a pinned share doesn't show", async () => {
    const f = await fixture({ versionMode: "pinned" });
    const later = await c.version(org.orgId, f.t.variationId);
    await signIn(f);
    expect((await ask(f, f.v.fileId, "?r=preview")).status).toBe(302);
    expect((await ask(f, later.fileId, "?r=preview")).status).toBe(404);
  });
});

describe("watermark and downloads", () => {
  it("serves the watermarked preview while unapproved, and the clean one after approval", async () => {
    const f = await fixture();
    await signIn(f);
    expect(await (await fetchFile(f, f.v.fileId, "?r=preview")).text()).toBe("MARKED-PREVIEW");
    await c.db.update(c.schema.studioVersions).set({ status: "approved" }).where(eq(c.schema.studioVersions.id, f.v.versionId));
    expect(await (await fetchFile(f, f.v.fileId, "?r=preview")).text()).toBe("CLEAN-PREVIEW");
  });

  it("serves the clean preview from the start when the share has no watermark", async () => {
    const f = await fixture({ watermark: false });
    await signIn(f);
    expect(await (await fetchFile(f, f.v.fileId, "?r=preview")).text()).toBe("CLEAN-PREVIEW");
  });

  it("never lets the browser choose the watermarked or clean rendition: ?r=wm is not a rendition here", async () => {
    const f = await fixture();
    await signIn(f);
    expect((await ask(f, f.v.fileId, "?r=wm")).status).toBe(404);
    expect((await ask(f, f.v.fileId, "?r=bogus")).status).toBe(404);
  });

  it("refuses the original under policy none, even when approved", async () => {
    const f = await fixture({ downloadPolicy: "none" }, "image", "approved");
    await signIn(f);
    const res = await ask(f, f.v.fileId, "?r=original");
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("ORIGINAL");
  });

  it("refuses the original before approval under after_approval, and gives it after, as a download", async () => {
    const f = await fixture({ downloadPolicy: "after_approval" });
    await signIn(f);
    expect((await ask(f, f.v.fileId, "?r=original")).status).toBe(403);
    await c.db.update(c.schema.studioVersions).set({ status: "approved" }).where(eq(c.schema.studioVersions.id, f.v.versionId));
    const res = await fetchFile(f, f.v.fileId, "?r=original&download=1");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ORIGINAL");
    expect(res.headers.get("content-disposition")).toContain("banner.png");
  });

  it("gives the original straight away under policy always", async () => {
    const f = await fixture({ downloadPolicy: "always" });
    await signIn(f);
    expect(await (await fetchFile(f, f.v.fileId, "?r=original")).text()).toBe("ORIGINAL");
  });

  it("has no clean video frame to hand out while a video is watermarked", async () => {
    const f = await fixture({}, "video");
    await signIn(f);
    expect((await ask(f, f.v.fileId, "?r=poster")).status).toBe(404);
    expect(await (await fetchFile(f, f.v.fileId, "?r=preview")).text()).toBe("MARKED-PREVIEW");
    await c.db.update(c.schema.studioVersions).set({ status: "approved" }).where(eq(c.schema.studioVersions.id, f.v.versionId));
    expect(await (await fetchFile(f, f.v.fileId, "?r=poster")).text()).toBe("POSTER");
  });
});

describe("headers, signed URLs and ranges", () => {
  it("redirects privately, uncached and not indexed, to a URL that lasts minutes", async () => {
    const f = await fixture();
    await signIn(f);
    const res = await ask(f, f.v.fileId, "?r=thumb");
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const exp = Number(new URL(res.headers.get("location")!).searchParams.get("exp"));
    expect(exp - Date.now()).toBeGreaterThan(290_000);
    expect(exp - Date.now()).toBeLessThanOrEqual(300_000);
  });

  it("the signed URL is not sniffable, takes ranges, and refuses a tampered key", async () => {
    const f = await fixture({ watermark: false });
    await signIn(f);
    const whole = await fetchFile(f, f.v.fileId, "?r=thumb");
    expect(whole.headers.get("x-content-type-options")).toBe("nosniff");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    const res = await fetchFile(f, f.v.fileId, "?r=preview", { range: "bytes=0-4" });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("CLEAN");
    expect(res.headers.get("content-range")).toBe("bytes 0-4/13");
    expect((await fetchFile(f, f.v.fileId, "?r=preview", { range: "bytes=999-" })).status).toBe(416);

    const location = new URL((await ask(f, f.v.fileId, "?r=preview")).headers.get("location")!);
    const other = location.pathname.replace(/^\/api\/dev-blob\//, "").replace("/preview", "/wm").split("/");
    expect((await blobGET(new Request(location), { params: Promise.resolve({ key: other }) })).status).toBe(403);
  });

  it("serves the video with its own type", async () => {
    const f = await fixture({ watermark: false }, "video");
    await signIn(f);
    expect((await fetchFile(f, f.v.fileId, "?r=preview")).headers.get("content-type")).toBe("video/mp4");
  });

  it("downloads a video's clean preview when its original was deleted to save space", async () => {
    const f = await fixture({ downloadPolicy: "always", watermark: false }, "video");
    await c.db.update(c.schema.studioFiles).set({ originalKey: null }).where(eq(c.schema.studioFiles.id, f.v.fileId));
    await signIn(f);
    expect(await (await fetchFile(f, f.v.fileId, "?r=original&download=1")).text()).toBe("CLEAN-PREVIEW");
  });

  it("serves nothing for a file Tamtree hasn't finished", async () => {
    const f = await fixture({ watermark: false });
    await c.db.update(c.schema.studioFiles).set({ processing: "pending" }).where(eq(c.schema.studioFiles.id, f.v.fileId));
    await signIn(f);
    expect((await ask(f, f.v.fileId, "?r=preview")).status).toBe(404);
  });
});
