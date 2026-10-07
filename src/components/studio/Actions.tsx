"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";

import type { ActionResult } from "@/lib/studio/errors";

import { dangerBtn, primaryBtn, quietBtn } from "./kit";

/** Runs a server action, shows its error under the button, and refreshes the page on success. */
export function useRunner() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function run<T>(fn: () => Promise<ActionResult<T>>, then?: (data: T) => void) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error);
      then?.(r.data);
      router.refresh();
    });
  }
  return { run, error, pending, setError };
}

export function ActionButton({
  action,
  children,
  kind = "quiet",
  confirm,
  onDone,
}: {
  action: () => Promise<ActionResult<unknown>>;
  children: ReactNode;
  kind?: "primary" | "quiet" | "danger";
  confirm?: string;
  onDone?: () => void;
}) {
  const { run, error, pending } = useRunner();
  const cls = kind === "primary" ? primaryBtn : kind === "danger" ? dangerBtn : quietBtn;
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        className={cls}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          run(action, () => onDone?.());
        }}
      >
        {children}
      </button>
      {error && (
        <span role="alert" className="max-w-xs text-[12px] text-[#ff9a8a]">
          {error}
        </span>
      )}
    </span>
  );
}

export function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-[12.5px] text-[#ff9a8a]">
      {message}
    </p>
  ) : null;
}

/** A label above a control. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-[12.5px] text-fg-3">
      <span>{label}</span>
      {children}
      {hint && <span className="text-[12px] text-fg-muted">{hint}</span>}
    </label>
  );
}
