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

/** What the owner's browser makes of an image before finishing: its watermarked preview and thumbnail. */
async function renditions(fileId: string, names: string[] = ["wm_preview.webp", "thumb.webp"]) {
  for (const n of names) await c.put(`d/${fileId}/${n}`, `MADE-${n}`, n.endsWith(".pdf") ? "application/pdf" : "image/webp");
}

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
    await renditions(s.fileId);
    const done = await files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "Bigger logo", facts: FACTS });
    expect(done).toMatchObject({ number: 2, alreadyDone: false, ready: true });
    const [row] = await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, s.fileId));
    const wm = `d/${s.fileId}/wm_preview.webp`;
    const thumb = `d/${s.fileId}/thumb.webp`;
    expect(row).toMatchObject({ processing: "ready", previewKey: s.key, wmPreviewKey: wm, thumbKey: thumb, sha256: "ab".repeat(32), width: 1200, height: 900 });
    expect(row!.derivedBytes).toBe("MADE-wm_preview.webp".length + "MADE-thumb.webp".length);
    expect(files.renditionOf(row!, "preview")).toEqual({ key: s.key, mime: "image/png" });
    expect(files.renditionOf(row!, "wm")).toEqual({ key: wm, mime: "image/webp" });
    expect(files.keysOf(row!).sort()).toEqual([s.key, wm, thumb].sort());
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
    await renditions(s.fileId);
    const one = await files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "", facts: FACTS });
    const two = await files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "", facts: FACTS });
    expect(two).toMatchObject({ versionId: one.versionId, alreadyDone: true });
  });

  it("refuses when nothing arrived, or fewer bytes than promised", async () => {
    const t = await c.tree(a.orgId, "image");
    const s = await files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "a.png", mime: "image/png", bytes: 10 });
    await expect(files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "", facts: FACTS })).rejects.toThrow(/didn't arrive/);
    await c.put(s.key, "short", "image/png");
    await expect(files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "", facts: FACTS })).rejects.toThrow(/incomplete \(5 of 10 bytes\)/);
  });

  it("refuses another org's file", async () => {
    const t = await c.tree(a.orgId, "image");
    const s = await files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "a.png", mime: "image/png", bytes: 3 });
    await upload(s.target!, "abc");
    await expect(files.finishUpload({ orgId: b.orgId, memberId: b.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "", facts: FACTS })).rejects.toThrow(/not found/);
  });
});

describe("renditions made in the owner's browser", () => {
  it("hands out signed PUTs for an image's watermark and thumbnail, with the watermark text", async () => {
    const t = await c.tree(a.orgId, "image");
    const s = await files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "logo.png", mime: "image/png", bytes: 5 });
    const r = await files.renditionTargets({ orgId: a.orgId, fileId: s.fileId, variationId: t.variationId, format: "webp" });
    expect(r.kind).toBe("image");
    expect(Object.keys(r.targets).sort()).toEqual(["thumb", "wm_preview"]);
    expect(r.targets.wm_preview!.key).toBe(`d/${s.fileId}/wm_preview.webp`);
    expect(r.watermarkText).toBe("STUDIO A · PREVIEW");
    expect(r.proofText).toBe("STUDIO A · PROOF · ACME");
    expect(r.footerText).toMatch(/^Proof for Acme · \d{4}-\d{2}-\d{2} · not licensed for use until paid$/);
    expect((await upload(r.targets.wm_preview!, "made")).status).toBe(200);
    const png = await files.renditionTargets({ orgId: a.orgId, fileId: s.fileId, variationId: t.variationId, format: "png" });
    expect(png.targets.thumb!.contentType).toBe("image/png");
  });

  it("refuses a video, another org, and a file that already has its previews", async () => {
    const v = await c.tree(a.orgId, "video");
    const sv = await files.startUpload({ orgId: a.orgId, variationId: v.variationId, name: "a.mp4", mime: "video/mp4", bytes: 5 });
    await expect(files.renditionTargets({ orgId: a.orgId, fileId: sv.fileId, variationId: v.variationId, format: "webp" })).rejects.toThrow(/Tamtree/);
    const t = await c.tree(a.orgId, "image");
    const s = await files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "a.png", mime: "image/png", bytes: 3 });
    await expect(files.renditionTargets({ orgId: b.orgId, fileId: s.fileId, variationId: t.variationId, format: "webp" })).rejects.toThrow(/not found/);
    const done = await c.version(a.orgId, t.variationId);
    await expect(files.renditionTargets({ orgId: a.orgId, fileId: done.fileId, variationId: t.variationId, format: "webp" })).rejects.toThrow(/already has/);
  });

  it("refuses to finish an image whose watermark or thumbnail didn't arrive", async () => {
    const t = await c.tree(a.orgId, "image");
    const s = await files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "a.png", mime: "image/png", bytes: 3 });
    await upload(s.target!, "abc");
    await expect(files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "", facts: FACTS })).rejects.toThrow(/watermarked preview and the thumbnail didn't arrive/);
    await renditions(s.fileId, ["thumb.webp"]);
    await expect(files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "", facts: FACTS })).rejects.toThrow(/^The watermarked preview didn't arrive/);
    await renditions(s.fileId, ["wm_preview.webp"]);
    expect((await files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "", facts: FACTS })).ready).toBe(true);
  });

  it("finds PNG renditions when the browser couldn't encode WebP", async () => {
    const t = await c.tree(a.orgId, "image");
    const s = await files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "a.png", mime: "image/png", bytes: 3 });
    await upload(s.target!, "abc");
    await renditions(s.fileId, ["wm_preview.png", "thumb.png"]);
    await files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "", facts: FACTS, format: "png" });
    const [row] = await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, s.fileId));
    expect(files.renditionOf(row!, "wm")).toEqual({ key: `d/${s.fileId}/wm_preview.png`, mime: "image/png" });
  });

  it("gives an image from before Phase 0 its watermark once the same file is picked again", async () => {
    const t = await c.tree(a.orgId, "image");
    const v = await c.version(a.orgId, t.variationId);
    const [before] = await c.db.update(c.schema.studioFiles).set({ previewKey: `o/${v.fileId}/banner.png`, wmPreviewKey: `o/${v.fileId}/banner.png`, thumbKey: `o/${v.fileId}/banner.png` }).where(eq(c.schema.studioFiles.id, v.fileId)).returning();
    expect(files.needsWatermark(before!)).toBe(true);
    const r = await files.renditionTargets({ orgId: a.orgId, fileId: v.fileId, variationId: t.variationId, format: "webp" });
    await upload(r.targets.wm_preview!, "WM");
    await upload(r.targets.thumb!, "TH");
    await expect(files.attachImageRenditions({ orgId: a.orgId, fileId: v.fileId, sha256: "0".repeat(64), format: "webp" })).rejects.toThrow(/same file/);
    await files.attachImageRenditions({ orgId: a.orgId, fileId: v.fileId, sha256: v.sha256, format: "webp" });
    const [after] = await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, v.fileId));
    expect(after).toMatchObject({ wmPreviewKey: `d/${v.fileId}/wm_preview.webp`, thumbKey: `d/${v.fileId}/thumb.webp`, previewKey: `o/${v.fileId}/banner.png` });
    expect(files.needsWatermark(after!)).toBe(false);
    await expect(files.attachImageRenditions({ orgId: a.orgId, fileId: v.fileId, sha256: v.sha256, format: "webp" })).rejects.toThrow(/already has/);
  });
});

