/**
 * Browser only. Makes the renditions the owner's browser is trusted with at upload
 * (planning/2026-10-31-tasset-deliverables): an image's watermarked preview and thumbnail, and a
 * brand guide's raster proofs. The original never leaves the laptop for this; only what is made here
 * is uploaded, to targets from `/api/uploads/renditions`.
 */
import { IMAGE_PREVIEW_EDGE, MAX_DOCUMENT_PAGES, type ProofFormat, PROOF_PAGE_EDGE, THUMB_EDGE } from "./renditions";
import { watermarkSvg } from "./watermark";

export type Target = { method: "PUT"; url: string; headers: Record<string, string> };

/** WebP when the browser can encode it (it keeps a logo's transparency), else PNG. */
export function proofFormat(): ProofFormat {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    return c.toDataURL("image/webp").startsWith("data:image/webp") ? "webp" : "png";
  } catch {
    return "png";
  }
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw the previews. Try Chrome, Edge, Firefox or Safari.");
  return [c, ctx];
}

function toBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("The preview couldn't be encoded."))), type, quality));
}

/** Width and height scaled so the long edge is at most `edge` (never enlarged). */
export function fitEdge(w: number, h: number, edge: number): { w: number; h: number } {
  const s = Math.min(1, edge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** Draws the tiled watermark over the whole canvas. */
async function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, text: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([watermarkSvg(w, h, text, { strong: true })], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    ctx.drawImage(img, 0, 0, w, h);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A dark band along the foot of a proof page, with the licence line in it. */
function drawFooter(ctx: CanvasRenderingContext2D, w: number, h: number, text: string): void {
  const band = Math.max(18, Math.round(Math.min(w, h) * 0.032));
  ctx.fillStyle = "rgba(17,17,17,0.82)";
  ctx.fillRect(0, h - band, w, band);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = Math.round(band * 0.46);
  ctx.font = `600 ${size}px Helvetica, Arial, sans-serif`;
  while (size > 8 && ctx.measureText(text).width > w * 0.94) ctx.font = `600 ${--size}px Helvetica, Arial, sans-serif`;
  ctx.fillText(text, w / 2, h - band / 2);
}

export type ImageRenditions = { facts: { sha256: string; width: number; height: number }; outputs: { wm_preview: Blob; thumb: Blob } };

/** An image's fingerprint and size, its watermarked preview (long edge 2560) and its thumbnail (480). */
export async function makeImageRenditions(file: File, watermarkText: string, format: ProofFormat): Promise<ImageRenditions> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file); // applies EXIF orientation, so width and height are as shown
  } catch {
    throw new Error(`“${file.name}” couldn't be read as an image. Export it as a PNG or JPG and try again.`);
  }
  try {
    const { width, height } = bitmap;
    const type = `image/${format}`;
    const p = fitEdge(width, height, IMAGE_PREVIEW_EDGE);
    const [pc, pctx] = canvasOf(p.w, p.h);
    pctx.drawImage(bitmap, 0, 0, p.w, p.h);
    await drawWatermark(pctx, p.w, p.h, watermarkText);
    const wm_preview = await toBlob(pc, type, 0.86);
    const t = fitEdge(width, height, THUMB_EDGE);
    const [tc, tctx] = canvasOf(t.w, t.h);
    tctx.drawImage(bitmap, 0, 0, t.w, t.h);
    const thumb = await toBlob(tc, type, 0.82);
    const sha256 = await sha256Hex(await file.arrayBuffer());
    return { facts: { sha256, width, height }, outputs: { wm_preview, thumb } };
  } finally {
    bitmap.close();
  }
}

export type DocumentRenditions = { facts: { sha256: string; width: number; height: number; pageCount: number }; outputs: { preview: Blob; wm_preview: Blob; thumb: Blob } };

/** pdf.js's own fonts, character maps and image decoders, for a guide that leans on them; same version as the package. */
const PDFJS_ASSETS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289";

