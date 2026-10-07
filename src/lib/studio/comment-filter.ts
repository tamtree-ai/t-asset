/** Rail filters (plan §3: All / Open / Resolved), and the line the composer shows for where a comment will land. */
import type { CommentView } from "@/services/studio/comments";

import { formatTimecode, type Fps } from "./timecode";
import type { Annotation } from "./annotation";

export type Filter = "all" | "open" | "resolved";

export function filterThreads<T extends Pick<CommentView, "resolved">>(threads: T[], filter: Filter): T[] {
  if (filter === "open") return threads.filter((t) => !t.resolved);
  if (filter === "resolved") return threads.filter((t) => t.resolved);
  return threads;
}

export function counts(threads: Pick<CommentView, "resolved">[]): { all: number; open: number; resolved: number } {
  const resolved = threads.filter((t) => t.resolved).length;
  return { all: threads.length, open: threads.length - resolved, resolved };
}

/** "At 0:12.04" / "0:12.04 – 0:15.00" / "Pinned" / "Box" / "General comment". */
export function describePlace(a: Annotation | null, fps?: Fps | null): string {
  if (!a) return "General comment";
  const time = a.t === undefined ? null : a.tEnd !== undefined ? `${formatTimecode(a.t, fps)} – ${formatTimecode(a.tEnd, fps)}` : formatTimecode(a.t, fps);
  if (a.shape === "time") return time ? `At ${time}` : "General comment";
  const what = a.shape === "rect" ? "Box" : "Pin";
  return time ? `${what} at ${time}` : what;
}

/** Plain URLs in a comment become links; nothing else is interpreted, and no HTML is ever stored or rendered. */
export function linkify(text: string): ({ text: string } | { href: string; text: string })[] {
  const out: ({ text: string } | { href: string; text: string })[] = [];
  const re = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ href: m[0], text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
