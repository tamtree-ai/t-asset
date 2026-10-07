/**
 * Plays Tamtree's part on this machine (plan §5.3, R7), with ffmpeg and sharp. It speaks the same
 * HTTP contract the real Tamtree flow will, so it doubles as the reference for building that flow:
 *
 *   GET  /api/tamtree/pending              → files waiting
 *   POST /api/tamtree/files/<id>/claim     → take one
 *   GET  /api/tamtree/files/<id>           → original (signed URL), outputs wanted, watermark text
 *   POST /api/tamtree/files/<id>/targets   → a signed PUT per output
 *   PUT  <target.url>                      → upload each output with target.headers
 *   POST /api/tamtree/files/<id>/complete  → sha256, size, timing, output keys
 *   POST /api/tamtree/files/<id>/fail      → a message for the owner
 *
 * Usage: pnpm fake-tamtree            (poll every 3 s)
 *        pnpm fake-tamtree --once     (process what's waiting, then exit)
 * Needs APP_URL and TAMTREE_API_TOKEN (from .env.local), and ffmpeg on PATH.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import sharp from "sharp";

import { watermarkSvg } from "../src/lib/studio/watermark";
import { parseProbe, proxySize, type VideoInfo } from "./reference/video-plan";

const APP = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const TOKEN = process.env.TAMTREE_API_TOKEN ?? "";
const POLL_MS = Number(process.env.FAKE_TAMTREE_POLL_MS ?? 3000);

type Output = { name: string; key: string; contentType: string; maxBytes: number };
type Job = { fileId: string; kind: "image" | "video"; mime: string; source: { url: string } | null; outputs: Output[]; watermarkText: string };
type Target = { method: "PUT"; url: string; headers: Record<string, string>; key: string };
type Made = { files: Record<string, string>; width: number; height: number; durationS?: number | null; fpsNum?: number; fpsDen?: number };

/** A message for the owner; anything else is reported as retryable. */
class Explained extends Error {}

async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${APP}/api/tamtree${route}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(`${method} ${route}: ${res.status} ${json.error ?? ""}`), { status: res.status });
  return json;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.trim().split("\n").slice(-3).join(" | ")}`))));
  });
}

/** Downloads the original, hashing it on the way, so the hash is of the stored bytes. */
async function download(url: string, dest: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Downloading the original failed: ${res.status}`);
  const hash = createHash("sha256");
  const tap = new Transform({
    transform(chunk: Buffer, _e, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), tap, createWriteStream(dest));
  return hash.digest("hex");
}

async function processImage(src: string, tmp: string, text: string): Promise<Made> {
  let meta;
  try {
    meta = await sharp(src, { limitInputPixels: 400_000_000 }).metadata();
  } catch {
    throw new Explained("This image couldn't be read. Export it as a PNG or JPG and upload it again.");
  }
  const turned = (meta.orientation ?? 1) >= 5;
  const width = turned ? meta.height : meta.width;
  const height = turned ? meta.width : meta.height;
  if (!width || !height) throw new Explained("This image has no size. Export it as a PNG or JPG and upload it again.");
  const img = () => sharp(src, { limitInputPixels: 400_000_000 }).rotate();
  const preview = await img().resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer({ resolveWithObject: true });
  const wm = await sharp(preview.data).composite([{ input: Buffer.from(watermarkSvg(preview.info.width, preview.info.height, text)) }]).webp({ quality: 85 }).toBuffer();
  const thumb = await img().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  const files: Record<string, string> = {};
  for (const [name, buf] of [["preview", preview.data], ["wm_preview", wm], ["thumb", thumb]] as const) {
    files[name] = path.join(tmp, `${name}.webp`);
    await writeFile(files[name]!, buf);
  }
  return { files, width, height };
}

