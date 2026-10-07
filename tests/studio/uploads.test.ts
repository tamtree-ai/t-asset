/** Owner uploads (plan §5.2): checks before the bytes move, a signed PUT straight to the store, and a check after. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { type Ctx, setup } from "./helpers";

vi.mock("server-only", () => ({}));

let c: Ctx;
let a: Awaited<ReturnType<Ctx["org"]>>;
let b: Awaited<ReturnType<Ctx["org"]>>;
let files: typeof import("@/services/studio/files");
let blobPUT: typeof import("@/app/api/dev-blob/[...key]/route").PUT;

const MB = 1024 * 1024;
/** What the owner's browser measures of an image before sending it. */
const FACTS = { sha256: "AB".repeat(32), width: 1200, height: 900 };

/** Sends a body to a signed target through the dev route, as the browser would. */
async function upload(target: { url: string; headers: Record<string, string> }, body: string | Uint8Array) {
  const url = new URL(target.url);
  const key = url.pathname.replace(/^\/api\/dev-blob\//, "").split("/");
  return blobPUT(new Request(url, { method: "PUT", headers: target.headers, body: typeof body === "string" ? body : new Blob([body as Uint8Array<ArrayBuffer>]) }), { params: Promise.resolve({ key }) });
}

beforeAll(async () => {
  c = await setup("uploads");
  a = await c.org("a");
  b = await c.org("b");
  files = await import("@/services/studio/files");
  blobPUT = (await import("@/app/api/dev-blob/[...key]/route")).PUT;
});
afterAll(async () => c.cleanup());

describe("starting an upload", () => {
  it("refuses the wrong kind, an empty file, and one over the limit", async () => {
    const t = await c.tree(a.orgId, "image");
    await expect(files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "x.mp4", mime: "video/mp4", bytes: 10 })).rejects.toThrow(/takes a PNG/);
    await expect(files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "x.png", mime: "image/png", bytes: 0 })).rejects.toThrow(/empty/);
    await expect(files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "x.png", mime: "image/png", bytes: 31 * MB })).rejects.toThrow(/30 MB/);
    const v = await c.tree(a.orgId, "video");
    await expect(files.startUpload({ orgId: a.orgId, variationId: v.variationId, name: "x.mov", mime: "video/quicktime", bytes: 501 * MB })).rejects.toThrow(/500 MB/);
  });

  it("refuses another org's variation", async () => {
    const t = await c.tree(b.orgId, "image");
    await expect(files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "x.png", mime: "image/png", bytes: 10 })).rejects.toThrow(/not found/);
  });

  it("refuses a file that would take the store past its cap, and says how full it is", async () => {
    const t = await c.tree(a.orgId, "image");
    const before = process.env.BLOB_SOFT_CAP_BYTES;
    process.env.BLOB_SOFT_CAP_BYTES = String(5 * MB);
    try {
      await expect(files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "x.png", mime: "image/png", bytes: 6 * MB })).rejects.toThrow(/isn't room: .* of 5 MB/);
    } finally {
      if (before === undefined) delete process.env.BLOB_SOFT_CAP_BYTES;
      else process.env.BLOB_SOFT_CAP_BYTES = before;
    }
  });

  it("reserves a row in state uploading and hands back a signed PUT for exactly that key", async () => {
    const t = await c.tree(a.orgId, "image");
    const s = await files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "My Banner (final).png", mime: "image/png", bytes: 5 });
    expect(s.driver).toBe("local");
    expect(s.key).toBe(`o/${s.fileId}/My-Banner-final-.png`);
    expect(s.target).not.toBeNull();
    const [row] = await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, s.fileId));
    expect(row).toMatchObject({ processing: "uploading", bytes: 5, mime: "image/png", originalKey: s.key });
  });
});

describe("the signed PUT", () => {
  it("takes the right type and size, and refuses another type, a bigger body, or a forged signature", async () => {
    const t = await c.tree(a.orgId, "image");
    const s = await files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "a.png", mime: "image/png", bytes: 5 });
    expect((await upload({ url: s.target!.url, headers: { "content-type": "image/jpeg" } }, "12345")).status).toBe(415);
    expect((await upload(s.target!, "123456")).status).toBe(413);
    expect((await upload({ url: s.target!.url.replace(/sig=[^&]+/, "sig=forged"), headers: s.target!.headers }, "12345")).status).toBe(403);
    expect((await upload(s.target!, "12345")).status).toBe(200);
    expect(await c.store.head(s.key)).toEqual({ size: 5, contentType: "image/png" });
  });
});

