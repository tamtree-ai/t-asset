"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import { counts, type Filter, filterThreads } from "@/lib/studio/comment-filter";
import type { Fps } from "@/lib/studio/timecode";

import { Thread } from "./Thread";
import type { CommentView } from "./types";

type ThreadHandlers = React.ComponentProps<typeof Thread>["handlers"];

/** The right-hand rail: filters, the numbered threads, and the composer. Clicking a thread points at its spot on the work. */
export function CommentRail({
  threads,
  activeId,
  fps,
  commentsOpen,
  onActivate,
  onHover,
  handlers,
  composer,
  loading,
}: {
  threads: CommentView[];
  activeId: string | null;
  fps: Fps | null;
  commentsOpen: boolean;
  onActivate: (id: string) => void;
  onHover: (id: string | null) => void;
  handlers: ThreadHandlers;
  composer: ReactNode;
  loading: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const c = counts(threads);
  const shown = filterThreads(threads, filter);
  const list = useRef<HTMLDivElement>(null);

  // Bring the active thread into view when its pin is clicked on the work.
  useEffect(() => {
    if (!activeId) return;
    list.current?.querySelector<HTMLElement>(`[data-comment-id="${activeId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);

  const tabs: [Filter, string, number][] = [
    ["all", "All", c.all],
    ["open", "Open", c.open],
    ["resolved", "Resolved", c.resolved],
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-t border-room-line px-4 pb-2 pt-3">
      <h2 className="text-[13px] font-semibold">Comments</h2>
      <div role="tablist" aria-label="Filter comments" className="flex gap-0.5 rounded-xl bg-room-raised p-0.5">
        {tabs.map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={`rounded-[10px] px-2.5 py-1 text-[12px] transition-colors ${filter === key ? "bg-room-surface font-semibold text-room-fg shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-room-muted hover:text-room-fg"}`}
          >
            {label} <span className="num text-[11px] opacity-70">{n}</span>
          </button>
        ))}
      </div>
      </div>

      <div ref={list} className="scroll-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3 pt-1" aria-live="polite">
        {loading && threads.length === 0 ? (
          <p className="px-1 py-6 text-center text-[13px] text-room-muted">Loading comments…</p>
        ) : shown.length === 0 ? (
          <p className="px-6 py-10 text-center text-[13px] leading-relaxed text-room-muted">
            {threads.length === 0 ? "No comments yet. Press C to pin one to a spot, or write a general comment below." : filter === "open" ? "Nothing open. Everything here is resolved." : "Nothing resolved yet."}
          </p>
        ) : (
          shown.map((t) => <Thread key={t.id} thread={t} active={activeId === t.id} fps={fps} commentsOpen={commentsOpen} onActivate={() => onActivate(t.id)} onHover={onHover} handlers={handlers} />)
        )}
      </div>

      <div className="bg-room-surface px-3 pb-3 pt-1">{composer}</div>
    </div>
  );
}