async function processVideo(src: string, tmp: string, text: string): Promise<Made> {
  let info: VideoInfo;
  try {
    info = parseProbe(JSON.parse(await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", src])));
  } catch (e) {
    if ((e as Error).message.includes("no video")) throw new Explained((e as Error).message);
    throw new Explained("This video couldn't be read. Export it as an H.264 MP4 or MOV and upload it again.");
  }
  const size = proxySize(info.width, info.height);
  const scale = `scale=${size.width}:${size.height}`;
  const encode = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", "2500k", "-bufsize", "5000k", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"];
  const audio = info.hasAudio ? ["-map", "0:a:0"] : [];
  const files: Record<string, string> = { preview: path.join(tmp, "preview.mp4"), wm_preview: path.join(tmp, "wm_preview.mp4"), poster: path.join(tmp, "poster.jpg"), thumb: path.join(tmp, "thumb.webp") };
  await run("ffmpeg", ["-y", "-v", "error", "-i", src, "-map", "0:v:0", ...audio, "-vf", scale, ...encode, files.preview!]);
  const overlay = path.join(tmp, "wm.png");
  await sharp(Buffer.from(watermarkSvg(size.width, size.height, text))).png().toFile(overlay);
  await run("ffmpeg", ["-y", "-v", "error", "-i", src, "-i", overlay, "-filter_complex", `[0:v]${scale}[b];[b][1:v]overlay=0:0[v]`, "-map", "[v]", ...audio, ...encode, files.wm_preview!]);
  const at = info.durationS ? (info.durationS * 0.1).toFixed(3) : "0";
  await run("ffmpeg", ["-y", "-v", "error", "-ss", at, "-i", files.preview!, "-frames:v", "1", "-q:v", "3", files.poster!]);
  await sharp(files.poster!).resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toFile(files.thumb!);
  return { files, width: size.width, height: size.height, durationS: info.durationS, fpsNum: info.fpsNum, fpsDen: info.fpsDen };
}

async function processOne(fileId: string): Promise<void> {
  try {
    await api("POST", `/files/${fileId}/claim`);
  } catch (e) {
    if ((e as { status?: number }).status === 409) return; // another run has it
    throw e;
  }
  const tmp = await mkdtemp(path.join(tmpdir(), "fake-tamtree-"));
  try {
    const job = await api<Job>("GET", `/files/${fileId}`);
    if (!job.source) throw new Explained("The original is gone, so this file can't be prepared again. Upload it again.");
    const src = path.join(tmp, "original");
    const sha256 = await download(job.source.url, src);
    const made = job.kind === "video" ? await processVideo(src, tmp, job.watermarkText) : await processImage(src, tmp, job.watermarkText);
    const { targets } = await api<{ targets: Record<string, Target> }>("POST", `/files/${fileId}/targets`);
    const outputs: Record<string, { key: string }> = {};
    for (const o of job.outputs) {
      const t = targets[o.name];
      const local = made.files[o.name];
      if (!t || !local) throw new Error(`No ${o.name} to upload.`);
      const res = await fetch(t.url, { method: t.method, headers: { ...t.headers, "content-length": String((await stat(local)).size) }, body: await readFile(local) });
      if (!res.ok) throw new Error(`Uploading ${o.name} failed: ${res.status} ${await res.text()}`);
      outputs[o.name] = { key: t.key };
    }
    await api("POST", `/files/${fileId}/complete`, { sha256, width: made.width, height: made.height, durationS: made.durationS ?? null, fpsNum: made.fpsNum ?? null, fpsDen: made.fpsDen ?? null, outputs });
    console.log(`[fake-tamtree] ready ${fileId} (${job.kind})`);
  } catch (e) {
    const explained = e instanceof Explained;
    console.error(`[fake-tamtree] ${explained ? "failed" : "error"} ${fileId}:`, (e as Error).message);
    await api("POST", `/files/${fileId}/fail`, { message: explained ? (e as Error).message : "Something went wrong while preparing this file. Retry, and if it keeps failing, check the processing log.", retryable: !explained }).catch(() => undefined);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function drain(): Promise<number> {
  const { files } = await api<{ files: { fileId: string }[] }>("GET", "/pending?limit=10");
  for (const f of files) await processOne(f.fileId);
  return files.length;
}

async function main() {
  if (!TOKEN) throw new Error("Set TAMTREE_API_TOKEN (the same value t-asset has).");
  await run("ffmpeg", ["-version"]).catch(() => {
    throw new Error("ffmpeg is not on PATH.");
  });
  if (process.argv.includes("--once")) {
    while ((await drain()) > 0);
    return;
  }
  console.log(`[fake-tamtree] up, polling ${APP} every ${POLL_MS} ms`);
  for (;;) {
    try {
      await drain();
    } catch (e) {
      console.error("[fake-tamtree]", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
