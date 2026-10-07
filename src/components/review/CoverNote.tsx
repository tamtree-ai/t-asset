"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { linkify } from "@/lib/studio/comment-filter";

const KEY = "studio-review-cover-seen";

const readSeen = (shareKey: string): boolean => {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]).includes(shareKey);
  } catch {
    return false;
  }
};

const markSeen = (shareKey: string) => {
  try {
    const seen = new Set<string>(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
    seen.add(shareKey);
    localStorage.setItem(KEY, JSON.stringify([...seen].slice(-50)));
  } catch {}
};

// Read once per page load, so marking it seen below doesn't collapse the panel the visitor is reading.
const firstRead = new Map<string, boolean>();
const seenAtLoad = (shareKey: string) => {
  if (!firstRead.has(shareKey)) firstRead.set(shareKey, readSeen(shareKey));
  return firstRead.get(shareKey)!;
};
const noSubscribe = () => () => undefined;

/** The studio's message and read-only notes: open the first time this link is opened in this browser, collapsed after. */
export function CoverNote({ shareKey, studioName, message, notes }: { shareKey: string; studioName: string; message: string; notes: string[] }) {
  const seen = useSyncExternalStore(
    noSubscribe,
    () => seenAtLoad(shareKey),
    () => false,
  );
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? !seen;
  useEffect(() => markSeen(shareKey), [shareKey]);

  if (!message.trim() && notes.length === 0) return null;
  return (
    <section aria-label={`A message from ${studioName}`} className="border-b border-room-line bg-room-surface">
      <button type="button" aria-expanded={open} onClick={() => setToggled(!open)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[13px] font-medium hover:bg-room-raised">
        <span>A message from {studioName}</span>
        <span aria-hidden className="text-room-muted">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open && (
        <div className="grid gap-4 px-4 pb-4 md:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
          {message.trim() && (
            <div className="flex flex-col gap-2 text-[14.5px] leading-relaxed text-room-fg-2">
              {message
                .split(/\n{2,}/)
                .filter(Boolean)
                .map((para, i) => (
                  <p key={i} className="whitespace-pre-wrap break-words">
                    {linkify(para).map((p, j) =>
                      "href" in p ? (
                        <a key={j} href={p.href} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-text underline underline-offset-2">
                          {p.text}
                        </a>
                      ) : (
                        <span key={j}>{p.text}</span>
                      ),
                    )}
                  </p>
                ))}
            </div>
          )}
          {notes.length > 0 && (
            <ul className="flex flex-col gap-1.5 rounded-xl bg-room-raised p-3.5 text-[13.5px] text-room-fg-2">
              {notes.map((n, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-room-muted" />
                  {n}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