/** Opens the PDF locally; pdf.js reads the page count without rendering, so a guide that is too long is refused before any work. */
async function openPdf(file: File) {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    standardFontDataUrl: `${PDFJS_ASSETS}/standard_fonts/`,
    cMapUrl: `${PDFJS_ASSETS}/cmaps/`,
    wasmUrl: `${PDFJS_ASSETS}/wasm/`,
  });
  try {
    return { task, doc: await task.promise };
  } catch (e) {
    await task.destroy();
    if ((e as { name?: string }).name === "PasswordException") throw new Error(`“${file.name}” is password-protected. Export it without a password and try again.`);
    throw new Error(`“${file.name}” couldn't be read as a PDF. Export it again and retry.`);
  }
}

/**
 * A brand guide's proofs. Every page is rendered to a picture (long edge 1600 px, about 140 dpi on
 * A4): no vector art, no text, no fonts survive. `wm_preview.pdf` has the tiled proof text and the
 * footer on every page; `preview.pdf` is the same pages unmarked; the thumbnail is page 1.
 */
export async function makeDocumentRenditions(
  file: File,
  marks: { proofText: string; footerText: string; studioName: string; title: string },
  format: ProofFormat,
  onPage: (done: number, total: number) => void,
): Promise<DocumentRenditions> {
  const { task, doc } = await openPdf(file);
  try {
    const pageCount = doc.numPages;
    if (pageCount > MAX_DOCUMENT_PAGES) throw new Error(`This guide has ${pageCount} pages, and the most is ${MAX_DOCUMENT_PAGES}. Split the guide, or export it at a smaller size.`);
    const { PDFDocument } = await import("pdf-lib");
    const clean = await PDFDocument.create();
    const marked = await PDFDocument.create();
    // Fresh documents: nothing (XMP, outlines, fonts, links) is carried over from the original.
    for (const [d, title] of [
      [clean, marks.title],
      [marked, `PROOF — ${marks.title}`],
    ] as const) {
      d.setTitle(title);
      d.setAuthor(marks.studioName || "Studio");
      d.setCreator("t-asset");
      d.setProducer("t-asset");
      d.setSubject(marks.footerText);
    }
    let first = { w: 0, h: 0 };
    let thumb: Blob | null = null;
    for (let n = 1; n <= pageCount; n++) {
      onPage(n - 1, pageCount);
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 }); // PDF points
      const size = fitEdge(base.width, base.height, PROOF_PAGE_EDGE);
      const viewport = page.getViewport({ scale: size.w / base.width });
      const [c, ctx] = canvasOf(size.w, size.h);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvas: c, canvasContext: ctx, viewport }).promise;
      if (n === 1) {
        first = { w: c.width, h: c.height };
        const t = fitEdge(c.width, c.height, THUMB_EDGE);
        const [tc, tctx] = canvasOf(t.w, t.h);
        tctx.drawImage(c, 0, 0, t.w, t.h);
        thumb = await toBlob(tc, `image/${format}`, 0.82);
      }
      const cleanJpg = await clean.embedJpg(await (await toBlob(c, "image/jpeg", 0.8)).arrayBuffer());
      clean.addPage([base.width, base.height]).drawImage(cleanJpg, { x: 0, y: 0, width: base.width, height: base.height });
      await drawWatermark(ctx, c.width, c.height, marks.proofText);
      drawFooter(ctx, c.width, c.height, marks.footerText);
      const markedJpg = await marked.embedJpg(await (await toBlob(c, "image/jpeg", 0.8)).arrayBuffer());
      marked.addPage([base.width, base.height]).drawImage(markedJpg, { x: 0, y: 0, width: base.width, height: base.height });
      page.cleanup();
    }
    onPage(pageCount, pageCount);
    const pdf = async (d: typeof clean) => new Blob([(await d.save()) as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
    const sha256 = await sha256Hex(await file.arrayBuffer());
    return { facts: { sha256, width: first.w, height: first.h, pageCount }, outputs: { preview: await pdf(clean), wm_preview: await pdf(marked), thumb: thumb! } };
  } finally {
    await task.destroy();
  }
}

/** One signed PUT of a made rendition. */
export async function putRendition(target: Target, body: Blob): Promise<void> {
  const res = await fetch(target.url, { method: target.method, headers: target.headers, body });
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || `A preview couldn't be uploaded (${res.status}).`);
}
