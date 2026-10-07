import type { ReactNode } from "react";

import { ago, bytesLabel } from "@/lib/studio/format";
import { STATUS_WORD } from "@/lib/studio/rounds";

export { ago, bytesLabel };

export const inputCls = "h-9 w-full rounded-lg border border-line bg-canvas px-2.5 text-[13px] text-fg placeholder:text-fg-muted";
export const textareaCls = "w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-[13px] leading-relaxed text-fg placeholder:text-fg-muted";
export const primaryBtn = "inline-flex h-9 items-center justify-center rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-accent-ink hover:brightness-110 disabled:opacity-50";
export const quietBtn = "inline-flex h-9 items-center justify-center rounded-lg border border-line px-3 text-[13px] text-fg-2 hover:bg-hover disabled:opacity-50";
export const dangerBtn = "inline-flex h-9 items-center justify-center rounded-lg border border-line px-3 text-[13px] text-[#ff9a8a] hover:bg-hover disabled:opacity-50";
export const cardCls = "rounded-[14px] border border-rule bg-panel";

export type StatusKey = keyof typeof STATUS_WORD;

/** A status is a dot and a word, never a chip. Green is Approved and nothing else; amber (with its mark) is "needs you". */
export function StatusLine({ status, label }: { status: StatusKey; label?: string }) {
  const dot = status === "approved" ? "bg-ready" : status === "changes_requested" ? "bg-attention" : status === "in_review" ? "bg-fg-3" : "bg-line-strong";
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-2">
      <span aria-hidden className={`size-2 rounded-full ${dot}`} />
      {status === "changes_requested" && <span aria-hidden className="text-attention">▲</span>}
      {label ?? STATUS_WORD[status]}
    </span>
  );
}

export function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className="flex flex-1 justify-center px-4">
      <div className={`flex w-full flex-col gap-8 py-10 ${wide ? "max-w-[1120px]" : "max-w-[860px]"}`}>{children}</div>
    </main>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="font-display text-[38px] leading-[1.05] tracking-[-0.01em]">{children}</h1>
      {sub && <p className="text-[13.5px] text-fg-muted">{sub}</p>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={`${cardCls} flex flex-col items-center gap-2 px-6 py-12 text-center`}>
      <h2 className="font-display text-[24px]">{title}</h2>
      {children && <div className="max-w-md text-[13.5px] leading-relaxed text-fg-muted">{children}</div>}
    </div>
  );
}
