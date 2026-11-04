"use client";

import { type Ref, useEffect, useState } from "react";

import type { Annotation } from "@/lib/studio/annotation";

import { ImageStage } from "./ImageStage";
import type { CommentView, StageHandle } from "./types";

type Pdf = { numPages: number; getPage(n: number): Promise<PdfPage> };
type PdfPage = { getViewport(o: { scale: number }): { width: number; height: number }; render(o: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> }; cleanup(): void };

/** Rendered no larger than the proof itself (its pages are 1600 px on the long edge). */
const PAGE_EDGE = 1600;

/** Loads a proof PDF once and renders one page of it to a picture; `pages` is known once it has loaded. */
export function useProofPage(src: string, page: number, onPages?: (n: number) => void) {
  const [pdf, setPdf] = useState<Pdf | null>(null);
  const [shown, setShown] = useState<{ page: number; url: string; w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    let task: { destroy(): Promise<void>; promise: Promise<Pdf> } | null = null;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        task = pdfjs.getDocument({ url: src, withCredentials: false }) as unknown as typeof task;
        const doc = await task!.promise;
        if (gone) return;
        setPdf(doc);
        onPages?.(doc.numPages);
      } catch {
        if (!gone) setError("This document couldn't be shown. Reload the page to try again.");
      }
    })();
    return () => {
      gone = true;
      void task?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    if (!pdf) return;
    let gone = false;
    let url: string | null = null;
    const n = Math.min(Math.max(page, 1), pdf.numPages);
    void (async () => {
      try {
        const p = await pdf.getPage(n);
        const base = p.getViewport({ scale: 1 });
        const scale = Math.min(PAGE_EDGE / Math.max(base.width, base.height), 4);
        const viewport = p.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext("2d")!;
        await p.render({ canvas, canvasContext: ctx, viewport }).promise;
        p.cleanup();
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
        if (gone || !blob) return;
        url = URL.createObjectURL(blob);
        setShown({ page: n, url, w: canvas.width, h: canvas.height });
      } catch {
        if (!gone) setError("This page couldn't be shown. Reload the page to try again.");
      }
    })();
    return () => {
      gone = true;
      if (url) setTimeout(() => URL.revokeObjectURL(url!), 1000);
    };
  }, [pdf, page]);

  return { shown, error, pages: pdf?.numPages ?? null };
}

/**
 * A brand guide's proof, one page at a time. The proof is a PDF of pictures, so pdf.js only decodes
 * JPEGs; each page is drawn to a canvas and shown on the image stage, so zoom, pan and pins work as
 * they do on an image.
 */
export function DocumentStage({
  src,
  alt,
  page,
  onPages,
  threads,
  activeId,
  onActivate,
  onHover,
  draft,
  capturing,
  onPlace,
  handle,
}: {
  src: string;
  alt: string;
  page: number;
  onPages: (n: number) => void;
  threads: CommentView[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onHover: (id: string | null) => void;
  draft: Annotation | null;
  capturing: boolean;
  onPlace: (a: Pick<Annotation, "shape" | "x" | "y" | "w" | "h">) => void;
  handle: Ref<StageHandle>;
}) {
  const { shown, error } = useProofPage(src, page, onPages);

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <p className="glass rounded-2xl px-6 py-5 text-[13.5px] text-room-fg-2">{error}</p>
      </div>
    );
  }
  if (!shown) {
    return (
      <div className="flex flex-1 items-center justify-center" role="status" aria-label="Loading the document">
        <span aria-hidden className="size-2 animate-pulse rounded-full bg-brand" />
      </div>
    );
  }
  return (
    <ImageStage
      key={shown.page}
      src={shown.url}
      alt={`${alt}, page ${shown.page}`}
      width={shown.w}
      height={shown.h}
      threads={threads}
      activeId={activeId}
      onActivate={onActivate}
      onHover={onHover}
      draft={draft}
      capturing={capturing}
      onPlace={onPlace}
      handle={handle}
    />
  );
}

/** Previous, next, and a jump to any page. */
export function PageBar({ page, pages, onPage }: { page: number; pages: number; onPage: (n: number) => void }) {
  const btn = "inline-flex size-8 items-center justify-center rounded-xl text-room-fg-2 transition-colors hover:bg-room-raised hover:text-room-fg disabled:opacity-30";
  return (
    <div className="glass pointer-events-auto flex items-center gap-1 rounded-2xl p-1 text-[12.5px]">
      <button type="button" aria-label="Previous page" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ‹
      </button>
      <label className="flex items-center gap-1.5 px-1">
        <span className="sr-only">Page</span>
        <select aria-label="Page" value={page} onChange={(e) => onPage(Number(e.target.value))} className="num h-8 appearance-none rounded-xl bg-transparent px-2 font-medium text-room-fg outline-none hover:bg-room-raised">
          {Array.from({ length: pages }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              Page {i + 1}
            </option>
          ))}
        </select>
        <span className="num text-room-muted">of {pages}</span>
      </label>
      <button type="button" aria-label="Next page" className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)}>
        ›
      </button>
    </div>
  );
}
