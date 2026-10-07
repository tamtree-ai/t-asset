/** The Tamtree contract (plan §5.3): webhook out, then pending → claim → job → targets → complete or fail. */
import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { type Ctx, setup } from "./helpers";

vi.mock("server-only", () => ({}));

let c: Ctx;
let org: Awaited<ReturnType<Ctx["org"]>>;
let tt: typeof import("@/services/studio/tamtree");
let blobPUT: typeof import("@/app/api/dev-blob/[...key]/route").PUT;

const TOKEN = "test-tamtree-token";
const SHA = createHash("sha256").update("ORIGINAL").digest("hex");

/** A file Tamtree hasn't touched yet: original stored, version made, state pending. */
async function pendingFile(kind: "image" | "video" = "image") {
  const t = await c.tree(org.orgId, kind);
  const v = await c.version(org.orgId, t.variationId, { mime: kind === "video" ? "video/mp4" : "image/png" });
  await c.db
    .update(c.schema.studioFiles)
    .set({ processing: "pending", previewKey: null, wmPreviewKey: null, posterKey: null, thumbKey: null, sha256: null, derivedBytes: 0, width: null, height: null, durationS: null, fpsNum: null, fpsDen: null })
    .where(eq(c.schema.studioFiles.id, v.fileId));
  return { ...t, ...v };
}