describe("finishing an upload", () => {
  it("makes the next version of an image, ready at once and shown from its original, and logs it", async () => {
    const t = await c.tree(a.orgId, "image");
    await c.version(a.orgId, t.variationId);
    const s = await files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "v2.png", mime: "image/png", bytes: 5 });
    await upload(s.target!, "12345");
    const done = await files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "Bigger logo", image: FACTS });
    expect(done).toMatchObject({ number: 2, alreadyDone: false, ready: true });
    const [row] = await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, s.fileId));
    expect(row).toMatchObject({ processing: "ready", previewKey: s.key, wmPreviewKey: s.key, thumbKey: s.key, sha256: "ab".repeat(32), width: 1200, height: 900, derivedBytes: 0 });
    expect(files.renditionOf(row!, "preview")).toEqual({ key: s.key, mime: "image/png" });
    expect(files.keysOf(row!)).toEqual([s.key]);
    const [v] = await c.db.select().from(c.schema.studioVersions).where(eq(c.schema.studioVersions.id, done.versionId));
    expect(v).toMatchObject({ changeNote: "Bigger logo", status: "in_review" });
    const events = await c.db.select().from(c.schema.studioEvents).where(eq(c.schema.studioEvents.projectId, t.projectId));
    expect(events.map((e) => e.type)).toContain("version.uploaded");
  });

  it("leaves a video pending for Tamtree", async () => {
    const t = await c.tree(a.orgId, "video");
    const s = await files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "a.mp4", mime: "video/mp4", bytes: 5 });
    await upload(s.target!, "12345");
    const done = await files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "" });
    expect(done).toMatchObject({ number: 1, ready: false });
    const [row] = await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, s.fileId));
    expect(row).toMatchObject({ processing: "pending", previewKey: null });
  });

  it("refuses an image without the browser's measurements, and a type other than PNG or JPG", async () => {
    const t = await c.tree(a.orgId, "image");
    const s = await files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "a.png", mime: "image/png", bytes: 3 });
    await upload(s.target!, "abc");
    await expect(files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "" })).rejects.toThrow(/fingerprint are missing/);
    await expect(files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "a.webp", mime: "image/webp", bytes: 3 })).rejects.toThrow(/PNG or JPG/);
  });

  it("answers a second finish with the same version", async () => {
    const t = await c.tree(a.orgId, "image");
    const s = await files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "a.png", mime: "image/png", bytes: 3 });
    await upload(s.target!, "abc");
    const one = await files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "", image: FACTS });
    const two = await files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "", image: FACTS });
    expect(two).toMatchObject({ versionId: one.versionId, alreadyDone: true });
  });

  it("refuses when nothing arrived, or fewer bytes than promised", async () => {
    const t = await c.tree(a.orgId, "image");
    const s = await files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "a.png", mime: "image/png", bytes: 10 });
    await expect(files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "", image: FACTS })).rejects.toThrow(/didn't arrive/);
    await c.put(s.key, "short", "image/png");
    await expect(files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "", image: FACTS })).rejects.toThrow(/incomplete \(5 of 10 bytes\)/);
  });

  it("refuses another org's file", async () => {
    const t = await c.tree(a.orgId, "image");
    const s = await files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "a.png", mime: "image/png", bytes: 3 });
    await upload(s.target!, "abc");
    await expect(files.finishUpload({ orgId: b.orgId, memberId: b.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "", image: FACTS })).rejects.toThrow(/not found/);
  });
});

describe("the storage meter", () => {
  it("counts kept originals and everything Tamtree made, and stops counting a deleted original", async () => {
    const x = await c.org("meter");
    const storage = await import("@/services/studio/storage");
    expect((await storage.storageUsed(x.orgId)).bytes).toBe(0);
    const t = await c.tree(x.orgId, "video");
    const v = await c.version(x.orgId, t.variationId, { mime: "video/mp4" });
    expect((await storage.storageUsed(x.orgId)).bytes).toBe(8 + 40);
    await c.db.update(c.schema.studioFiles).set({ originalKey: null }).where(eq(c.schema.studioFiles.id, v.fileId));
    expect((await storage.storageUsed(x.orgId)).bytes).toBe(40);
  });
});
