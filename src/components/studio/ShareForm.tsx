"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createShareAction, updateShareAction } from "@/app/studio/actions";

import { Field, FormError, useRunner } from "./Actions";
import { cardCls, inputCls, primaryBtn, textareaCls } from "./kit";

export type ShareFormValues = {
  title: string;
  message: string;
  notes: string[];
  expiresAt: string;
  downloadPolicy: "none" | "after_approval" | "always";
  watermark: boolean;
  commentsOpen: boolean;
  versionMode: "latest" | "pinned";
  assetIds: string[];
};

export function ShareForm({
  projectId,
  shareId,
  assets,
  initial,
}: {
  projectId: string;
  shareId?: string;
  assets: { id: string; title: string; kind: string; hasVersion: boolean }[];
  initial: ShareFormValues;
}) {
  const router = useRouter();
  const { run, error, pending } = useRunner();
  const [v, setV] = useState({ ...initial, notes: initial.notes.join("\n") });
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((p) => ({ ...p, [k]: val }));
  const toggle = (id: string) => set("assetIds", v.assetIds.includes(id) ? v.assetIds.filter((x) => x !== id) : [...v.assetIds, id]);

  const payload = () => ({ ...v, notes: v.notes.split("\n"), expiresAt: v.expiresAt ? new Date(`${v.expiresAt}T23:59:59`).toISOString() : null });

  return (
    <form
      className={`${cardCls} flex flex-col gap-5 p-5`}
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        if (shareId) run(() => updateShareAction(shareId, payload()), () => setSaved(true));
        else run(() => createShareAction(projectId, payload()), (d) => router.push(`/studio/shares/${d.id}`));
      }}
    >
      <Field label="Title (the client sees this)">
        <input className={inputCls} value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="Spring campaign: first round" />
      </Field>
      <Field label="Message from you" hint="Shown at the top of the review. Plain text; blank lines make paragraphs.">
        <textarea className={textareaCls} rows={4} value={v.message} onChange={(e) => set("message", e.target.value)} placeholder="Hi Sam, here are two directions for the banner. Option B is the bolder one…" />
      </Field>
      <Field label="Notes (one per line)" hint="A short read-only list beside the message, like “Fonts are placeholders”.">
        <textarea className={textareaCls} rows={3} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[12.5px] text-fg-3">Assets in this review</legend>
        {assets.map((a) => (
          <label key={a.id} className={`flex items-center gap-2.5 text-[13px] ${a.hasVersion ? "text-fg-2" : "text-fg-muted"}`}>
            <input type="checkbox" checked={v.assetIds.includes(a.id)} onChange={() => toggle(a.id)} disabled={!a.hasVersion && !v.assetIds.includes(a.id)} />
            {a.title}
            <span className="text-[12px] text-fg-muted">{a.kind === "video" ? "Video" : "Image"}{a.hasVersion ? "" : " · nothing uploaded yet"}</span>
          </label>
        ))}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Which version the client sees">
          <select className={inputCls} value={v.versionMode} onChange={(e) => set("versionMode", e.target.value as typeof v.versionMode)}>
            <option value="latest">Always the latest</option>
            <option value="pinned">The versions as they are now</option>
          </select>
        </Field>
        <Field label="Link expires" hint="Leave empty for no expiry.">
          <input type="date" className={inputCls} value={v.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} />
        </Field>
        <Field label="Downloads">
          <select className={inputCls} value={v.downloadPolicy} onChange={(e) => set("downloadPolicy", e.target.value as typeof v.downloadPolicy)}>
            <option value="after_approval">Clean file after the client approves</option>
            <option value="none">No downloads</option>
            <option value="always">Always allow the original</option>
          </select>
        </Field>
        <div className="flex flex-col justify-end gap-2.5 text-[13px] text-fg-2">
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={v.watermark} onChange={(e) => set("watermark", e.target.checked)} />
            Watermark the previews
          </label>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={v.commentsOpen} onChange={(e) => set("commentsOpen", e.target.checked)} />
            Comments are open
          </label>
        </div>
      </div>

      <FormError message={error} />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={primaryBtn}>
          {shareId ? "Save changes" : "Create review link"}
        </button>
        {saved && <span className="text-[12.5px] text-fg-3">Saved.</span>}
      </div>
    </form>
  );
}
