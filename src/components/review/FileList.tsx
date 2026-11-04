"use client";

import { IconDownload } from "./icons";
import type { DeliverableView } from "./types";

const size = (n: number) => (n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(n >= 10 * 1024 ** 2 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The version's deliverables: each a download once unlocked, else a lock and what unlocks it. */
export function FileList({ files, hrefOf, locked }: { files: DeliverableView[]; hrefOf: (fileId: string) => string; locked: string | null }) {
  if (files.length === 0) return null;
  return (
    <section aria-label="Files" className="flex flex-col gap-2 rounded-2xl border border-room-line px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold">Files</h2>
        {locked && (
          <span className="inline-flex items-center gap-1 text-[11.5px] text-room-muted">
            <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="3" y="7" width="10" height="7" rx="1.5" />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
            </svg>
            Locked
          </span>
        )}
      </div>
      {locked && <p className="text-[12px] leading-relaxed text-room-fg-2">{locked}</p>}
      <ul className="flex flex-col">
        {files.map((f) => (
          <li key={f.fileId} className="flex items-center justify-between gap-3 border-t border-room-line py-2 first:border-0">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium" title={f.name}>
                {f.label}
              </span>
              <span className="num text-[11.5px] uppercase text-room-muted">
                {f.ext} · {size(f.bytes)}
              </span>
            </span>
            {!locked && (
              <a href={hrefOf(f.fileId)} download aria-label={`Download ${f.label}`} title="Download" className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl text-room-fg-2 transition-colors hover:bg-room-raised hover:text-room-fg">
                <IconDownload />
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
