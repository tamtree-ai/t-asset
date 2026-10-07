"use client";

import { useState } from "react";

import { Field, FormError, useRunner } from "@/components/studio/Actions";
import { cardCls, inputCls, primaryBtn } from "@/components/studio/kit";
import { brandCss, contrast, normaliseHex } from "@/lib/studio/color";

import { saveBrandAction } from "./actions";

type Values = { studioName: string; accentHex: string; roomTheme: "light" | "dark" | "auto"; website: string; supportEmail: string };

export function BrandForm({ brand }: { brand: Values }) {
  const { run, error, pending } = useRunner();
  const [v, setV] = useState(brand);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof Values>(k: K, val: Values[K]) => setV((p) => ({ ...p, [k]: val }));
  const accent = normaliseHex(v.accentHex) ?? "#1f6feb";
  const lowContrast = contrast(accent, "#ffffff") < 3;

  const css = brandCss(accent, v.roomTheme === "auto" ? "light" : v.roomTheme);
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
      <form
        className={`${cardCls} flex flex-col gap-5 p-5`}
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          run(() => saveBrandAction(v), () => setSaved(true));
        }}
      >
        <Field label="Studio name" hint="Shown on the gate, the room header and the watermark.">
          <input className={inputCls} value={v.studioName} maxLength={60} onChange={(e) => set("studioName", e.target.value)} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Accent colour" hint={lowContrast ? "Quite light: buttons will use dark text so they stay readable." : "Buttons, links and pins in the room."}>
            <span className="flex gap-2">
              <input type="color" aria-label="Pick accent colour" className="h-9 w-12 rounded-lg border border-line bg-canvas p-1" value={accent} onChange={(e) => set("accentHex", e.target.value)} />
              <input className={inputCls} value={v.accentHex} onChange={(e) => set("accentHex", e.target.value)} aria-label="Accent colour hex" />
            </span>
          </Field>
          <Field label="Review room theme">
            <select className={inputCls} value={v.roomTheme} onChange={(e) => set("roomTheme", e.target.value as Values["roomTheme"])}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="auto">Follow the visitor’s device</option>
            </select>
          </Field>
          <Field label="Website">
            <input className={inputCls} value={v.website} onChange={(e) => set("website", e.target.value)} placeholder="dilhan.studio" />
          </Field>
          <Field label="Support email" hint="Shown on “this link has ended”.">
            <input className={inputCls} value={v.supportEmail} onChange={(e) => set("supportEmail", e.target.value)} placeholder="hello@dilhan.studio" />
          </Field>
        </div>

        <FormError message={error} />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className={primaryBtn}>
            Save brand
          </button>
          {saved && <span className="text-[12.5px] text-fg-3">Saved.</span>}
        </div>
      </form>

      <aside aria-label="Preview of the review room" className="flex flex-col gap-2">
        <h2 className="text-[13px] text-fg-3">Preview</h2>
        <style>{css}</style>
        <div className="room overflow-hidden rounded-xl border border-line" style={{ background: "var(--room-bg)", color: "var(--room-fg)" }}>
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ background: "var(--room-surface)", borderColor: "var(--room-line)" }}>
            <span className="flex items-center gap-2.5">
              <span className="size-6 rounded" style={{ background: "var(--brand-accent)" }} />
              <span className="text-[13px] font-semibold">{v.studioName || "Studio"}</span>
            </span>
            <span className="text-[12px]" style={{ color: "var(--room-fg-muted)" }}>Round 1 of 2</span>
          </div>
          <div className="flex flex-col gap-3 p-4">
            <h3 className="font-display text-[26px] leading-none">Spring campaign</h3>
            <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--room-fg-2)" }}>Hi Sam, here are two directions for the banner. Pin a comment anywhere on the work.</p>
            <div className="relative flex aspect-[4/3] items-center justify-center rounded-lg" style={{ background: "var(--room-surface)", border: "1px solid var(--room-line)" }}>
              <span className="absolute left-[38%] top-[34%] flex size-6 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: "var(--brand-accent)", color: "var(--brand-accent-ink)" }}>1</span>
              <span className="text-[12px]" style={{ color: "var(--room-fg-muted)" }}>Artwork</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px]" style={{ color: "var(--room-fg-muted)" }}>1 open comment</span>
              <span className="flex gap-2">
                <span className="rounded-lg border px-3 py-1.5 text-[12px]" style={{ borderColor: "var(--room-line)" }}>Request changes</span>
                <span className="rounded-lg px-3 py-1.5 text-[12px] font-semibold" style={{ background: "var(--brand-accent)", color: "var(--brand-accent-ink)" }}>Approve v1</span>
              </span>
            </div>
            <a className="text-[12px] underline" style={{ color: "var(--brand-accent-text)" }}>Link in the brand colour</a>
          </div>
        </div>
      </aside>
    </div>
  );
}
