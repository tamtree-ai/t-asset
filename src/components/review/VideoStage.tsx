"use client";

import { type Ref, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import type { Annotation } from "@/lib/studio/annotation";
import { type Fps, formatTimecode, frameToTime, timeToFrame } from "@/lib/studio/timecode";

import { PinLayer } from "./PinLayer";
import { Timeline } from "./Timeline";
import type { CommentView, Placement, StageHandle } from "./types";
import { useFit } from "./useFit";

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];

/**
 * The video player for review: frame stepping (`,` and `.`), J/K/L, speed, a timeline with comment
 * markers, and a pin layer that shows only the pins that belong to the frame on screen. Placing a
 * pin pauses and records the exact time and frame.
 */
export function VideoStage({
  src,
  poster,
  width,
  height,
  fps,
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
  poster?: string;
  width: number;
  height: number;
  fps: Fps | null;
  threads: CommentView[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onHover: (id: string | null) => void;
  draft: Annotation | null;
  capturing: boolean;
  onPlace: (a: Placement) => void;
  handle: Ref<StageHandle>;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const fit = useFit(frame, width / height);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState(false);
  const rate0 = useRef(1);
  const f: Fps = useMemo(() => ({ num: fps?.num ?? 30, den: fps?.den ?? 1 }), [fps?.num, fps?.den]);

  // The displayed frame's own time, when the browser can tell us (it can't when it hasn't painted yet).
  useEffect(() => {
    const v = video.current as (HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number; cancelVideoFrameCallback?: (id: number) => void }) | null;
    if (!v) return;
    let id = 0;
    let raf = 0;
    if (v.requestVideoFrameCallback) {
      const tick = (_n: number, meta: { mediaTime: number }) => {
        setTime(meta.mediaTime);
        id = v.requestVideoFrameCallback!(tick);
      };
      id = v.requestVideoFrameCallback(tick);
    } else {
      const loop = () => {
        setTime(v.currentTime);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    // A seek while paused paints a frame without the callback in some browsers.
    const onSeeked = () => setTime(v.currentTime);
    v.addEventListener("seeked", onSeeked);
    return () => {
      if (id) v.cancelVideoFrameCallback?.(id);
      cancelAnimationFrame(raf);
      v.removeEventListener("seeked", onSeeked);
    };
  }, [src]);

  const seek = useCallback((t: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.min(v.duration || t, Math.max(0, t));
    setTime(v.currentTime);
  }, []);

  const setSpeed = useCallback((r: number) => {
    const v = video.current;
    if (v) v.playbackRate = r;
    rate0.current = r;
    setRate(r);
  }, []);

  const step = useCallback(
    (n: number) => {
      const v = video.current;
      if (!v) return;
      v.pause();
      const current = timeToFrame(v.currentTime, f);
      // The middle of the frame, so rounding can't land on its neighbour.
      v.currentTime = Math.min(v.duration || Infinity, frameToTime(Math.max(0, current + n), f) + (0.5 * f.den) / f.num);
    },
    [f],
  );

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);

  useImperativeHandle(
    handle,
    () => ({
      time: () => video.current?.currentTime ?? 0,
      seek,
      pause: () => video.current?.pause(),
      toggle,
      step,
      speed: (d) => {
        const i = SPEEDS.indexOf(rate0.current);
        setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (i < 0 ? 2 : i) + d))]!);
      },
      reset: () => undefined,
      focus: () => undefined,
    }),
    [seek, toggle, step, setSpeed],
  );

  const place = (a: Omit<Placement, "t" | "frame">) => {
    const v = video.current;
    v?.pause();
    const t = v?.currentTime ?? time;
    onPlace({ ...a, t, frame: timeToFrame(t, f) });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={frame} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/90">
        {fit.w > 0 && (
          <div className="relative" style={{ width: fit.w, height: fit.h }}>
            <video
              ref={video}
              src={src}
              poster={poster}
              playsInline
              preload="metadata"
              className="size-full bg-black"
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              onDurationChange={(e) => setDuration(e.currentTarget.duration)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => setError(true)}
              onClick={() => !capturing && toggle()}
            />
            <PinLayer threads={threads} activeId={activeId} onActivate={onActivate} onHover={onHover} draft={draft} capturing={capturing} time={time} onPlace={place} />
          </div>
        )}
        {error && <p role="alert" className="absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-[14px] text-white">This video couldn’t be played. Reload the page, or tell the studio.</p>}
      </div>

      <div className="flex flex-col gap-1 border-t border-room-line bg-room-surface px-3 pb-2 pt-1">
        <Timeline duration={duration} time={time} threads={threads} activeId={activeId} draft={draft} onSeek={seek} onActivate={onActivate} onHover={onHover} />
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={toggle} className="h-8 w-9 rounded-md border border-room-line hover:bg-room-raised">
            {playing ? "❚❚" : "▶"}
          </button>
          <button type="button" aria-label="Back one frame" title="Back one frame ( , )" onClick={() => step(-1)} className="h-8 w-9 rounded-md border border-room-line hover:bg-room-raised">
            ◂
          </button>
          <button type="button" aria-label="Forward one frame" title="Forward one frame ( . )" onClick={() => step(1)} className="h-8 w-9 rounded-md border border-room-line hover:bg-room-raised">
            ▸
          </button>
          <span className="num ml-1 min-w-[88px] text-room-fg" aria-live="off">
            {formatTimecode(time, f)}
          </span>
          <span className="num text-room-muted">/ {formatTimecode(duration, f)}</span>
          <span className="flex-1" />
          <label className="flex items-center gap-1.5 text-room-muted">
            Speed
            <select aria-label="Playback speed" value={rate} onChange={(e) => setSpeed(Number(e.target.value))} className="h-8 rounded-md border border-room-line bg-room-surface px-1.5 text-room-fg">
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
