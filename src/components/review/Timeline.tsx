"use client";

import { useRef } from "react";

import type { Annotation } from "@/lib/studio/annotation";
import { markerSpan } from "@/lib/studio/pins";

import type { CommentView } from "./types";

/**
 * The scrubber with a mark for every timed comment: a dot for a moment, a bar for a range. The
 * dot shows the commenter's initial, like the avatar dots in Frame.io and Dropbox Replay.
 */
export function Timeline({
  duration,
  time,
  threads,
  activeId,
  draft,
  onSeek,
  onActivate,
  onHover,
}: {
  duration: number;
  time: number;
  threads: CommentView[];
  activeId: string | null;
  draft: Annotation | null;
  onSeek: (t: number) => void;
  onActivate: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const seekTo = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    onSeek(Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration)));
  };
  const pct = (f: number) => `${f * 100}%`;
  const draftSpan = draft ? markerSpan(draft, duration) : null;

  return (
    <div
      ref={track}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      className="relative h-9 cursor-pointer touch-none select-none"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        seekTo(e.clientX);
      }}
      onPointerMove={(e) => e.buttons === 1 && !(e.target as HTMLElement).closest("button") && seekTo(e.clientX)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onSeek(Math.max(0, time - 5));
        if (e.key === "ArrowRight") onSeek(Math.min(duration, time + 5));
      }}
    >
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-room-line" />
      <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-room-fg/30" style={{ width: pct(duration > 0 ? time / duration : 0) }} />

      {threads.map((t) => {
        const a = t.annotation;
        const span = a ? markerSpan(a, duration) : null;
        if (!span) return null;
        const active = activeId === t.id;
        return (
          <div key={t.id} className={t.resolved ? "opacity-50" : ""}>
            {span.width > 0 && <div aria-hidden className={`absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full ${active ? "bg-brand" : "bg-brand/60"}`} style={{ left: pct(span.left), width: pct(span.width) }} />}
            <button
              type="button"
              aria-label={`Comment ${t.number} by ${t.authorLabel}`}
              onClick={() => {
                onActivate(t.id);
              }}
              onMouseEnter={() => onHover(t.id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(t.id)}
              onBlur={() => onHover(null)}
              className={`absolute top-1/2 flex size-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-room-surface text-[9px] font-bold ${active ? "z-10 scale-125 bg-brand-ink text-brand ring-2 ring-brand" : "bg-brand text-brand-ink"}`}
              style={{ left: pct(span.left) }}
            >
              {t.authorLabel.trim().charAt(0).toUpperCase() || "?"}
            </button>
          </div>
        );
      })}

      {draftSpan && (
        <>
          {draftSpan.width > 0 && <div aria-hidden className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full border border-dashed border-brand bg-brand-soft" style={{ left: pct(draftSpan.left), width: pct(draftSpan.width) }} />}
          <span aria-hidden className="absolute top-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-brand bg-white" style={{ left: pct(draftSpan.left) }} />
        </>
      )}

      <div aria-hidden className="pointer-events-none absolute top-1/2 h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-room-fg" style={{ left: pct(duration > 0 ? time / duration : 0) }} />
    </div>
  );
}
