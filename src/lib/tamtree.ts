/**
 * The Tamtree contract's pure parts (plan §5.3): what renditions a file needs, the webhook
 * signature, and the bearer-token check. No imports beyond node:crypto, so the fake Tamtree script
 * and tests use the same code.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type OutputName = "preview" | "wm_preview" | "poster" | "thumb";

export type OutputSpec = {
  name: OutputName;
  /** Where Tamtree must put it (under `d/<fileId>/`). */
  key: string;
  contentType: string;
  maxBytes: number;
  /** What to make, in plain words, for whoever builds the flow. */
  hint: string;
};

const MB = 1024 * 1024;

/** The renditions a file needs. Every file gets a watermarked twin; the share decides whether it is shown. */
export function outputsFor(fileId: string, kind: "image" | "video"): OutputSpec[] {
  const at = (name: string) => `d/${fileId}/${name}`;
  if (kind === "image") {
    return [
      { name: "preview", key: at("preview.webp"), contentType: "image/webp", maxBytes: 15 * MB, hint: "WebP, long edge at most 2560 px, EXIF orientation applied, quality about 88." },
      { name: "wm_preview", key: at("wm_preview.webp"), contentType: "image/webp", maxBytes: 15 * MB, hint: "The preview with the watermark text tiled over it." },
      { name: "thumb", key: at("thumb.webp"), contentType: "image/webp", maxBytes: 2 * MB, hint: "WebP, long edge at most 480 px." },
    ];
  }
  return [
    { name: "preview", key: at("preview.mp4"), contentType: "video/mp4", maxBytes: 400 * MB, hint: "H.264 + AAC MP4, long edge at most 1280 px, about 2.5 Mb/s, yuv420p, +faststart." },
    { name: "wm_preview", key: at("wm_preview.mp4"), contentType: "video/mp4", maxBytes: 400 * MB, hint: "The preview with the watermark text burnt in." },
    { name: "poster", key: at("poster.jpg"), contentType: "image/jpeg", maxBytes: 5 * MB, hint: "A JPEG frame from about 10% in, same size as the preview." },
    { name: "thumb", key: at("thumb.webp"), contentType: "image/webp", maxBytes: 2 * MB, hint: "WebP of the poster, long edge at most 480 px." },
  ];
}

export const SIGNATURE_HEADER = "x-tasset-signature";
export const TIMESTAMP_HEADER = "x-tasset-timestamp";

/** `sha256=<hex>` over `<timestamp>.<raw body>`, keyed with TAMTREE_WEBHOOK_SECRET. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** What Tamtree's side should do with a delivery: refuse a bad signature or one more than 5 minutes old. */
export function verifyWebhook(secret: string, timestamp: string | null, body: string, signature: string | null, now = Date.now()): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300 || !signature) return false;
  const want = Buffer.from(signWebhook(secret, ts, body));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** `Authorization: Bearer <token>` against the configured token, in constant time. No token configured refuses everyone. */
export function bearerMatches(header: string | null, token: string | null): boolean {
  if (!token) return false;
  const m = header?.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const want = Buffer.from(token);
  const got = Buffer.from(m[1]!.trim());
  return want.length === got.length && timingSafeEqual(want, got);
}
