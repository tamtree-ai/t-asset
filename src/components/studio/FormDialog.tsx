"use client";

import { type ReactNode, useEffect, useRef } from "react";

/**
 * The studio's create forms open in a native <dialog> (dark, centred) instead of swapping into the
 * header row they were launched from, where they pushed the title and status around.
 * Focus is trapped, Escape closes it, and a click on the backdrop closes it.
 */
export function FormDialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
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
      aria-labelledby="form-dialog-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(92vw,480px)] rounded-[14px] border border-line bg-panel p-0 text-fg shadow-2xl backdrop:bg-black/60"
    >
      {open && (
        <div className="flex flex-col gap-4 p-5">
          <h2
            id="form-dialog-title"
            className="font-display text-[26px] leading-none"
          >
            {title}
          </h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