describe("brand guide documents", () => {
  const DOC = { sha256: "cd".repeat(32), width: 1131, height: 1600, pageCount: 3 };

  it("takes a PDF up to 100 MB, and only a PDF", async () => {
    const t = await c.tree(a.orgId, "document");
    await expect(files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "g.png", mime: "image/png", bytes: 10 })).rejects.toThrow(/takes a PDF/);
    await expect(files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "g.pdf", mime: "application/pdf", bytes: 101 * MB })).rejects.toThrow(/100 MB/);
  });

  it("asks the browser for both proofs and a thumbnail, and is ready once they arrive", async () => {
    const t = await c.tree(a.orgId, "document");
    const s = await files.startUpload({ orgId: a.orgId, variationId: t.variationId, name: "Brand Guide.pdf", mime: "application/pdf", bytes: 5 });
    const r = await files.renditionTargets({ orgId: a.orgId, fileId: s.fileId, variationId: t.variationId, format: "webp" });
    expect(r.kind).toBe("document");
    expect(Object.fromEntries(Object.entries(r.targets).map(([k, v]) => [k, v.contentType]))).toEqual({ preview: "application/pdf", wm_preview: "application/pdf", thumb: "image/webp" });
    await upload(s.target!, "%PDF-");
    await renditions(s.fileId, ["wm_preview.pdf", "thumb.webp"]);
    await expect(files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "", facts: DOC })).rejects.toThrow(/clean proof didn't arrive/);
    await expect(files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "", facts: { ...DOC, pageCount: undefined } })).rejects.toThrow(/between 1 and 120 pages/);
    await expect(files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "", facts: { ...DOC, pageCount: 121 } })).rejects.toThrow(/between 1 and 120 pages/);
    await renditions(s.fileId, ["preview.pdf"]);
    expect((await files.finishUpload({ orgId: a.orgId, memberId: a.memberId, fileId: s.fileId, variationId: t.variationId, changeNote: "", facts: DOC })).ready).toBe(true);
    const [row] = await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, s.fileId));
    expect(row).toMatchObject({ processing: "ready", pageCount: 3, width: 1131, height: 1600, previewKey: `d/${s.fileId}/preview.pdf`, wmPreviewKey: `d/${s.fileId}/wm_preview.pdf`, originalKey: s.key });
    expect(files.renditionOf(row!, "wm")).toEqual({ key: `d/${s.fileId}/wm_preview.pdf`, mime: "application/pdf" });
    expect(files.renditionOf(row!, "original")).toEqual({ key: s.key, mime: "application/pdf" });
    expect(files.renditionOf(row!, "poster")).toBeNull();
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
