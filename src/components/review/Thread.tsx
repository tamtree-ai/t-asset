"use client";

import { type ReactNode, useState } from "react";

import { describePlace, linkify } from "@/lib/studio/comment-filter";
import { ago } from "@/lib/studio/format";
import type { Fps } from "@/lib/studio/timecode";

import type { CommentView } from "./types";

function Body({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-room-fg">
      {linkify(text).map((p, i) =>
        "href" in p ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-text underline underline-offset-2">
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

function Who({ c, children }: { c: CommentView; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px]">
      <span className="font-semibold text-room-fg">{c.authorLabel}</span>
      {c.byStudio && <span className="rounded bg-brand-soft px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide text-brand-text">Studio</span>}
      {c.internal && <span className="rounded bg-room-line px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide text-room-fg-2">Internal</span>}
      <time dateTime={c.createdAt} className="text-room-muted">
        {ago(new Date(c.createdAt))}
        {c.edited ? " · edited" : ""}
      </time>
      {children}
    </div>
  );
}

type Handlers = {
  onReply: (parentId: string, quoteId: string | null, body: string) => Promise<string | null>;
  onResolve: (id: string, resolved: boolean) => Promise<string | null>;
  onEdit: (id: string, body: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  onHide?: (id: string) => Promise<string | null>;
};

/** One comment thread: the root, its replies, and replies that quote a reply. */
export function Thread({
  thread,
  active,
  fps,
  commentsOpen,
  onActivate,
  onHover,
  handlers,
}: {
  thread: CommentView;
  active: boolean;
  fps: Fps | null;
  commentsOpen: boolean;
  onActivate: () => void;
  onHover: (id: string | null) => void;
  handlers: Handlers;
}) {
  const [replyTo, setReplyTo] = useState<{ quoteId: string | null; label: string } | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<string | null>, after?: () => void) => {
    setBusy(true);
    setError(null);
    const err = await fn();
    setBusy(false);
    if (err) setError(err);
    else after?.();
  };

  const row = (c: CommentView, isRoot: boolean) => (
    <div key={c.id} className={isRoot ? "" : "ml-1 border-l-2 border-room-line pl-3"}>
      <Who c={c} />
      {c.quote && (
        <blockquote className="my-1 border-l-2 border-brand/60 pl-2 text-[12.5px] text-room-muted">
          <span className="font-medium text-room-fg-2">↪ {c.quote.authorLabel}:</span> {c.quote.excerpt}
        </blockquote>
      )}
      {editing === c.id ? (
        <div className="mt-1 flex flex-col gap-2">
          <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} aria-label="Edit comment" className="w-full resize-none rounded-lg border border-room-line bg-room-bg px-2.5 py-2 text-[14px]" />
          <div className="flex gap-2">
            <button type="button" disabled={busy || !editText.trim()} onClick={() => run(() => handlers.onEdit(c.id, editText), () => setEditing(null))} className="h-8 rounded-lg bg-brand px-3 text-[12.5px] font-semibold text-brand-ink disabled:opacity-50">
              Save
            </button>
            <button type="button" onClick={() => setEditing(null)} className="h-8 rounded-lg border border-room-line px-3 text-[12.5px]">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <Body text={c.body} />
      )}
      <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px] text-room-muted">
        {!isRoot && commentsOpen && (
          <button type="button" className="hover:text-room-fg" onClick={() => setReplyTo({ quoteId: c.id, label: c.authorLabel })}>
            Reply to this
          </button>
        )}
        {c.canEdit && editing !== c.id && (
          <button
            type="button"
            className="hover:text-room-fg"
            onClick={() => {
              setEditing(c.id);
              setEditText(c.body);
            }}
          >
            Edit
          </button>
        )}
        {c.canEdit && (isRoot ? thread.replies.length === 0 : true) && (
          <button type="button" className="hover:text-room-fg" onClick={() => window.confirm("Delete this comment?") && run(() => handlers.onDelete(c.id))}>
            Delete
          </button>
        )}
        {handlers.onHide && (
          <button type="button" className="hover:text-room-fg" onClick={() => window.confirm("Hide this comment from everyone? It stays in the activity log.") && run(() => handlers.onHide!(c.id))}>
            Hide
          </button>
        )}
      </div>
    </div>
  );

  return (
    <article
      aria-label={`Comment ${thread.number}`}
      data-comment-id={thread.id}
      onMouseEnter={() => onHover(thread.id)}
      onMouseLeave={() => onHover(null)}
      className={`flex flex-col gap-2.5 rounded-2xl p-3 transition-colors ${active ? "bg-brand-soft ring-1 ring-brand/40" : "hover:bg-room-raised"} ${thread.resolved ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-2.5">
        <button type="button" onClick={onActivate} aria-label={`Show comment ${thread.number} on the work`} className="num mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-brand-ink">
          {thread.number}
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <button type="button" onClick={onActivate} className="w-fit text-left text-[11.5px] font-medium text-brand-text hover:underline">
            {describePlace(thread.annotation, fps)}
          </button>
          {row(thread, true)}
        </div>
      </div>

      {thread.replies.length > 0 && <div className="ml-8 flex flex-col gap-3">{thread.replies.map((r) => row(r, false))}</div>}

      <div className="ml-8 flex flex-col gap-2">
        {replyTo ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => handlers.onReply(thread.id, replyTo.quoteId, text), () => {
                setText("");
                setReplyTo(null);
              });
            }}
          >
            {replyTo.quoteId && <p className="text-[12px] text-room-muted">Replying to {replyTo.label}</p>}
            <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4000} aria-label="Write a reply" placeholder="Write a reply" className="w-full resize-none rounded-lg border border-room-line bg-room-bg px-2.5 py-2 text-[14px]" />
            <div className="flex gap-2">
              <button type="submit" disabled={busy || !text.trim()} className="h-8 rounded-lg bg-brand px-3 text-[12.5px] font-semibold text-brand-ink disabled:opacity-50">
                Reply
              </button>
              <button type="button" onClick={() => setReplyTo(null)} className="h-8 rounded-lg border border-room-line px-3 text-[12.5px]">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-3 text-[12.5px]">
            {commentsOpen && (
              <button type="button" className="font-medium text-room-fg-2 hover:text-room-fg" onClick={() => setReplyTo({ quoteId: null, label: thread.authorLabel })}>
                Reply
              </button>
            )}
            <button type="button" disabled={busy} className="font-medium text-room-fg-2 hover:text-room-fg" onClick={() => run(() => handlers.onResolve(thread.id, !thread.resolved))}>
              {thread.resolved ? "Reopen" : "Resolve"}
            </button>
            {thread.resolved && <span className="text-room-muted">Resolved{thread.resolvedByLabel ? ` by ${thread.resolvedByLabel}` : ""}</span>}
          </div>
        )}
        {error && (
          <p role="alert" className="text-[12.5px] text-[#b42318]">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