async function put(target: { url: string; headers: Record<string, string> }, body: string) {
  const url = new URL(target.url);
  const key = url.pathname.replace(/^\/api\/dev-blob\//, "").split("/");
  return blobPUT(new Request(url, { method: "PUT", headers: target.headers, body }), { params: Promise.resolve({ key }) });
}

/** Does what a Tamtree run does after claiming: upload every output and report. */
async function runOutputs(fileId: string) {
  const { targets } = await tt.targets(fileId);
  const outputs: Record<string, { key: string }> = {};
  for (const [name, t] of Object.entries(targets)) {
    expect((await put(t, `made-${name}`)).status).toBe(200);
    outputs[name] = { key: t.key };
  }
  return outputs;
}

beforeAll(async () => {
  process.env.TAMTREE_API_TOKEN = TOKEN;
  c = await setup("tamtree");
  org = await c.org("a");
  tt = await import("@/services/studio/tamtree");
  blobPUT = (await import("@/app/api/dev-blob/[...key]/route")).PUT;
});
afterAll(async () => {
  delete process.env.TAMTREE_API_TOKEN;
  await c.cleanup();
});

describe("the API's door", () => {
  it("refuses a missing or wrong token, and lets the right one in", async () => {
    const { GET } = await import("@/app/api/tamtree/pending/route");
    expect((await GET(new Request("http://t/api/tamtree/pending"))).status).toBe(401);
    expect((await GET(new Request("http://t/api/tamtree/pending", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
    const ok = await GET(new Request("http://t/api/tamtree/pending", { headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(ok.status).toBe(200);
    expect(Array.isArray((await ok.json()).files)).toBe(true);
  });

  it("turns refusals into JSON with the right status", async () => {
    const { POST } = await import("@/app/api/tamtree/files/[fileId]/complete/route");
    const f = await pendingFile();
    const call = (body: string) => POST(new Request("http://t", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body }), { params: Promise.resolve({ fileId: f.fileId }) });
    expect((await call("not json")).status).toBe(400);
    const bad = await call(JSON.stringify({ sha256: "x" }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toMatch(/sha256/);
    const missing = await POST(new Request("http://t", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: "{}" }), { params: Promise.resolve({ fileId: "00000000-0000-0000-0000-000000000000" }) });
    expect(missing.status).toBe(422);
  });
});

describe("pending and claim", () => {
  it("lists pending files oldest first, and not ready or uploading ones", async () => {
    const f = await pendingFile();
    const ready = await c.version(org.orgId, (await c.tree(org.orgId)).variationId);
    const ids = (await tt.pendingFiles(50)).map((p) => p.fileId);
    expect(ids).toContain(f.fileId);
    expect(ids).not.toContain(ready.fileId);
  });

  it("gives a file to one run only, and frees it once the claim is stale", async () => {
    const f = await pendingFile();
    const results = await Promise.allSettled([tt.claim(f.fileId), tt.claim(f.fileId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ status: 409 });
    expect((await tt.pendingFiles(50)).map((p) => p.fileId)).not.toContain(f.fileId);
    const later = new Date(Date.now() + tt.CLAIM_TTL_MS + 1000);
    expect((await tt.pendingFiles(50, later)).map((p) => p.fileId)).toContain(f.fileId);
    expect(await tt.claim(f.fileId, later)).toMatchObject({ attempts: 2 });
  });

  it("refuses to claim a file that isn't waiting", async () => {
    const ready = await c.version(org.orgId, (await c.tree(org.orgId)).variationId);
    await expect(tt.claim(ready.fileId)).rejects.toMatchObject({ status: 409 });
    await expect(tt.claim("00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ status: 404 });
  });
});

describe("a job", () => {
  it("has the original as a signed URL, the outputs wanted, and the studio's watermark text", async () => {
    const f = await pendingFile("video");
    const j = await tt.job(f.fileId);
    expect(j).toMatchObject({ kind: "video", mime: "video/mp4", state: "pending", watermarkText: "STUDIO A · PREVIEW" });
    expect(j.source!.url).toContain(`/api/dev-blob/o/${f.fileId}/teaser.mp4`);
    expect(j.outputs.map((o) => o.name)).toEqual(["preview", "wm_preview", "poster", "thumb"]);
  });

  it("hands out signed PUTs only while the file is waiting, and not when the store is full", async () => {
    const f = await pendingFile();
    const { targets } = await tt.targets(f.fileId);
    expect(Object.keys(targets)).toEqual(["preview", "wm_preview", "thumb"]);
    expect(targets.preview).toMatchObject({ method: "PUT", key: `d/${f.fileId}/preview.webp`, contentType: "image/webp" });
    const before = process.env.BLOB_SOFT_CAP_BYTES;
    process.env.BLOB_SOFT_CAP_BYTES = "1";
    try {
      await expect(tt.targets(f.fileId)).rejects.toMatchObject({ status: 507 });
    } finally {
      if (before === undefined) delete process.env.BLOB_SOFT_CAP_BYTES;
      else process.env.BLOB_SOFT_CAP_BYTES = before;
    }
    const ready = await c.version(org.orgId, (await c.tree(org.orgId)).variationId);
    await expect(tt.targets(ready.fileId)).rejects.toMatchObject({ status: 409 });
  });
});

describe("complete", () => {
  it("refuses until every output is in the store at its own key", async () => {
    const f = await pendingFile();
    await tt.claim(f.fileId);
    const { targets } = await tt.targets(f.fileId);
    await put(targets.preview!, "p");
    const base = { sha256: SHA, width: 1600, height: 900 };
    await expect(tt.complete(f.fileId, { ...base, outputs: { preview: { key: targets.preview!.key } } })).rejects.toThrow(/wm_preview is missing; thumb is missing/);
    await expect(tt.complete(f.fileId, { ...base, outputs: { preview: { key: targets.preview!.key }, wm_preview: { key: "d/elsewhere/x.webp" }, thumb: { key: targets.thumb!.key } } })).rejects.toThrow(/wm_preview must be at .*; thumb was not uploaded/);
  });

  it("makes an image ready with its metadata and sizes, and keeps the original", async () => {
    const f = await pendingFile();
    await tt.claim(f.fileId);
    const outputs = await runOutputs(f.fileId);
    expect(await tt.complete(f.fileId, { sha256: SHA.toUpperCase(), width: 1200, height: 800, outputs })).toMatchObject({ state: "ready", alreadyDone: false });
    const [row] = await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, f.fileId));
    expect(row).toMatchObject({ processing: "ready", sha256: SHA, width: 1200, height: 800, claimedAt: null, previewKey: outputs.preview!.key, wmPreviewKey: outputs.wm_preview!.key, thumbKey: outputs.thumb!.key, posterKey: null });
    expect(row!.derivedBytes).toBe("made-preview".length + "made-wm_preview".length + "made-thumb".length);
    expect(row!.originalKey).not.toBeNull();
    expect(await c.store.head(row!.originalKey!)).not.toBeNull();
  });

  it("is idempotent: the same report twice is fine, a different one after is refused", async () => {
    const f = await pendingFile();
    await tt.claim(f.fileId);
    const outputs = await runOutputs(f.fileId);
    const body = { sha256: SHA, width: 10, height: 10, outputs };
    await tt.complete(f.fileId, body);
    expect(await tt.complete(f.fileId, body)).toMatchObject({ alreadyDone: true });
    await expect(tt.complete(f.fileId, { ...body, outputs: { ...outputs, thumb: { key: "d/x/thumb.webp" } } })).rejects.toMatchObject({ status: 409 });
  });

  it("needs the timing of a video, and deletes the video's original to save space", async () => {
    const f = await pendingFile("video");
    await tt.claim(f.fileId);
    const outputs = await runOutputs(f.fileId);
    const [before] = await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, f.fileId));
    await expect(tt.complete(f.fileId, { sha256: SHA, width: 1280, height: 720, outputs })).rejects.toMatchObject({ status: 422 });
    await tt.complete(f.fileId, { sha256: SHA, width: 1280, height: 720, durationS: 12.5, fpsNum: 30000, fpsDen: 1001, outputs });
    const [row] = await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, f.fileId));
    expect(row).toMatchObject({ processing: "ready", originalKey: null, durationS: 12.5, fpsNum: 30000, fpsDen: 1001, posterKey: outputs.poster!.key });
    expect(await c.store.head(before!.originalKey!)).toBeNull();
  });

  it("keeps a video's original with KEEP_VIDEO_ORIGINALS=1", async () => {
    process.env.KEEP_VIDEO_ORIGINALS = "1";
    try {
      const f = await pendingFile("video");
      const outputs = await runOutputs(f.fileId);
      await tt.complete(f.fileId, { sha256: SHA, width: 1280, height: 720, durationS: 1, fpsNum: 25, fpsDen: 1, outputs });
      const [row] = await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, f.fileId));
      expect(row!.originalKey).not.toBeNull();
    } finally {
      delete process.env.KEEP_VIDEO_ORIGINALS;
    }
  });
});

describe("fail and retry", () => {
  it("puts a retryable failure back in the queue until the third attempt, then marks it failed", async () => {
    const f = await pendingFile();
    await tt.claim(f.fileId);
    expect(await tt.fail(f.fileId, { message: "ffmpeg crashed", retryable: true })).toMatchObject({ state: "pending" });
    await tt.claim(f.fileId);
    await tt.claim(f.fileId, new Date(Date.now() + tt.CLAIM_TTL_MS + 1000));
    expect(await tt.fail(f.fileId, { message: "ffmpeg crashed again", retryable: true })).toMatchObject({ state: "failed" });
    const [row] = await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, f.fileId));
    expect(row).toMatchObject({ processing: "failed", error: "ffmpeg crashed again", claimedAt: null });
  });

  it("marks a file failed at once when it can't be read, and the owner's Retry starts it fresh", async () => {
    const f = await pendingFile();
    await tt.claim(f.fileId);
    await tt.fail(f.fileId, { message: "This video couldn't be read. Export it as an H.264 MP4." });
    await expect(tt.retryFile(org.orgId, f.fileId)).resolves.toBeUndefined();
    const [row] = await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, f.fileId));
    expect(row).toMatchObject({ processing: "pending", error: null, attempts: 0 });
    const other = await c.org("other");
    await expect(tt.retryFile(other.orgId, f.fileId)).rejects.toMatchObject({ status: 409 });
  });
});

