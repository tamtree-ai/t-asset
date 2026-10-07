"use client";

import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";

import type { Annotation } from "@/lib/studio/annotation";
import { shapeFromDrag, toNormalised, visibleAt } from "@/lib/studio/pins";

import type { CommentView } from "./types";

/**
 * The overlay on the picture: a numbered pin or box for each commented spot, a dashed one for the
 * comment being written, and, in comment mode, a capture layer that turns a click into a pin and a
 * drag into a box. All positions are fractions of the layer, which the stage sizes to the picture.
 */
export function PinLayer({
  threads,
  activeId,
  onActivate,
  onHover,
  draft,
  capturing,
  time,
  onPlace,
}: {
  threads: CommentView[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onHover: (id: string | null) => void;
  draft: Annotation | null;
  capturing: boolean;
  /** Video time, to show only the pins that belong to this moment; null for an image. */
  time: number | null;
  onPlace: (a: Pick<Annotation, "shape" | "x" | "y" | "w" | "h">) => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);

  const point = (e: ReactPointerEvent) => {
    const r = layer.current!.getBoundingClientRect();
    return toNormalised(e.clientX, e.clientY, { left: r.left, top: r.top, width: r.width, height: r.height });
  };

  const shown = threads.filter((t) => t.annotation && t.annotation.shape !== "time" && (time === null || visibleAt(t.annotation, time)));
  const live = drag ? shapeFromDrag(drag.a, drag.b) : null;

  return (
    <div ref={layer} className="absolute inset-0" style={{ touchAction: capturing ? "none" : "auto" }}>
      {shown.map((t) => {
        const a = t.annotation!;
        const active = activeId === t.id;
        const dim = t.resolved ? "opacity-55 grayscale" : "";
        return (
          <div key={t.id} className={dim}>
            {a.shape === "rect" && (
              <div
                aria-hidden
                className={`pointer-events-none absolute rounded-[3px] border-2 ${active ? "border-brand bg-brand-soft" : "border-brand/80"}`}
                style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${(a.w ?? 0) * 100}%`, height: `${(a.h ?? 0) * 100}%` }}
              />
            )}
            <button
              type="button"
              aria-label={`Comment ${t.number}${t.resolved ? " (resolved)" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onActivate(t.id);
              }}
              onMouseEnter={() => onHover(t.id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(t.id)}
              onBlur={() => onHover(null)}
              className={`num absolute flex size-6 items-center justify-center rounded-full border-2 border-white text-[11px] font-bold shadow-[0_1px_4px_rgb(0_0_0/0.4)] ${capturing ? "pointer-events-none" : ""} ${active ? "bg-brand-ink text-brand ring-2 ring-brand" : "bg-brand text-brand-ink"}`}
              style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, transform: "translate(-50%,-50%) scale(calc(1 / var(--zoom, 1)))" }}
            >
              {t.number}
            </button>
          </div>
        );
      })}

      {draft && draft.shape !== "time" && (
        <div aria-hidden className="pointer-events-none">
          {draft.shape === "rect" && <div className="absolute border-2 border-dashed border-brand bg-brand-soft" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${(draft.w ?? 0) * 100}%`, height: `${(draft.h ?? 0) * 100}%` }} />}
          <span className="absolute size-6 rounded-full border-2 border-dashed border-brand bg-white/80" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, transform: "translate(-50%,-50%) scale(calc(1 / var(--zoom, 1)))" }} />
        </div>
      )}
      {live && live.shape === "rect" && <div aria-hidden className="pointer-events-none absolute border-2 border-dashed border-brand bg-brand-soft" style={{ left: `${live.x * 100}%`, top: `${live.y * 100}%`, width: `${(live.w ?? 0) * 100}%`, height: `${(live.h ?? 0) * 100}%` }} />}

      {capturing && (
        <div
          data-testid="capture-layer"
          className="absolute inset-0 cursor-crosshair"
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            const p = point(e);
            setDrag({ a: p, b: p });
          }}
          onPointerMove={(e) => drag && setDrag({ a: drag.a, b: point(e) })}
          onPointerUp={(e) => {
            if (!drag) return;
            const done = shapeFromDrag(drag.a, point(e));
            setDrag(null);
            onPlace(done);
          }}
          onPointerCancel={() => setDrag(null)}
        />
      )}
    </div>
  );
}
