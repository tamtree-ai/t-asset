/**
 * The development store: files on the local disk, uploaded and read through the app's own
 * `/api/dev-blob/<key>` route with HMAC-signed URLs, so uploads, Tamtree and the room behave as
 * they do against Vercel Blob. Production refuses this driver (assertStudioEnv).
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { BlobHead, BlobStore, UploadTarget } from "./types";

export type LocalOp = "get" | "put";

export class BlobTooLarge extends Error {}

export class LocalBlobStore implements BlobStore {
  readonly driver = "local" as const;
  private readonly root: string;

  constructor(
    root: string,
    private readonly baseUrl: string,
    private readonly key: Buffer,
  ) {
    this.root = path.resolve(root);
  }

  /** The key as a path under the root; anything that would escape it is refused. */
  localPath(key: string): string {
    if (!key || key.includes("\0") || key.endsWith(".ct")) throw new Error(`Bad blob key ${JSON.stringify(key)}.`);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error(`Blob key ${key} is outside the store.`);
    return full;
  }

  sign(op: LocalOp, key: string, exp: number, extra = ""): string {
    return createHmac("sha256", this.key).update(`${op}\n${key}\n${exp}\n${extra}`).digest("base64url");
  }

  /** Checks a signed URL's query against the key and operation. */
  verify(op: LocalOp, key: string, q: URLSearchParams, now = Date.now()): boolean {
    const exp = Number(q.get("exp"));
    if (!Number.isFinite(exp) || exp < now) return false;
    const extra = op === "put" ? `${q.get("ct") ?? ""}\n${q.get("max") ?? ""}` : "";
    const want = Buffer.from(this.sign(op, key, exp, extra));
    const got = Buffer.from(q.get("sig") ?? "");
    return want.length === got.length && timingSafeEqual(want, got);
  }

  private url(key: string, params: Record<string, string>): string {
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    return `${this.baseUrl}/api/dev-blob/${encoded}?${new URLSearchParams(params)}`;
  }

  async uploadTarget(key: string, opts: { contentType: string; maxBytes: number; validForS: number }): Promise<UploadTarget> {
    this.localPath(key);
    const exp = Date.now() + opts.validForS * 1000;
    const sig = this.sign("put", key, exp, `${opts.contentType}\n${opts.maxBytes}`);
    return {
      method: "PUT",
      url: this.url(key, { exp: String(exp), ct: opts.contentType, max: String(opts.maxBytes), sig }),
      headers: { "content-type": opts.contentType },
      expiresAt: new Date(exp).toISOString(),
    };
  }

  async readUrl(key: string, opts: { validForS: number; download?: boolean }): Promise<string> {
    this.localPath(key);
    const exp = Date.now() + opts.validForS * 1000;
    return this.url(key, { exp: String(exp), sig: this.sign("get", key, exp), ...(opts.download ? { download: "1" } : {}) });
  }

  async head(key: string): Promise<BlobHead | null> {
    const file = this.localPath(key);
    try {
      const s = await stat(file);
      if (!s.isFile()) return null;
      const contentType = await readFile(`${file}.ct`, "utf8").catch(() => "application/octet-stream");
      return { size: s.size, contentType };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(keys: string[]): Promise<void> {
    for (const key of keys) {
      const file = this.localPath(key);
      await rm(file, { force: true });
      await rm(`${file}.ct`, { force: true });
    }
  }

  /** Writes a body to `key` through a temp file, stopping past `maxBytes`. Used by the dev route and tests. */
  async write(key: string, body: ReadableStream<Uint8Array> | NodeJS.ReadableStream, contentType: string, maxBytes = Infinity): Promise<number> {
    const dest = this.localPath(key);
    await mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${randomUUID()}.tmp`;
    let size = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > maxBytes) return cb(new BlobTooLarge(`The file is larger than ${maxBytes} bytes.`));
        cb(null, chunk);
      },
    });
    const source = "getReader" in body ? Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>) : (body as NodeJS.ReadableStream);
    try {
      await pipeline(source, counter, createWriteStream(tmp));
      await rename(tmp, dest);
      await writeFile(`${dest}.ct`, contentType);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    return size;
  }

  read(key: string, range?: { start: number; end: number }): NodeJS.ReadableStream {
    return createReadStream(this.localPath(key), range);
  }
}
