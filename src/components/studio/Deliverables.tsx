"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { moveDeliverableAction, removeDeliverableAction, renameDeliverableAction } from "@/app/studio/actions";
import { DELIVERABLE_ACCEPT, MAX_DELIVERABLE_BYTES, SNIFF_BYTES, sniffDeliverable } from "@/lib/studio/deliverables";

import { FormError, useRunner } from "./Actions";
import { bytesLabel, cardCls, dangerBtn, inputCls, quietBtn } from "./kit";

type Item = { id: string; fileId: string; label: string; name: string; ext: string; bytes: number };
type Started = { fileId: string; key: string; mime: string; multipart: boolean; target: { method: "PUT"; url: string; headers: Record<string, string> } | null };
type Res<T> = { ok: true; data: T } | { ok: false; error: string };

async function postJson<T>(url: string, body: unknown): Promise<Res<T>> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    return (await res.json()) as Res<T>;
  } catch {
    return { ok: false, error: `The request failed (${res.status}).` };
  }
}

/** Uploads one deliverable: checked here by its first bytes, sent straight to the store, checked again by the server. */
async function attach(versionId: string, file: File, onProgress: (f: number) => void): Promise<void> {
  if (file.size > MAX_DELIVERABLE_BYTES) throw new Error(`“${file.name}” is over the 200 MB limit. Zip it smaller or split it.`);
  const sniffed = sniffDeliverable(file.name, new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()));
  if (!sniffed.ok) throw new Error(sniffed.error);
  const started = await postJson<Started>("/api/uploads/deliverables/init", { versionId, name: file.name, bytes: file.size });
  if (!started.ok) throw new Error(started.error);
  const s = started.data;
  if (s.target) {
    const res = await fetch(s.target.url, { method: s.target.method, headers: s.target.headers, body: file });
    if (!res.ok) throw new Error((await res.text().catch(() => "")) || `The upload failed (${res.status}).`);
    onProgress(1);
  } else {
    const { uploadPresigned } = await import("@vercel/blob/client");
    await uploadPresigned(s.key, file, { access: "private", handleUploadUrl: "/api/uploads/sign", clientPayload: s.fileId, multipart: s.multipart, contentType: s.mime, onUploadProgress: (e) => onProgress(e.percentage / 100) });
  }
  const done = await postJson("/api/uploads/deliverables/complete", { versionId, fileId: s.fileId });
  if (!done.ok) throw new Error(done.error);
}

/**
 * The real files of a version (planning/2026-10-31-tasset-deliverables): the SVG, AI and EPS pack,
 * the print PDF. Clients see them listed under the version and download them under the share's
 * download rules (for example, once the invoice is paid).
 */
export function Deliverables({ versionId, items }: { versionId: string; items: Item[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const { run, error: actionError, pending } = useRunner();

  async function add(files: File[]) {
    if (files.length === 0) return;
    setError(null);
    const failed: string[] = [];
    for (const [i, f] of files.entries()) {
      setStatus(`Uploading ${f.name} (${i + 1} of ${files.length})`);
      try {
        await attach(versionId, f, (p) => setStatus(`Uploading ${f.name} (${i + 1} of ${files.length}) · ${Math.round(p * 100)}%`));
      } catch (e) {
        failed.push((e as Error).message);
      }
    }
    setStatus(null);
    if (failed.length) setError(failed.join(" "));
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <section aria-labelledby="deliverables" className={`${cardCls} flex flex-col gap-3 p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="deliverables" className="text-[15px] font-semibold">
          Deliverable files
        </h2>
        <span className="text-[12px] text-fg-muted">Listed under this version in the review. Downloads follow each link&rsquo;s download setting.</span>
      </div>

      {items.length > 0 && (
        <ul className="flex flex-col divide-y divide-rule rounded-lg border border-rule">
          {items.map((d, i) => (
            <Row key={d.id} item={d} first={i === 0} last={i === items.length - 1} busy={pending} onRun={run} />
          ))}
        </ul>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void add([...e.dataTransfer.files]);
        }}
        className={`flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-5 text-center ${over ? "border-accent bg-accent-soft" : "border-line"}`}
      >
        <p className="text-[13px] text-fg-2">Drop the files the client takes away: SVG, AI, EPS, PDF, ZIP, PNG, JPG, TIFF or fonts.</p>
        <p className="text-[12px] text-fg-muted">Up to 200 MB each. Stored as they are, never shown in the room.</p>
        <button type="button" className={quietBtn} disabled={!!status} onClick={() => input.current?.click()}>
          {status ? "Uploading…" : "Add deliverable files"}
        </button>
        <input ref={input} type="file" multiple accept={DELIVERABLE_ACCEPT} className="sr-only" aria-label="Add deliverable files" onChange={(e) => void add([...(e.target.files ?? [])])} />
      </div>
      {status && (
        <p role="status" className="text-[12.5px] text-fg-3">
          {status}
        </p>
      )}
      <FormError message={error ?? actionError} />
    </section>
  );
}

function Row({ item, first, last, busy, onRun }: { item: Item; first: boolean; last: boolean; busy: boolean; onRun: ReturnType<typeof useRunner>["run"] }) {
  const [label, setLabel] = useState(item.label);
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2">
      <form
        className="flex min-w-[220px] flex-1 items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onRun(() => renameDeliverableAction(item.id, label));
        }}
      >
        <input className={inputCls} aria-label={`Label for ${item.name}`} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />
        {label !== item.label && (
          <button type="submit" className={quietBtn} disabled={busy}>
            Save
          </button>
        )}
      </form>
      <span className="num text-[12px] uppercase text-fg-muted" title={item.name}>
        {item.ext} · {bytesLabel(item.bytes)}
      </span>
      <a href={`/api/studio/files/${item.fileId}?r=original&download=1`} className={quietBtn}>
        Download
      </a>
      <button type="button" aria-label={`Move ${item.label} up`} className={quietBtn} disabled={busy || first} onClick={() => onRun(() => moveDeliverableAction(item.id, -1))}>
        ↑
      </button>
      <button type="button" aria-label={`Move ${item.label} down`} className={quietBtn} disabled={busy || last} onClick={() => onRun(() => moveDeliverableAction(item.id, 1))}>
        ↓
      </button>
      <button
        type="button"
        className={dangerBtn}
        disabled={busy}
        onClick={() => {
          if (window.confirm(`Delete “${item.label}”? Clients will no longer see it.`)) onRun(() => removeDeliverableAction(item.id));
        }}
      >
        Delete
      </button>
    </li>
  );
}
