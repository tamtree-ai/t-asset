"use client";

import { type ReactNode, useEffect, useRef } from "react";

/** The native <dialog>: focus is trapped, Escape closes it, and the page behind is inert. */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="room m-auto w-[min(92vw,460px)] rounded-2xl border border-room-line bg-room-surface p-0 text-room-fg shadow-[0_24px_80px_rgb(0_0_0/0.25)] backdrop:bg-black/40"
      style={{ minHeight: 0 }}
    >
      {open && (
        <div className="flex flex-col gap-4 p-6">
          <h2 id="modal-title" className="font-display text-[28px] leading-none">
            {title}
          </h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
