"use client";

/* eslint-disable @next/next/no-img-element */
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";

import type { Annotation } from "@/lib/studio/annotation";
import { zoomAbout } from "@/lib/studio/pins";

import { PinLayer } from "./PinLayer";
import type { CommentView, StageHandle } from "./types";
import { type Inset, useFit } from "./useFit";

/** Room for the floating pills above and the comment tool below. */
const inset = (w: number): Inset => (w < 640 ? { t: 108, r: 12, b: 76, l: 12 } : { t: 76, r: 40, b: 88, l: 40 });

const MAX_ZOOM = 8;

/** An image with zoom (wheel, pinch, buttons) and pan, and pins that stay glued to the picture. */
export function ImageStage({
  src,
  alt,
  width,
  height,
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
  width: number;
  height: number;
  threads: CommentView[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onHover: (id: string | null) => void;
  draft: Annotation | null;
  capturing: boolean;
  onPlace: (a: Pick<Annotation, "shape" | "x" | "y" | "w" | "h">) => void;
  handle: Ref<StageHandle>;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const fit = useFit(frame, width / height, inset);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [animate, setAnimate] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number } | null>(null);
  const panFrom = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const centre = () => {
    const r = frame.current!.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  };

  /** Keep some of the picture on screen however far it is dragged. */
  const clampPan = (v: { scale: number; x: number; y: number }) => {
    if (v.scale <= 1) return { ...v, x: 0, y: 0 };
    const mx = (fit.w * v.scale) / 2;
    const my = (fit.h * v.scale) / 2;
    return { ...v, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) };
  };

  const zoomBy = (factor: number, at?: { x: number; y: number }) => {
    setAnimate(false);
    setView((v) => clampPan(zoomAbout(v, factor, at ?? { x: 0, y: 0 }, { min: 1, max: MAX_ZOOM })));
  };

  useImperativeHandle(
    handle,
    () => ({
      time: () => 0,
      seek: () => undefined,
      pause: () => undefined,
      toggle: () => undefined,
      step: (n) => zoomBy(n > 0 ? 1.5 : 1 / 1.5),
      speed: () => undefined,
      reset: () => {
        setAnimate(true);
        setView({ scale: 1, x: 0, y: 0 });
      },
      focus: (x, y) => {
        setAnimate(true);
        setView((v) => {
          const scale = Math.max(v.scale, 2.5);
          return clampPan({ scale, x: -(x - 0.5) * fit.w * scale, y: -(y - 0.5) * fit.h * scale });
        });
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fit.w, fit.h],
  );

  // Wheel zooms about the cursor. It needs preventDefault, which React's passive wheel listener refuses.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { cx, cy } = centre();
      zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), { x: e.clientX - cx, y: e.clientY - cy });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit.w, fit.h]);

  const down = (e: React.PointerEvent) => {
    if (capturing) return;
    if ((e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale: view.scale };
      panFrom.current = null;
    } else panFrom.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  };
  const move = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setAnimate(false);
    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const { cx, cy } = centre();
      const mid = { x: (a!.x + b!.x) / 2 - cx, y: (a!.y + b!.y) / 2 - cy };
      setView((v) => clampPan(zoomAbout(v, (gesture.current!.scale * dist) / gesture.current!.dist / v.scale, mid, { min: 1, max: MAX_ZOOM })));
    } else if (panFrom.current && view.scale > 1) {
      setView(clampPan({ scale: view.scale, x: panFrom.current.vx + e.clientX - panFrom.current.x, y: panFrom.current.vy + e.clientY - panFrom.current.y }));
    }
  };
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (pointers.current.size === 0) panFrom.current = null;
  };

  return (
    <div
      ref={frame}
      className={`relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden ${view.scale > 1 && !capturing ? "cursor-grab active:cursor-grabbing" : ""}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => !capturing && (view.scale > 1 ? (setAnimate(true), setView({ scale: 1, x: 0, y: 0 })) : zoomBy(2.5))}
    >
      {fit.w > 0 && (
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            width: fit.w,
            height: fit.h,
            marginLeft: -fit.w / 2 + fit.dx,
            marginTop: -fit.h / 2 + fit.dy,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transition: animate ? "transform 220ms var(--ease-out)" : "none",
            ["--zoom" as string]: view.scale,
          }}
        >
          <img src={src} alt={alt} draggable={false} className="size-full select-none rounded-[3px] shadow-[0_1px_2px_rgb(0_0_0/0.06),0_24px_64px_-24px_rgb(0_0_0/0.35)]" />
          <PinLayer threads={threads} activeId={activeId} onActivate={onActivate} onHover={onHover} draft={draft} capturing={capturing} time={null} onPlace={onPlace} />
        </div>
      )}

      <div className="glass absolute bottom-5 right-4 z-10 hidden items-center gap-0.5 rounded-2xl p-1 text-[12px] sm:flex">
        <button type="button" aria-label="Zoom out" className="size-8 rounded-xl text-room-fg-2 transition-colors hover:bg-room-raised hover:text-room-fg" onClick={() => zoomBy(1 / 1.5)}>
          −
        </button>
        <button type="button" aria-label="Fit to screen" className="num h-8 min-w-12 rounded-xl px-1.5 text-room-fg-2 transition-colors hover:bg-room-raised hover:text-room-fg" onClick={() => (setAnimate(true), setView({ scale: 1, x: 0, y: 0 }))}>
          {Math.round(view.scale * 100)}%
        </button>
        <button type="button" aria-label="Zoom in" className="size-8 rounded-xl text-room-fg-2 transition-colors hover:bg-room-raised hover:text-room-fg" onClick={() => zoomBy(1.5)}>
          +
        </button>
      </div>
    </div>
  );
}
