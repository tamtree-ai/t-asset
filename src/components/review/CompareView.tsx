"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type Fps, formatTimecode, frameToTime, timeToFrame } from "@/lib/studio/timecode";

import { PinLayer } from "./PinLayer";
import { fileUrl, type CommentView, type RoomAssetView, type RoomVersionView } from "./types";
import { useFit } from "./useFit";

type Side = { variationId: string; versionId: string };
const noop = () => undefined;

function label(v: { label: string }, x: RoomVersionView, multi: boolean) {
  return `${multi ? `${v.label} · ` : ""}v${x.number}`;
}

/**
 * Two versions of one asset side by side (plan §4.3 step 4). Images also get a slider overlay.
 * Videos play together: one transport drives both, and a frame step moves both by the same time.
 * Each side shows its own version's pins.
 */
export function CompareView({
  token,
  asset,
  initial,
  loadThreads,
  backHref,
}: {
  token: string;
  asset: RoomAssetView;
  initial: { a: Side; b: Side };
  loadThreads: (versionId: string) => Promise<{ ok: true; data: CommentView[] } | { ok: false; error: string }>;
  backHref: string;
}) {
  const [a, setA] = useState(initial.a);
  const [b, setB] = useState(initial.b);
  const [mode, setMode] = useState<"side" | "slider">("side");
  const [pins, setPins] = useState(true);
  const isVideo = asset.kind === "video";
  const multi = asset.variations.length > 1;

  const resolve = (s: Side) => {
    const variation = asset.variations.find((v) => v.id === s.variationId) ?? asset.variations[0]!;
    const version = variation.versions.find((x) => x.id === s.versionId) ?? variation.versions[variation.versions.length - 1]!;
    return { variation, version };
  };
  const A = resolve(a);
  const B = resolve(b);

  const [threadsA, setThreadsA] = useState<CommentView[]>([]);
  const [threadsB, setThreadsB] = useState<CommentView[]>([]);
  useEffect(() => {
    let live = true;
    void loadThreads(A.version.id).then((r) => live && r.ok && setThreadsA(r.data));
    return () => {
      live = false;
    };
  }, [A.version.id, loadThreads]);
  useEffect(() => {
    let live = true;
    void loadThreads(B.version.id).then((r) => live && r.ok && setThreadsB(r.data));
    return () => {
      live = false;
    };
  }, [B.version.id, loadThreads]);

  // Video compares versions of one option; images may cross options.
  const choices = (side: Side) => (isVideo ? asset.variations.filter((v) => v.id === side.variationId) : asset.variations);

  const picker = (name: string, side: Side, set: (s: Side) => void) => (
    <label className="flex items-center gap-2 text-[12.5px] text-room-muted">
      {name}
      <select
        aria-label={`${name} version`}
        value={`${side.variationId}:${side.versionId}`}
        onChange={(e) => {
          const [variationId, versionId] = e.target.value.split(":");
          set({ variationId: variationId!, versionId: versionId! });
        }}
        className="num h-8 rounded-lg border border-room-line bg-room-surface px-2 text-[13px] text-room-fg"
      >
        {choices(side).flatMap((v) =>
          [...v.versions].reverse().map((x) => (
            <option key={x.id} value={`${v.id}:${x.id}`}>
              {label(v, x, multi && !isVideo)}
            </option>
          )),
        )}
      </select>
    </label>
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-room-line bg-room-surface px-4 py-2.5">
        <Link href={backHref} className="text-[13px] font-medium text-brand-text hover:underline">
          ← Back to the review
        </Link>
        <h1 className="text-[17px] font-semibold leading-none tracking-[-0.015em]">Compare · {asset.title}</h1>
        <span className="flex-1" />
        {picker("Left", a, setA)}
        {picker("Right", b, setB)}
        {!isVideo && (
          <div role="tablist" aria-label="Compare mode" className="flex gap-1">
            {(["side", "slider"] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`h-8 rounded-lg px-3 text-[13px] ${mode === m ? "bg-brand font-semibold text-brand-ink" : "border border-room-line hover:bg-room-raised"}`}>
                {m === "side" ? "Side by side" : "Slider"}
              </button>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-[12.5px] text-room-fg-2">
          <input type="checkbox" checked={pins} onChange={(e) => setPins(e.target.checked)} />
          Show pins
        </label>
      </header>

      {isVideo ? (
        <CompareVideos token={token} a={A.version} b={B.version} labelA={label(A.variation, A.version, false)} labelB={label(B.variation, B.version, false)} threadsA={pins ? threadsA : []} threadsB={pins ? threadsB : []} />
      ) : mode === "slider" ? (
        <SliderCompare token={token} a={A.version} b={B.version} labelA={label(A.variation, A.version, multi)} labelB={label(B.variation, B.version, multi)} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-room-line md:grid-cols-2">
          <ImagePane token={token} version={A.version} title={label(A.variation, A.version, multi)} threads={pins ? threadsA : []} />
          <ImagePane token={token} version={B.version} title={label(B.variation, B.version, multi)} threads={pins ? threadsB : []} />
        </div>
      )}
    </div>
  );
}

function ImagePane({ token, version, title, threads }: { token: string; version: RoomVersionView; title: string; threads: CommentView[] }) {
  const frame = useRef<HTMLDivElement>(null);
  const w = version.file.width ?? 1600;
  const h = version.file.height ?? 1200;
  const fit = useFit(frame, w / h);
  return (
    <section className="flex min-h-[260px] min-w-0 flex-col bg-room-bg" aria-label={title}>
      <h2 className="px-4 py-2 text-[13px] font-semibold">{title}</h2>
      <div ref={frame} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2">
        {fit.w > 0 && (
          <div className="relative" style={{ width: fit.w, height: fit.h }}>
            <img src={fileUrl("client", token, version.file.id, "preview")} alt={title} className="size-full shadow-[0_2px_24px_rgb(0_0_0/0.12)]" draggable={false} />
            <PinLayer threads={threads} activeId={null} onActivate={noop} onHover={noop} draft={null} capturing={false} time={null} onPlace={noop} />
          </div>
        )}
      </div>
    </section>
  );
}

/** One picture over the other with a draggable divider. Both are drawn at the left version's proportions. */
function SliderCompare({ token, a, b, labelA, labelB }: { token: string; a: RoomVersionView; b: RoomVersionView; labelA: string; labelB: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const aspect = (a.file.width ?? 1600) / (a.file.height ?? 1200);
  const fit = useFit(frame, aspect);
  const [pos, setPos] = useState(0.5);
  return (
    <div ref={frame} className="relative flex min-h-0 flex-1 items-center justify-center bg-room-bg p-2">
      {fit.w > 0 && (
        <div
          className="relative select-none overflow-hidden shadow-[0_2px_24px_rgb(0_0_0/0.12)]"
          style={{ width: fit.w, height: fit.h, touchAction: "none" }}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            const r = e.currentTarget.getBoundingClientRect();
            setPos(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
          }}
          onPointerMove={(e) => {
            if (e.buttons !== 1) return;
            const r = e.currentTarget.getBoundingClientRect();
            setPos(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
          }}
        >
          <img src={fileUrl("client", token, b.file.id, "preview")} alt={labelB} className="absolute inset-0 size-full object-contain" draggable={false} />
          <img src={fileUrl("client", token, a.file.id, "preview")} alt={labelA} className="absolute inset-0 size-full object-contain" style={{ clipPath: `inset(0 ${(1 - pos) * 100}% 0 0)` }} draggable={false} />
          <div aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.3)]" style={{ left: `${pos * 100}%` }}>
            <span className="absolute left-1/2 top-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[12px] shadow">↔</span>
          </div>
          <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[12px] text-white">{labelA}</span>
          <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[12px] text-white">{labelB}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(pos * 100)}
            onChange={(e) => setPos(Number(e.target.value) / 100)}
            aria-label="Compare slider"
            className="sr-only"
          />
        </div>
      )}
    </div>
  );
}

function CompareVideos({ token, a, b, labelA, labelB, threadsA, threadsB }: { token: string; a: RoomVersionView; b: RoomVersionView; labelA: string; labelB: string; threadsA: CommentView[]; threadsB: CommentView[] }) {
  const va = useRef<HTMLVideoElement>(null);
  const vb = useRef<HTMLVideoElement>(null);
  const frameA = useRef<HTMLDivElement>(null);
  const frameB = useRef<HTMLDivElement>(null);
  const fitA = useFit(frameA, (a.file.width ?? 1920) / (a.file.height ?? 1080));
  const fitB = useFit(frameB, (b.file.width ?? 1920) / (b.file.height ?? 1080));
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const fps: Fps = useMemo(() => ({ num: a.file.fpsNum ?? 30, den: a.file.fpsDen ?? 1 }), [a.file.fpsNum, a.file.fpsDen]);
  const duration = Math.max(a.file.durationS ?? 0, b.file.durationS ?? 0);

  const both = useCallback((fn: (v: HTMLVideoElement) => void) => {
    for (const r of [va, vb]) if (r.current) fn(r.current);
  }, []);

  const seek = useCallback(
    (t: number) => {
      both((v) => {
        v.currentTime = Math.min(v.duration || t, Math.max(0, t));
      });
      setTime(t);
    },
    [both],
  );

  // One clock: the left video leads, the right one is nudged back whenever it drifts.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const lead = va.current;
      const follow = vb.current;
      if (lead) {
        setTime(lead.currentTime);
        if (follow && !lead.paused && Math.abs(follow.currentTime - lead.currentTime) > 0.08) follow.currentTime = lead.currentTime;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toggle = () => {
    const lead = va.current;
    if (!lead) return;
    if (lead.paused) {
      both((v) => void v.play().catch(() => undefined));
      setPlaying(true);
    } else {
      both((v) => v.pause());
      setPlaying(false);
    }
  };
  const step = (n: number) => {
    both((v) => v.pause());
    setPlaying(false);
    const t = frameToTime(Math.max(0, timeToFrame(va.current?.currentTime ?? 0, fps) + n), fps) + (0.5 * fps.den) / fps.num;
    seek(t);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === " " || e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      } else if (e.key === "," || e.key === "ArrowLeft") step(-1);
      else if (e.key === "." || e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pane = (v: RoomVersionView, title: string, ref: React.RefObject<HTMLVideoElement | null>, frame: React.RefObject<HTMLDivElement | null>, fit: { w: number; h: number }, threads: CommentView[]) => (
    <section className="flex min-h-[220px] min-w-0 flex-col bg-room-bg" aria-label={title}>
      <h2 className="px-4 py-2 text-[13px] font-semibold">{title}</h2>
      <div ref={frame} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/90">
        {fit.w > 0 && (
          <div className="relative" style={{ width: fit.w, height: fit.h }}>
            <video ref={ref} src={fileUrl("client", token, v.file.id, "preview")} playsInline preload="metadata" muted={ref === vb} className="size-full bg-black" onEnded={() => setPlaying(false)} />
            <PinLayer threads={threads} activeId={null} onActivate={noop} onHover={noop} draft={null} capturing={false} time={time} onPlace={noop} />
          </div>
        )}
      </div>
    </section>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-room-line md:grid-cols-2">
        {pane(a, labelA, va, frameA, fitA, threadsA)}
        {pane(b, labelB, vb, frameB, fitB, threadsB)}
      </div>
      <div className="flex flex-col gap-1 border-t border-room-line bg-room-surface px-4 pb-3 pt-2">
        <input type="range" aria-label="Seek both videos" min={0} max={Math.max(0.01, duration)} step={1 / 120} value={Math.min(time, duration || time)} onChange={(e) => seek(Number(e.target.value))} className="w-full accent-[var(--brand-accent)]" />
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <button type="button" aria-label={playing ? "Pause both" : "Play both"} onClick={toggle} className="h-8 w-9 rounded-md border border-room-line hover:bg-room-raised">
            {playing ? "❚❚" : "▶"}
          </button>
          <button type="button" aria-label="Back one frame" onClick={() => step(-1)} className="h-8 w-9 rounded-md border border-room-line hover:bg-room-raised">
            ◂
          </button>
          <button type="button" aria-label="Forward one frame" onClick={() => step(1)} className="h-8 w-9 rounded-md border border-room-line hover:bg-room-raised">
            ▸
          </button>
          <span className="num ml-1 text-room-fg">{formatTimecode(time, fps)}</span>
          <span className="num text-room-muted">/ {formatTimecode(duration, fps)}</span>
          <span className="flex-1" />
          <label className="flex items-center gap-1.5 text-room-muted">
            Speed
            <select
              aria-label="Playback speed"
              value={rate}
              onChange={(e) => {
                const r = Number(e.target.value);
                setRate(r);
                both((v) => (v.playbackRate = r));
              }}
              className="h-8 rounded-md border border-room-line bg-room-surface px-1.5 text-room-fg"
            >
              {[0.25, 0.5, 1, 1.5, 2].map((s) => (
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
