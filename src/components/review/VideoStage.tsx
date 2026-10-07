"use client";

import { type Ref, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import type { Annotation } from "@/lib/studio/annotation";
import { type Fps, formatTimecode, frameToTime, timeToFrame } from "@/lib/studio/timecode";

import { PinLayer } from "./PinLayer";
import { Timeline } from "./Timeline";
import type { CommentView, Placement, StageHandle } from "./types";
import { type Inset, useFit } from "./useFit";

/** Room for the floating pills above, and the comment tool and player bar below. */
const inset = (w: number): Inset => (w < 640 ? { t: 108, r: 0, b: 168, l: 0 } : { t: 76, r: 40, b: 176, l: 40 });

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
  const fit = useFit(frame, width / height, inset);
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

  const ctl = "inline-flex size-8 items-center justify-center rounded-xl text-room-fg-2 transition-colors hover:bg-room-raised hover:text-room-fg";
  return (
    <div className="relative min-h-0 flex-1">
      <div ref={frame} className="absolute inset-0 overflow-hidden">
        {fit.w > 0 && (
          <div className="absolute left-1/2 top-1/2 overflow-hidden rounded-[6px] shadow-[0_24px_64px_-24px_rgb(0_0_0/0.45)]" style={{ width: fit.w, height: fit.h, marginLeft: -fit.w / 2 + fit.dx, marginTop: -fit.h / 2 + fit.dy }}>
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
        {error && <p role="alert" className="absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-[14px] text-room-fg">This video couldn’t be played. Reload the page, or tell the studio.</p>}
      </div>

      <div className="glass absolute inset-x-3 bottom-3 z-10 mx-auto flex max-w-[960px] flex-col rounded-2xl px-3 pb-2 pt-1 sm:inset-x-6 sm:bottom-5">
        <Timeline duration={duration} time={time} threads={threads} activeId={activeId} draft={draft} onSeek={seek} onActivate={onActivate} onHover={onHover} />
        <div className="flex items-center gap-1 text-[12.5px]">
          <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={toggle} className="inline-flex size-9 items-center justify-center rounded-full bg-room-fg text-room-surface transition-opacity hover:opacity-90">
            <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="currentColor">{playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />}</svg>
          </button>
          <button type="button" aria-label="Back one frame" title="Back one frame ( , )" onClick={() => step(-1)} className={ctl}>
            <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 6-6 6 6 6" /></svg>
          </button>
          <button type="button" aria-label="Forward one frame" title="Forward one frame ( . )" onClick={() => step(1)} className={ctl}>
            <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
          </button>
          <span className="num ml-2 text-room-fg" aria-live="off">
            {formatTimecode(time, f)}
          </span>
          <span className="num text-room-muted">/ {formatTimecode(duration, f)}</span>
          <span className="flex-1" />
          <label className="flex items-center">
            <span className="sr-only">Speed</span>
            <select aria-label="Playback speed" value={rate} onChange={(e) => setSpeed(Number(e.target.value))} className="num h-8 appearance-none rounded-xl bg-transparent px-2.5 text-center text-room-fg-2 outline-none hover:bg-room-raised">
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