describe("the webhook", () => {
  it("posts file.uploaded with a signature Tamtree can check, and never throws", async () => {
    const { verifyWebhook } = await import("@/lib/tamtree");
    const f = await pendingFile();
    process.env.TAMTREE_WEBHOOK_URL = "https://tamtree.test/webhook/tasset";
    process.env.TAMTREE_WEBHOOK_SECRET = "hook-secret";
    try {
      const calls: { url: string; init: RequestInit }[] = [];
      const fetcher = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response("ok");
      }) as unknown as typeof fetch;
      expect(await tt.notifyTamtree(f.fileId, fetcher)).toBe(true);
      const h = calls[0]!.init.headers as Record<string, string>;
      const body = calls[0]!.init.body as string;
      expect(calls[0]!.url).toBe("https://tamtree.test/webhook/tasset");
      expect(JSON.parse(body)).toMatchObject({ event: "file.uploaded", fileId: f.fileId, kind: "image" });
      expect(verifyWebhook("hook-secret", h["x-tasset-timestamp"]!, body, h["x-tasset-signature"]!)).toBe(true);

      const broken = (async () => {
        throw new Error("down");
      }) as unknown as typeof fetch;
      expect(await tt.notifyTamtree(f.fileId, broken)).toBe(false);
    } finally {
      delete process.env.TAMTREE_WEBHOOK_URL;
      delete process.env.TAMTREE_WEBHOOK_SECRET;
    }
  });

  it("does nothing when no webhook is set", async () => {
    const f = await pendingFile();
    expect(await tt.notifyTamtree(f.fileId, (() => Promise.reject(new Error("called"))) as unknown as typeof fetch)).toBe(false);
  });
});
