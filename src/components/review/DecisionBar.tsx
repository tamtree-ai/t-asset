"use client";

import { useState } from "react";

import { STATUS_WORD } from "@/lib/studio/rounds";

import { Modal } from "./Modal";
import type { RoomVersionView } from "./types";

type Decide = (decision: "approved" | "changes_requested", input: { signedName?: string; confirm?: boolean; note?: string }) => Promise<string | null>;

/** The sticky decision bar and its two dialogs (plan §4.3). */
export function DecisionBar({
  version,
  openCount,
  onDecide,
  onGoLatest,
  downloadHref,
  downloadNote,
  assetTitle,
}: {
  version: RoomVersionView;
  openCount: number;
  onDecide: Decide;
  onGoLatest: () => void;
  downloadHref: string | null;
  downloadNote: string | null;
  assetTitle: string;
}) {
  const [dialog, setDialog] = useState<"approve" | "changes" | null>(null);
  const [name, setName] = useState("");
  const [sure, setSure] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setDialog(null);
    setError(null);
  };
  async function go(decision: "approved" | "changes_requested") {
    setBusy(true);
    setError(null);
    const err = await onDecide(decision, decision === "approved" ? { signedName: name, confirm: sure } : { note });
    setBusy(false);
    if (err) return setError(err);
    setName("");
    setSure(false);
    setNote("");
    close();
  }

  const s = version.status;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-room-line bg-room-surface px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className={`size-2 rounded-full ${s === "approved" ? "bg-[#1a7f4b]" : s === "changes_requested" ? "bg-[#b25e09]" : "bg-room-muted"}`} />
            <span className="font-medium">{STATUS_WORD[s]}</span>
          </span>
          {version.signoff && (
            <span className="text-room-muted">
              {version.signoff.decision === "approved" ? "Approved" : "Changes requested"} by {version.signoff.name} on {new Date(version.signoff.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
            </span>
          )}
          <span className="num text-room-muted">
            {openCount} open {openCount === 1 ? "comment" : "comments"}
          </span>
          {downloadNote && !downloadHref && <span className="text-room-muted">{downloadNote}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {downloadHref && (
            <a href={downloadHref} download className="inline-flex h-10 items-center rounded-lg border border-room-line px-4 text-[13.5px] font-medium hover:bg-room-raised">
              Download final file
            </a>
          )}
          {version.latest ? (
            <>
              <button type="button" onClick={() => setDialog("changes")} className="h-10 rounded-lg border border-room-line px-4 text-[13.5px] font-medium hover:bg-room-raised">
                Request changes
              </button>
              <button type="button" onClick={() => setDialog("approve")} disabled={s === "approved"} className="h-10 rounded-lg bg-brand px-5 text-[13.5px] font-semibold text-brand-ink hover:bg-brand-hover disabled:opacity-50">
                {s === "approved" ? "Approved" : `Approve v${version.number}`}
              </button>
            </>
          ) : (
            <button type="button" onClick={onGoLatest} className="h-10 rounded-lg border border-room-line px-4 text-[13.5px] font-medium hover:bg-room-raised">
              This isn’t the latest version. Go to the latest
            </button>
          )}
        </div>
      </div>

      <Modal open={dialog === "approve"} onClose={close} title={`Approve v${version.number}`}>
        <p className="text-[14px] leading-relaxed text-room-fg-2">
          This signs off <b>{assetTitle}</b> v{version.number} for final production. It’s recorded with your name, email, the time and a fingerprint of this exact file.
        </p>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-room-fg-2">
          Type your full name
          <input autoFocus autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className="h-11 rounded-xl border border-room-line bg-room-bg px-3.5 text-[15px] font-normal" />
        </label>
        <label className="flex items-start gap-2.5 text-[13.5px] leading-snug text-room-fg-2">
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-0.5" />I approve this version for final production.
        </label>
        {openCount > 0 && <p className="rounded-lg bg-room-raised px-3 py-2 text-[12.5px] text-room-muted">There {openCount === 1 ? "is" : "are"} still {openCount} open {openCount === 1 ? "comment" : "comments"} on this version.</p>}
        {error && (
          <p role="alert" className="text-[13px] text-[#b42318]">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="h-10 rounded-lg border border-room-line px-4 text-[13.5px]">
            Cancel
          </button>
          <button type="button" disabled={busy || name.trim().length < 2 || !sure} onClick={() => go("approved")} className="h-10 rounded-lg bg-brand px-5 text-[13.5px] font-semibold text-brand-ink hover:bg-brand-hover disabled:opacity-50">
            {busy ? "Signing off…" : "Confirm approval"}
          </button>
        </div>
      </Modal>

      <Modal open={dialog === "changes"} onClose={close} title="Request changes">
        <p className="text-[14px] leading-relaxed text-room-fg-2">
          {openCount > 0 ? `The ${openCount} open ${openCount === 1 ? "comment" : "comments"} go to the studio with this.` : "Add comments on the work first, so the studio knows what to change."} This uses up one revision round.
        </p>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-room-fg-2">
          Anything else? (optional)
          <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className="resize-none rounded-xl border border-room-line bg-room-bg px-3.5 py-2.5 text-[14px] font-normal" />
        </label>
        {error && (
          <p role="alert" className="text-[13px] text-[#b42318]">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="h-10 rounded-lg border border-room-line px-4 text-[13.5px]">
            Cancel
          </button>
          <button type="button" disabled={busy} onClick={() => go("changes_requested")} className="h-10 rounded-lg bg-brand px-5 text-[13.5px] font-semibold text-brand-ink hover:bg-brand-hover disabled:opacity-50">
            {busy ? "Sending…" : "Send to the studio"}
          </button>
        </div>
      </Modal>
    </>
  );
}
