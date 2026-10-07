"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Annotation } from "@/lib/studio/annotation";
import { counts } from "@/lib/studio/comment-filter";
import { seekTarget } from "@/lib/studio/pins";
import { BrandMark } from "./BrandMark";
import { CommentRail } from "./CommentRail";
import { Composer } from "./Composer";
import { CoverNote } from "./CoverNote";
import { DecisionBar } from "./DecisionBar";
import { ImageStage } from "./ImageStage";
import { ShortcutHelp } from "./ShortcutHelp";
import { IconChevron, IconClose, IconComment, IconCompare, IconDownload, IconExpand, IconKeyboard, IconPanel, IconShrink } from "./icons";
import { fileUrl, type CommentView, type Placement, type ReviewApi, type RoomAssetView, type StageHandle, type VersionStatus } from "./types";
import { VideoStage } from "./VideoStage";

const POLL_MS = 10_000;

type Props = {
  audience: "client" | "owner";
  token: string | null;
  assets: RoomAssetView[];
  initial: { assetId: string; variationId: string; versionId: string; commentId?: string | null };
  initialThreads: CommentView[];
  api: ReviewApi;
  commentsOpen: boolean;
  brand: { studioName: string; hasLogo: boolean };
  title: string;
  viewerName?: string;
  clientName?: string | null;
  rounds?: { label: string; over: boolean; note: string | null } | null;
  cover?: { key: string; message: string; notes: string[] } | null;
  downloadPolicy: "none" | "after_approval" | "always";
  /** The owner's page already has its own header and sits in a shorter frame. */
  embedded?: boolean;
  /** The owner's page has its own option tabs and version list; the room doesn't repeat them. */
  hideSwitchers?: boolean;
};

