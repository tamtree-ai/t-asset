"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { FormError } from "./Actions";
import { cardCls, inputCls, primaryBtn, quietBtn } from "./kit";

const MAX = 2 * 1024 ** 3;

/** Drag a file in, say what changed, watch it upload. The route streams the body, so a big video doesn't cost the server memory. */
export function UploadPanel({ assetId, variationId, kind, nextNumber }: { assetId: string; variationId: string; kind: "image" | "video"; nextNumber: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const accept = kind === "image" ? "image/png,image/jpeg,image/webp,image/tiff,image/gif" : "video/mp4,video/quicktime,video/webm,video/x-matroska";

  function pick(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (!f.type.startsWith(`${kind}/`)) return setError(`This asset takes ${kind === "image" ? "an image" : "a video"}. “${f.name}” is ${f.type || "an unknown type"}.`);
    if (f.size > MAX) return setError("That file is over the 2 GB limit.");
    setFile(f);
  }

  function send() {
    if (!file) return;
    setError(null);
    setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/studio/uploads?variation=${encodeURIComponent(variationId)}&name=${encodeURIComponent(file.name)}&note=${encodeURIComponent(note)}`);
    xhr.setRequestHeader("content-type", file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(e.loaded / e.total);
    xhr.onerror = () => {
      setProgress(null);
      setError("The upload was interrupted. Check your connection and try again.");
    };
    xhr.onload = () => {
      setProgress(null);
      let body: { ok?: boolean; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && body.ok) {
        setFile(null);
        setNote("");
        router.push(`/studio/assets/${assetId}?option=${variationId}`);
        router.refresh();
      } else setError(body.error ?? `The upload failed (${xhr.status}).`);
    };
    xhr.send(file);
  }

  const busy = progress !== null;
  return (
    <section aria-label="Upload a new version" className={`${cardCls} flex flex-col gap-3 p-4`}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files[0]);
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center ${over ? "border-accent bg-accent-soft" : "border-line"}`}
      >
        <p className="text-[13.5px] text-fg-2">{file ? file.name : `Drop ${kind === "image" ? "an image" : "a video"} here to add v${nextNumber}`}</p>
        <button type="button" className={quietBtn} disabled={busy} onClick={() => input.current?.click()}>
          {file ? "Choose a different file" : "Choose a file"}
        </button>
        <input ref={input} type="file" accept={accept} className="sr-only" aria-label="Choose a file" onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      <label className="flex flex-col gap-1.5 text-[12.5px] text-fg-3">
        What changed in v{nextNumber}? (the client sees this above the work)
        <input className={inputCls} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Logo larger, warmer background" />
      </label>
      {busy && (
        <div role="progressbar" aria-valuenow={Math.round((progress ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
        </div>
      )}
      <FormError message={error} />
      <div>
        <button type="button" className={primaryBtn} disabled={!file || busy} onClick={send}>
          {busy ? `Uploading ${Math.round((progress ?? 0) * 100)}%` : `Upload v${nextNumber}`}
        </button>
      </div>
    </section>
  );
}
