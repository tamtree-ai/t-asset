import { localBlobStore } from "@/lib/blob";
import { BlobTooLarge } from "@/lib/blob/local";
import { attachment, parseRange } from "@/lib/http-range";

/**
 * The local blob driver's bytes (development and tests only; 404 on Vercel Blob). Every request
 * carries a signature from `LocalBlobStore`, like a presigned Vercel Blob URL.
 *
 *   PUT /api/dev-blob/<key>?exp&ct&max&sig   body = the file
 *   GET /api/dev-blob/<key>?exp&sig[&download=1]
 */
type Ctx = { params: Promise<{ key: string[] }> };

const keyOf = async (ctx: Ctx) => (await ctx.params).key.map(decodeURIComponent).join("/");

export async function PUT(req: Request, ctx: Ctx) {
  const store = localBlobStore();
  if (!store) return new Response("Not found.", { status: 404 });
  const key = await keyOf(ctx);
  const q = new URL(req.url).searchParams;
  if (!store.verify("put", key, q)) return new Response("Signature expired or invalid.", { status: 403 });
  const ct = q.get("ct") ?? "";
  if ((req.headers.get("content-type") ?? "").split(";")[0]!.trim() !== ct) return new Response(`This upload only takes ${ct}.`, { status: 415 });
  if (!req.body) return new Response("No body.", { status: 400 });
  try {
    const size = await store.write(key, req.body, ct, Number(q.get("max")));
    return Response.json({ pathname: key, size, contentType: ct });
  } catch (e) {
    if (e instanceof BlobTooLarge) return new Response(e.message, { status: 413 });
    throw e;
  }
}

export async function GET(req: Request, ctx: Ctx) {
  const store = localBlobStore();
  if (!store) return new Response("Not found.", { status: 404 });
  const key = await keyOf(ctx);
  const q = new URL(req.url).searchParams;
  if (!store.verify("get", key, q)) return new Response("Signature expired or invalid.", { status: 403 });
  const h = await store.head(key);
  if (!h) return new Response("Not found.", { status: 404 });

  const headers: Record<string, string> = {
    "content-type": h.contentType,
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
    "cache-control": "private, max-age=300",
    ...(q.get("download") === "1" ? { "content-disposition": attachment(key.split("/").pop() ?? "download") } : {}),
  };
  const range = parseRange(req.headers.get("range"), h.size);
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${h.size}` } });
  const { Readable } = await import("node:stream");
  const body = (r?: { start: number; end: number }) => Readable.toWeb(store.read(key, r) as import("node:stream").Readable) as unknown as ReadableStream<Uint8Array>;
  if (!range) return new Response(body(), { headers: { ...headers, "content-length": String(h.size) } });
  return new Response(body(range), {
    status: 206,
    headers: { ...headers, "content-range": `bytes ${range.start}-${range.end}/${h.size}`, "content-length": String(range.end - range.start + 1) },
  });
}