export function Workspace(p: Props) {
  const { audience, token, api } = p;
  const [sel, setSel] = useState(p.initial);
  const [assets, setAssets] = useState(p.assets);
  const [threads, setThreads] = useState(p.initialThreads);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"browse" | "comment">("browse");
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [activeId, setActiveId] = useState<string | null>(p.initial.commentId ?? null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [help, setHelp] = useState(false);
  const [panel, setPanel] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const stage = useRef<StageHandle>(null);
  const composerBox = useRef<HTMLTextAreaElement>(null);

  const asset = assets.find((a) => a.id === sel.assetId) ?? assets[0]!;
  const variation = asset.variations.find((v) => v.id === sel.variationId) ?? asset.variations[0]!;
  const version = variation.versions.find((v) => v.id === sel.versionId) ?? variation.versions[variation.versions.length - 1]!;
  const isVideo = asset.kind === "video";
  const ready = version.file.processing === "ready";
  const fpsNum = version.file.fpsNum;
  const fpsDen = version.file.fpsDen;
  const fps = useMemo(() => (fpsNum && fpsDen ? { num: fpsNum, den: fpsDen } : null), [fpsNum, fpsDen]);
  const c = counts(threads);
  const highlighted = hoverId ?? activeId;

  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast((t) => (t === m ? null : t)), 3500);
  };

  // Keep the address in step, so a copied link opens the same version.
  useEffect(() => {
    if (audience !== "client") return;
    const u = new URL(window.location.href);
    u.searchParams.set("v", version.id);
    u.searchParams.delete("c");
    window.history.replaceState(null, "", u);
  }, [version.id, audience]);

  const load = useCallback(
    async (versionId: string, quiet: boolean) => {
      if (!quiet) setLoading(true);
      const r = await api.threads(versionId);
      if (!quiet) setLoading(false);
      if (r.ok) setThreads((cur) => (JSON.stringify(cur) === JSON.stringify(r.data) ? cur : r.data));
    },
    [api],
  );

  // Replies from the other side arrive without a reload.
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && void load(version.id, true), POLL_MS);
    return () => clearInterval(t);
  }, [version.id, load]);

  /** Point the stage at a comment: seek the video to it, or zoom the image to its spot. */
  const pointAt = useCallback(
    (id: string) => {
      const a = threads.find((x) => x.id === id)?.annotation;
      if (!a) return;
      if (isVideo) {
        const at = seekTarget(a);
        if (at !== null) {
          stage.current?.pause();
          stage.current?.seek(at);
        }
      } else if (a.shape !== "time") stage.current?.focus(a.shape === "rect" ? a.x + (a.w ?? 0) / 2 : a.x, a.shape === "rect" ? a.y + (a.h ?? 0) / 2 : a.y);
    },
    [threads, isVideo],
  );
  const activate = useCallback(
    (id: string) => {
      setActiveId(id);
      pointAt(id);
    },
    [pointAt],
  );

  // A deep link from an email lands on its comment.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !p.initial.commentId || threads.length === 0) return;
    deepLinked.current = true;
    if (threads.some((t) => t.id === p.initial.commentId)) pointAt(p.initial.commentId);
  }, [threads, pointAt, p.initial.commentId]);

  const place = useCallback((pl: Placement) => {
    setDraft({ v: 1, ...pl } as Annotation);
    setMode("browse");
    setSheet(true);
    setTimeout(() => composerBox.current?.focus(), 30);
  }, []);

  const setOut = useCallback(() => {
    setDraft((d) => {
      if (!d || d.t === undefined) return d;
      const now = stage.current?.time() ?? d.t;
      return now > d.t ? { ...d, tEnd: now } : d;
    });
  }, []);

  const startComment = useCallback(() => {
    if (!p.commentsOpen || !ready) return;
    setMode((m) => (m === "comment" ? "browse" : "comment"));
    stage.current?.pause();
  }, [p.commentsOpen, ready]);

  // Keyboard (plan §3). Never while typing in a field or a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.closest("dialog"))) return;
      const k = e.key.toLowerCase();
      const h = stage.current;
      switch (k) {
        case "c":
          startComment();
          break;
        case "escape":
          if (mode === "comment") setMode("browse");
          else setDraft(null);
          break;
        case "?":
          setHelp(true);
          break;
        case " ":
        case "k":
          if (isVideo) {
            e.preventDefault();
            if (k === "k") h?.pause();
            else h?.toggle();
          }
          break;
        case "l":
          if (isVideo) {
            h?.speed(1);
            h?.toggle();
          }
          break;
        case "j":
          if (isVideo) h?.seek(Math.max(0, (h?.time() ?? 0) - 1));
          break;
        case ",":
        case "arrowleft":
          if (isVideo) {
            e.preventDefault();
            h?.step(e.shiftKey ? -10 : -1);
          }
          break;
        case ".":
        case "arrowright":
          if (isVideo) {
            e.preventDefault();
            h?.step(e.shiftKey ? 10 : 1);
          }
          break;
        case "o":
          setOut();
          break;
        case "+":
        case "=":
          if (!isVideo) h?.step(1);
          break;
        case "-":
          if (!isVideo) h?.step(-1);
          break;
        case "0":
          if (!isVideo) h?.reset();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, isVideo, startComment, setOut]);

  const apply = async (fn: () => Promise<{ ok: true; data: CommentView[] } | { ok: false; error: string }>): Promise<string | null> => {
    const r = await fn();
    if (!r.ok) return r.error;
    setThreads(r.data);
    return null;
  };

  const handlers = useMemo(
    () => ({
      onReply: (parentId: string, quoteId: string | null, body: string) => apply(() => api.reply(version.id, { parentId, quoteId, body })),
      onResolve: (id: string, resolved: boolean) => apply(() => api.resolve(version.id, id, resolved)),
      onEdit: (id: string, body: string) => apply(() => api.edit(version.id, id, body)),
      onDelete: (id: string) => apply(() => api.remove(version.id, id)),
      onHide: api.hide ? (id: string) => apply(() => api.hide!(version.id, id)) : undefined,
    }),
    [api, version.id],
  );

  const submit = async (body: string, internal: boolean) => {
    const before = new Set(threads.map((t) => t.id));
    const r = await api.comment(version.id, { body, annotation: draft ?? undefined, internal });
    if (!r.ok) return r.error;
    setThreads(r.data);
    setDraft(null);
    const added = r.data.find((t) => !before.has(t.id));
    if (added) setActiveId(added.id);
    return null;
  };

  const decide = async (decision: "approved" | "changes_requested", input: { signedName?: string; confirm?: boolean; note?: string }) => {
    if (!api.decide) return "Deciding isn't available here.";
    const r = await api.decide({ versionId: version.id, decision, ...input });
    if (!r.ok) return r.error;
    const status: VersionStatus = r.data.status;
    const now = new Date().toISOString();
    setAssets((as) =>
      as.map((a) => ({
        ...a,
        variations: a.variations.map((v) => ({
          ...v,
          versions: v.versions.map((x) => (x.id === version.id ? { ...x, status, marked: x.marked && status !== "approved", canDownload: p.downloadPolicy === "always" || (p.downloadPolicy === "after_approval" && status === "approved"), signoff: { decision, name: input.signedName || p.viewerName || "You", at: now } } : x)),
        })),
      })),
    );
    flash(decision === "approved" ? "Approved. Thank you." : "Sent to the studio.");
    return null;
  };

  /** Move to another version: nothing placed, the new version's threads loaded. */
  const switchTo = (next: { assetId: string; variationId: string; versionId: string }) => {
    setSel(next);
    setDraft(null);
    setMode("browse");
    setActiveId(null);
    setThreads([]);
    void load(next.versionId, false);
  };
  const goVersion = (versionId: string) => switchTo({ ...sel, assetId: asset.id, variationId: variation.id, versionId });
  const goVariation = (vid: string) => {
    const v = asset.variations.find((x) => x.id === vid)!;
    switchTo({ assetId: asset.id, variationId: vid, versionId: v.versions[v.versions.length - 1]!.id });
  };
  const goAsset = (aid: string) => {
    const a = assets.find((x) => x.id === aid)!;
    const v = a.variations[0]!;
    switchTo({ assetId: aid, variationId: v.id, versionId: v.versions[v.versions.length - 1]!.id });
  };
  const latestId = variation.versions[variation.versions.length - 1]!.id;

  const src = fileUrl(audience, token, version.file.id, "preview");
  const download = version.canDownload ? fileUrl(audience, token, version.file.id, "original", true) : null;
  const downloadNote = p.downloadPolicy === "after_approval" ? "Clean download unlocks when you approve." : null;
  const compareHref = token && (variation.versions.length > 1 || (asset.kind === "image" && asset.variations.length > 1)) ? `/review/${token}/compare?asset=${asset.id}&b=${version.id}` : null;
  const disabledReason = !p.commentsOpen ? "Comments are paused on this review." : !ready ? "Comments open once this file has finished processing." : null;

  const showPanel = panel || sheet;
  const pill = "glass flex items-center gap-1 rounded-2xl p-1";
  // No display class here, so a caller can add `inline-flex` or `hidden sm:inline-flex` without a clash.
  const iconBtn = "size-8 items-center justify-center rounded-xl text-room-fg-2 transition-colors hover:bg-room-raised hover:text-room-fg";

  return (
    <div className={`flex overflow-hidden bg-room-surface ${p.embedded ? "relative h-[clamp(560px,78dvh,860px)] rounded-2xl border border-room-line" : "fixed inset-0"}`}>
      {/* The work, edge to edge. Every control floats over it. */}
      <main className="stage relative flex min-w-0 flex-1 flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-2 p-3 sm:flex-nowrap sm:p-4">
          <div className="pointer-events-auto flex min-w-0 basis-full flex-wrap items-center gap-2 sm:basis-auto">
            {!p.hideSwitchers && (
              <div className={`${pill} max-w-full`}>
                {assets.length > 1 ? (
                  <label className="relative flex items-center">
                    <span className="sr-only">Asset</span>
                    <select aria-label="Asset" value={asset.id} onChange={(e) => goAsset(e.target.value)} className="h-8 max-w-[200px] appearance-none truncate rounded-xl bg-transparent pl-3 pr-7 text-[13px] font-semibold text-room-fg outline-none hover:bg-room-raised">
                      {assets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-2 text-room-muted">
                      <IconChevron />
                    </span>
                  </label>
                ) : (
                  <span className="truncate px-3 text-[13px] font-semibold">{asset.title}</span>
                )}
                {asset.variations.length > 1 && (
                  <>
                    <span aria-hidden className="mx-0.5 h-4 w-px bg-room-line" />
                    <div role="tablist" aria-label="Options" className="flex max-w-full gap-0.5 overflow-x-auto">
                      {asset.variations.map((v) => (
                        <button key={v.id} type="button" role="tab" aria-selected={v.id === variation.id} onClick={() => goVariation(v.id)} className={`h-8 shrink-0 rounded-xl px-3 text-[12.5px] transition-colors ${v.id === variation.id ? "bg-room-fg font-semibold text-room-surface" : "text-room-fg-2 hover:bg-room-raised hover:text-room-fg"}`}>
                          {v.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-2">
            {!p.hideSwitchers && (
              <div className={pill}>
                <label className="relative flex items-center">
                  <span className="sr-only">Version</span>
                  <select aria-label="Version" value={version.id} onChange={(e) => goVersion(e.target.value)} className="num h-8 appearance-none rounded-xl bg-transparent pl-3 pr-7 text-[12.5px] font-medium text-room-fg outline-none hover:bg-room-raised">
                    {[...variation.versions].reverse().map((v) => (
                      <option key={v.id} value={v.id}>
                        v{v.number}
                        {v.id === latestId ? " · latest" : ""}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-2 text-room-muted">
                    <IconChevron />
                  </span>
                </label>
                {compareHref && (
                  <Link href={compareHref} aria-label="Compare versions" title="Compare versions" className={`${iconBtn} inline-flex`}>
                    <IconCompare />
                  </Link>
                )}
              </div>
            )}
            <div className={pill}>
              {download && !p.embedded && (
                <a href={download} download aria-label="Download" title="Download" className={`${iconBtn} inline-flex`}>
                  <IconDownload />
                </a>
              )}
              <button type="button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts ( ? )" onClick={() => setHelp(true)} className={`${iconBtn} hidden sm:inline-flex`}>
                <IconKeyboard />
              </button>
              {!p.embedded && (
                <button type="button" aria-label={fullscreen ? "Exit full screen" : "Full screen"} title={fullscreen ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen} className={`${iconBtn} hidden sm:inline-flex`}>
                  {fullscreen ? <IconShrink /> : <IconExpand />}
                </button>
              )}
              <button type="button" aria-label={panel ? "Hide the review panel" : "Show the review panel"} title={panel ? "Hide the review panel" : "Show the review panel"} aria-pressed={panel} onClick={() => setPanel((x) => !x)} className={`${iconBtn} hidden md:inline-flex ${panel ? "" : "text-room-fg"}`}>
                <IconPanel />
                {!panel && c.open > 0 && <span className="num ml-1 text-[11px] font-semibold">{c.open}</span>}
              </button>
              <button type="button" onClick={() => setSheet(true)} className="inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[12.5px] font-medium md:hidden">
                Comments <span className="num">{c.all}</span>
              </button>
            </div>
          </div>
        </div>

        {/* The comment tool: one obvious action, floating where the eye already is. */}
        <div className={`pointer-events-none absolute inset-x-0 z-20 flex justify-center px-3 ${isVideo ? "bottom-[118px]" : "bottom-5"}`}>
          <div className="pointer-events-auto glass flex items-center gap-2 rounded-full p-1 pr-1.5">
            <button
              type="button"
              onClick={startComment}
              disabled={!!disabledReason}
              aria-pressed={mode === "comment"}
              title={disabledReason ?? "Comment on a spot ( C )"}
              className={`inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-colors disabled:opacity-40 ${mode === "comment" ? "bg-brand text-brand-ink" : "bg-room-fg text-room-surface hover:opacity-90"}`}
            >
              <IconComment />
              {mode === "comment" ? "Click the work to place a pin" : "Comment"}
              <kbd className="num rounded-md bg-current/15 px-1.5 text-[10.5px] font-medium opacity-70">C</kbd>
            </button>
            {mode === "comment" && <span className="hidden pr-2 text-[12px] text-room-fg-2 sm:inline">Click for a pin, drag for a box · Esc cancels</span>}
          </div>
        </div>

        {!ready ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div className="glass flex max-w-sm flex-col items-center gap-2 rounded-2xl px-6 py-5">
              <span aria-hidden className={`size-2 rounded-full ${version.file.processing === "failed" ? "bg-[#d92d20]" : "animate-pulse bg-brand"}`} />
              <p className="text-[13.5px] text-room-fg-2">{version.file.processing === "failed" ? "This version couldn't be prepared. Please tell the studio." : "This version is still being prepared. It will appear here in a moment."}</p>
            </div>
          </div>
        ) : isVideo ? (
          <VideoStage
            key={version.id}
            src={src}
            poster={version.marked ? undefined : fileUrl(audience, token, version.file.id, "poster")}
            width={version.file.width ?? 1920}
            height={version.file.height ?? 1080}
            fps={fps}
            threads={threads}
            activeId={highlighted}
            onActivate={activate}
            onHover={setHoverId}
            draft={draft}
            capturing={mode === "comment"}
            onPlace={place}
            handle={stage}
          />
        ) : (
          <ImageStage
            key={version.id}
            src={src}
            alt={`${asset.title}, ${variation.label}, version ${version.number}`}
            width={version.file.width ?? 1600}
            height={version.file.height ?? 1200}
            threads={threads}
            activeId={highlighted}
            onActivate={activate}
            onHover={setHoverId}
            draft={draft}
            capturing={mode === "comment"}
            onPlace={place}
            handle={stage}
          />
        )}

        {toast && (
          <div role="status" className="absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-full bg-room-fg px-4 py-2 text-[13px] font-medium text-room-surface shadow-lg">
            {toast}
          </div>
        )}
      </main>

      {/* The review panel. A bottom sheet on a phone. */}
      {sheet && <button type="button" aria-label="Close comments" onClick={() => setSheet(false)} className="fixed inset-0 z-30 bg-black/30 md:hidden" />}
      <aside
        aria-label="Comments"
        className={`${sheet ? "fixed inset-x-0 bottom-0 z-40 flex h-[78dvh] rounded-t-3xl shadow-[0_-16px_48px_rgb(0_0_0/0.25)]" : "hidden"} min-h-0 flex-col border-room-line bg-room-surface md:static md:z-auto md:h-auto md:rounded-none md:shadow-none ${showPanel ? "md:flex" : "md:hidden"} md:w-[380px] md:shrink-0 md:border-l xl:w-[400px]`}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-room-line md:hidden" aria-hidden />
        {!p.embedded && (
          <header className="flex flex-col gap-3 px-5 pb-4 pt-4 md:pt-5">
            <div className="flex items-center justify-between gap-3">
              <BrandMark token={token ?? ""} name={p.brand.studioName} hasLogo={p.brand.hasLogo} />
              <div className="flex items-center gap-2">
                {p.rounds && (
                  <span className={`num rounded-full px-2.5 py-1 text-[11.5px] font-medium ${p.rounds.over ? "bg-[#fef0c7] text-[#93370d]" : "bg-room-raised text-room-fg-2"}`} title={p.rounds.note ?? undefined}>
                    {p.rounds.label}
                  </span>
                )}
                <button type="button" aria-label="Close" onClick={() => setSheet(false)} className={`${iconBtn} inline-flex md:hidden`}>
                  <IconClose />
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              <h1 className="text-[18px] font-semibold leading-snug tracking-[-0.015em]">{p.title}</h1>
              {p.clientName && <p className="text-[12.5px] text-room-muted">For {p.clientName}</p>}
            </div>
          </header>
        )}

        {(p.cover || version.changeNote.trim()) && (
          <div className="flex flex-col gap-2 px-4 pb-3">
            {p.cover && <CoverNote shareKey={p.cover.key} studioName={p.brand.studioName} message={p.cover.message} notes={p.cover.notes} />}
            {version.changeNote.trim() && (
              <div className="rounded-2xl bg-brand-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-room-fg-2">
                <span className="font-semibold text-room-fg">What changed in v{version.number}:</span> {version.changeNote}
              </div>
            )}
          </div>
        )}

        <CommentRail
          threads={threads}
          activeId={highlighted}
          fps={fps}
          commentsOpen={p.commentsOpen}
          onActivate={activate}
          onHover={setHoverId}
          handlers={handlers}
          loading={loading}
          composer={
            <Composer
              draft={draft}
              fps={fps}
              isVideo={isVideo}
              audience={audience}
              disabled={disabledReason}
              textareaRef={composerBox}
              onTyping={() => {
                if (!isVideo) return;
                stage.current?.pause();
                const t = stage.current?.time() ?? 0;
                setDraft({ v: 1, shape: "time", x: 0, y: 0, t, frame: fps ? Math.floor((t * fps.num) / fps.den + 1e-6) : undefined } as Annotation);
              }}
              onClearDraft={() => setDraft(null)}
              onSetOut={setOut}
              onSubmit={submit}
            />
          }
        />

        {audience === "client" && <DecisionBar version={version} openCount={c.open} assetTitle={asset.title} onDecide={decide} onGoLatest={() => goVersion(latestId)} downloadHref={download} downloadNote={downloadNote} />}
      </aside>

      <ShortcutHelp open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
