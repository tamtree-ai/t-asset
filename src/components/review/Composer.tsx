"use client";

import { type Ref, useState } from "react";

import type { Annotation } from "@/lib/studio/annotation";
import { describePlace } from "@/lib/studio/comment-filter";
import type { Fps } from "@/lib/studio/timecode";

/** Write a comment. If a spot is placed, it shows where it will land; on video it can carry a range. */
export function Composer({
  draft,
  fps,
  isVideo,
  audience,
  disabled,
  textareaRef,
  onTyping,
  onClearDraft,
  onSetOut,
  onSubmit,
}: {
  draft: Annotation | null;
  fps: Fps | null;
  isVideo: boolean;
  audience: "client" | "owner";
  disabled: string | null;
  textareaRef: Ref<HTMLTextAreaElement>;
  /** First keystroke with nothing placed: on video, the room pauses and records the moment. */
  onTyping: () => void;
  onClearDraft: () => void;
  onSetOut: () => void;
  onSubmit: (body: string, internal: boolean) => Promise<string | null>;
}) {
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (busy || !body.trim()) return;
    setBusy(true);
    setError(null);
    const err = await onSubmit(body, internal);
    setBusy(false);
    if (err) return setError(err);
    setBody("");
  }

  if (disabled)
    return (
      <p role="status" className="rounded-xl border border-room-line bg-room-raised px-3.5 py-3 text-[13px] text-room-muted">
        {disabled}
      </p>
    );

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="flex min-h-7 flex-wrap items-center gap-2 text-[12px]">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${draft ? "border-brand/50 bg-brand-soft text-room-fg" : "border-room-line text-room-muted"}`}>
          {describePlace(draft, fps)}
          {draft && (
            <button type="button" aria-label="Remove the pin and time" onClick={onClearDraft} className="-mr-1 size-4 rounded-full text-[13px] leading-none hover:bg-room-line">
              ×
            </button>
          )}
        </span>
        {isVideo && draft?.t !== undefined && (
          <button type="button" onClick={onSetOut} className="rounded-full border border-room-line px-2.5 py-1 text-room-fg-2 hover:bg-room-raised" title="Set the end of the range to the current time (O)">
            {draft.tEnd !== undefined ? "Move out point (O)" : "Set out point (O)"}
          </button>
        )}
      </div>
      <textarea
        ref={textareaRef}
        value={body}
        rows={3}
        maxLength={4000}
        aria-label="Add a comment"
        placeholder={isVideo ? "Add a comment. Typing pauses the video at this moment." : "Add a comment, or press C to pin it to a spot."}
        onChange={(e) => {
          if (!body && e.target.value && !draft) onTyping();
          setBody(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
        className="w-full resize-none rounded-xl border border-room-line bg-room-bg px-3 py-2.5 text-[14px] leading-relaxed text-room-fg placeholder:text-room-muted"
      />
      {error && (
        <p role="alert" className="text-[12.5px] text-[#b42318]">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        {audience === "owner" ? (
          <label className="flex items-center gap-2 text-[12.5px] text-room-fg-2">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
            Internal (client can’t see)
          </label>
        ) : (
          <span className="text-[12px] text-room-muted">⌘↵ to send</span>
        )}
        <button type="submit" disabled={busy || !body.trim()} className="h-9 rounded-lg bg-brand px-4 text-[13px] font-semibold text-brand-ink hover:bg-brand-hover disabled:opacity-50">
          {busy ? "Sending…" : "Comment"}
        </button>
      </div>
    </form>
  );
}
