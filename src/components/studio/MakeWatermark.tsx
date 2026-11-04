"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { makeWatermarkAction } from "@/app/studio/actions";
import type { RenditionTargets } from "@/services/studio/files";

import { FormError } from "./Actions";
import { cardCls, quietBtn } from "./kit";

/**
 * For an image uploaded before the browser made watermarks: until it has one, the room shows the
 * clean original even on a watermarked link. The owner picks the same file again (its fingerprint
 * must match), and this browser makes the watermark and thumbnail.
 */
export function MakeWatermark({ fileId, variationId }: { fileId: string; variationId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const r = await import("@/lib/studio/make-renditions");
      const format = r.proofFormat();
      const res = await fetch("/api/uploads/renditions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileId, variationId, format }) });
      const t = (await res.json().catch(() => ({ ok: false, error: `The request failed (${res.status}).` }))) as { ok: true; data: RenditionTargets } | { ok: false; error: string };
      if (!t.ok) throw new Error(t.error);
      const made = await r.makeImageRenditions(file, t.data.watermarkText, format);
      for (const [name, blob] of Object.entries(made.outputs)) await r.putRendition(t.data.targets[name]!, blob);
      const done = await makeWatermarkAction(fileId, made.facts.sha256, format);
      if (!done.ok) throw new Error(done.error);
      router.refresh();
    } catch (e) {
      setError((e as Error).message || "The watermark couldn't be made. Try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div role="status" className={`${cardCls} flex flex-wrap items-center justify-between gap-3 border-attention-line bg-attention-soft px-4 py-3`}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13.5px] font-medium">
          <span aria-hidden className="text-attention">▲ </span>This image has no watermark yet
        </span>
        <span className="text-[12.5px] text-fg-muted">It was uploaded before watermarks were made, so clients see the clean original even on a watermarked link. Pick the same file again to make one.</span>
        <FormError message={error} />
      </div>
      <button type="button" className={quietBtn} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Making the watermark…" : "Make watermark"}
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" aria-label="Pick the original image" onChange={(e) => void run(e.target.files?.[0])} />
    </div>
  );
}
