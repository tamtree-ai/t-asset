/**
 * Deliverable files (planning/2026-10-31-tasset-deliverables, Phase 1): what may be attached to a
 * version, told apart by their first bytes, not by the browser's guess (an AI file arrives as
 * anything from `application/postscript` to an empty type). Shared by the browser and the server.
 */

export const MAX_DELIVERABLE_BYTES = 200 * 1024 * 1024;
/** How much of the start of a file the checks read. */
export const SNIFF_BYTES = 1024;

type Signature = "pdf" | "ps" | "eps-binary" | "zip" | "svg" | "png" | "jpeg" | "tiff" | "otf" | "ttf" | "woff2";

/** Each extension, the type it is stored as, and the signatures it may carry. */
export const DELIVERABLE_TYPES: Record<string, { mime: string; label: string; signatures: Signature[] }> = {
  svg: { mime: "image/svg+xml", label: "SVG", signatures: ["svg"] },
  ai: { mime: "application/illustrator", label: "Illustrator", signatures: ["pdf", "ps"] },
  eps: { mime: "application/postscript", label: "EPS", signatures: ["ps", "eps-binary"] },
  pdf: { mime: "application/pdf", label: "PDF", signatures: ["pdf"] },
  zip: { mime: "application/zip", label: "ZIP", signatures: ["zip"] },
  png: { mime: "image/png", label: "PNG", signatures: ["png"] },
  jpg: { mime: "image/jpeg", label: "JPG", signatures: ["jpeg"] },
  jpeg: { mime: "image/jpeg", label: "JPG", signatures: ["jpeg"] },
  tif: { mime: "image/tiff", label: "TIFF", signatures: ["tiff"] },
  tiff: { mime: "image/tiff", label: "TIFF", signatures: ["tiff"] },
  otf: { mime: "font/otf", label: "Font (OTF)", signatures: ["otf", "ttf"] },
  ttf: { mime: "font/ttf", label: "Font (TTF)", signatures: ["ttf"] },
  woff2: { mime: "font/woff2", label: "Font (WOFF2)", signatures: ["woff2"] },
};

export const DELIVERABLE_ACCEPT = Object.keys(DELIVERABLE_TYPES)
  .map((e) => `.${e}`)
  .join(",");

export const extensionOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

const starts = (b: Uint8Array, bytes: number[], at = 0) => bytes.every((x, i) => b[at + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Skips a BOM, whitespace, the XML prolog, comments and a doctype, and looks for `<svg`. */
function looksLikeSvg(b: Uint8Array): boolean {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(b).replace(/^﻿/, "");
  for (let i = 0; i < 20; i++) {
    text = text.trimStart();
    const skip = text.match(/^(<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>)/i);
    if (!skip) break;
    text = text.slice(skip[0].length);
  }
  return /^<svg[\s>]/i.test(text);
}

function signatureOf(b: Uint8Array): Signature | null {
  if (starts(b, ascii("%PDF-"))) return "pdf";
  if (starts(b, ascii("%!PS"))) return "ps";
  if (starts(b, [0xc5, 0xd0, 0xd3, 0xc6])) return "eps-binary";
  if (starts(b, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts(b, [0xff, 0xd8, 0xff])) return "jpeg";
  if (starts(b, [0x49, 0x49, 0x2a, 0x00]) || starts(b, [0x4d, 0x4d, 0x00, 0x2a])) return "tiff";
  if (starts(b, ascii("OTTO"))) return "otf";
  if (starts(b, [0x00, 0x01, 0x00, 0x00]) || starts(b, ascii("true"))) return "ttf";
  if (starts(b, ascii("wOF2"))) return "woff2";
  if (looksLikeSvg(b)) return "svg";
  return null;
}

/**
 * The stored type and label of a deliverable, or a plain-English refusal: the extension must be one
 * we take, and the first bytes must be what that extension claims.
 */
export function sniffDeliverable(name: string, head: Uint8Array): { ok: true; ext: string; mime: string; label: string } | { ok: false; error: string } {
  const ext = extensionOf(name);
  const type = DELIVERABLE_TYPES[ext];
  if (!type) return { ok: false, error: `“${name}” isn't a type we deliver. Attach SVG, AI, EPS, PDF, ZIP, PNG, JPG, TIFF, OTF, TTF or WOFF2 files.` };
  const sig = signatureOf(head);
  if (!sig || !type.signatures.includes(sig)) return { ok: false, error: `“${name}” doesn't look like a real ${type.label} file. Export it again and retry.` };
  return { ok: true, ext, mime: type.mime, label: type.label };
}
