"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { FormError } from "./Actions";
import { cardCls, inputCls, primaryBtn, quietBtn } from "./kit";

const MB = 1024 * 1024;
const LIMITS = { image: { bytes: 30 * MB, label: "30 MB" }, video: { bytes: 500 * MB, label: "500 MB" } };
const ACCEPT = {
  image: "image/png,image/jpeg",
  video: "video/mp4,video/quicktime,video/webm,video/x-matroska",
};

type Started = { fileId: string; key: string; driver: "vercel" | "local"; multipart: boolean; target: { method: "PUT"; url: string; headers: Record<string, string> } | null };
type Res<T> = { ok: true; data: T } | { ok: false; error: string };

async function postJson<T>(url: string, body: unknown): Promise<Res<T>> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    return (await res.json()) as Res<T>;
  } catch {
    return { ok: false, error: `The request failed (${res.status}).` };
  }
}

/** One signed PUT with progress (local driver). */
function putWithProgress(file: File, target: NonNullable<Started["target"]>, onProgress: (f: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.url);
    for (const [k, v] of Object.entries(target.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(xhr.responseText || `The upload failed (${xhr.status}).`)));
    xhr.send(file);
  });
}

type ImageFacts = { sha256: string; width: number; height: number };

/** An image is reviewed from its original, so the browser takes the hash and size the server would otherwise get from Tamtree. */
async function measureImage(file: File): Promise<ImageFacts> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file); // applies EXIF orientation, so width and height are as shown
  } catch {
    throw new Error(`“${file.name}” couldn't be read as an image. Export it as a PNG or JPG and try again.`);
  }
  const { width, height } = bitmap;
  bitmap.close();
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return { sha256, width, height };
}

/**
 * Drag a file in, say what changed, watch it upload (plan §5.2). The bytes go straight from the
 * browser to the store; the app only checks the file first and records it after. An image is
 * ready at once; Tamtree makes a video's previews.
 */
export function UploadPanel({ assetId, variationId, kind, nextNumber }: { assetId: string; variationId: string; kind: "image" | "video"; nextNumber: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  function pick(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (!ACCEPT[kind].split(",").includes(f.type)) return setError(`This asset takes ${kind === "image" ? "a PNG or JPG image" : "an MP4, MOV, WebM or MKV video"}. “${f.name}” is ${f.type || "an unknown type"}.`);
    if (f.size > LIMITS[kind].bytes) return setError(`That file is over the ${LIMITS[kind].label} limit. Export a smaller one.`);
    setFile(f);
  }

  async function send() {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const image = kind === "image" ? await measureImage(file) : undefined;
      const started = await postJson<Started>("/api/uploads/init", { variationId, name: file.name, mime: file.type, bytes: file.size });
      if (!started.ok) throw new Error(started.error);
      const s = started.data;
      if (s.target) {
        await putWithProgress(file, s.target, setProgress);
      } else {
        const { uploadPresigned } = await import("@vercel/blob/client");
        await uploadPresigned(s.key, file, {
          access: "private",
          handleUploadUrl: "/api/uploads/sign",
          clientPayload: s.fileId,
          multipart: s.multipart,
          contentType: file.type,
          onUploadProgress: (e) => setProgress(e.percentage / 100),
        });
      }
      const done = await postJson<{ versionId: string }>("/api/uploads/complete", { fileId: s.fileId, variationId, note, image });
      if (!done.ok) throw new Error(done.error);
      setFile(null);
      setNote("");
      router.push(`/studio/assets/${assetId}?option=${variationId}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message || "The upload failed. Try again.");
    } finally {
      setProgress(null);
    }
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
        <p className="text-[12px] text-fg-muted">Up to {LIMITS[kind].label}.{kind === "image" ? " PNG or JPG, shown exactly as uploaded." : " Tamtree makes the previews after the upload."}</p>
        <button type="button" className={quietBtn} disabled={busy} onClick={() => input.current?.click()}>
          {file ? "Choose a different file" : "Choose a file"}
        </button>
        <input ref={input} type="file" accept={ACCEPT[kind]} className="sr-only" aria-label="Choose a file" onChange={(e) => pick(e.target.files?.[0])} />
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
