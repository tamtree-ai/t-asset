"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { unlockAction } from "@/app/review/[token]/actions";
import { PASSCODE_ALPHABET, PASSCODE_LENGTH } from "@/lib/studio/passcode";

import { BrandMark } from "./BrandMark";

/** The passcode gate (plan §4.3 step 1). */
export function Gate({ token, studioName, hasLogo, title, clientName }: { token: string; studioName: string; hasLogo: boolean; title: string; clientName: string | null }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Only letters and digits the alphabet uses; the rest of what a person pastes ("abc-def", spaces) is dropped.
  const clean = (s: string) => [...s.toUpperCase()].filter((c) => PASSCODE_ALPHABET.includes(c)).join("").slice(0, PASSCODE_LENGTH);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <form
        className="flex w-full max-w-[400px] flex-col gap-6 rounded-2xl border border-room-line bg-room-surface p-7 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_40px_rgb(0_0_0/0.06)]"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await unlockAction(token, code);
            if (!r.ok) return setError(r.error);
            router.refresh();
          });
        }}
      >
        <BrandMark token={token} name={studioName} hasLogo={hasLogo} size="lg" />
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-[34px] leading-[1.05]">{title}</h1>
          <p className="text-[14px] text-room-muted">{clientName ? `Prepared for ${clientName}. ` : ""}Enter the passcode you were sent to open it.</p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="passcode" className="text-[13px] font-medium text-room-fg-2">
            Passcode
          </label>
          <input
            id="passcode"
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            value={code}
            onChange={(e) => setCode(clean(e.target.value))}
            aria-invalid={!!error}
            aria-describedby={error ? "passcode-error" : undefined}
            placeholder="ABC123"
            className="num h-12 rounded-xl border border-room-line bg-room-bg px-4 text-center text-[22px] tracking-[0.35em] text-room-fg placeholder:text-room-muted/50"
          />
          {error && (
            <p id="passcode-error" role="alert" className="text-[13px] text-[#b42318]">
              {error}
            </p>
          )}
        </div>
        <button type="submit" disabled={pending || code.length < PASSCODE_LENGTH} className="h-11 rounded-xl bg-brand text-[14px] font-semibold text-brand-ink hover:bg-brand-hover disabled:opacity-50">
          {pending ? "Checking…" : "Open the review"}
        </button>
      </form>
    </main>
  );
}
