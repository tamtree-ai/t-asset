/**
 * The renditions the owner's browser makes at upload (planning/2026-10-31-tasset-deliverables):
 * an image's watermarked preview and thumbnail, and a document's raster proofs. Same shape as the
 * Tamtree contract (`outputsFor`), so the server checks them the same way. No imports beyond types.
 */
import type { OutputSpec } from "@/lib/tamtree";

/** WebP keeps a logo's transparency; a browser that can't encode it sends PNG. */
export type ProofFormat = "webp" | "png";

/** The kinds whose renditions the browser makes. A video's are Tamtree's. */
export type BrowserKind = "image" | "document";

const MB = 1024 * 1024;

/** Long edge of an image's watermarked preview, and of each proof page. */
export const IMAGE_PREVIEW_EDGE = 2560;
export const PROOF_PAGE_EDGE = 1600;
export const THUMB_EDGE = 480;
/** A guide longer than this is refused: the owner's laptop makes every page. */
export const MAX_DOCUMENT_PAGES = 120;

export function browserOutputs(fileId: string, kind: BrowserKind, format: ProofFormat = "webp"): OutputSpec[] {
  const at = (name: string) => `d/${fileId}/${name}`;
  const image = `image/${format}`;
  const thumb: OutputSpec = { name: "thumb", key: at(`thumb.${format}`), contentType: image, maxBytes: 2 * MB, hint: `Long edge at most ${THUMB_EDGE} px, unmarked.` };
  if (kind === "image") {
    return [{ name: "wm_preview", key: at(`wm_preview.${format}`), contentType: image, maxBytes: 15 * MB, hint: `Long edge at most ${IMAGE_PREVIEW_EDGE} px, the watermark tiled over it.` }, thumb];
  }
  return [
    { name: "preview", key: at("preview.pdf"), contentType: "application/pdf", maxBytes: 60 * MB, hint: `Every page rasterised, long edge at most ${PROOF_PAGE_EDGE} px, unmarked.` },
    { name: "wm_preview", key: at("wm_preview.pdf"), contentType: "application/pdf", maxBytes: 60 * MB, hint: "The same pages with the proof watermark and footer." },
    { ...thumb, hint: `Page 1, long edge at most ${THUMB_EDGE} px, unmarked.` },
  ];
}

const BY_EXT: Record<string, string> = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", pdf: "application/pdf", mp4: "video/mp4" };

/** The content type a derived key was made as, from its extension; null when it has none we know. */
export function mimeOfKey(key: string): string | null {
  const ext = key.split("/").pop()?.split(".").pop()?.toLowerCase();
  return (ext && BY_EXT[ext]) || null;
}
