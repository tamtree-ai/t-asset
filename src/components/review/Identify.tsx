"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";

import { identifyAction } from "@/app/review/[token]/actions";

import { BrandMark } from "./BrandMark";

const KEY = "studio-review-identity";

// A string snapshot (not an object) so React sees it as unchanged between renders.
const readSaved = (): string => {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};
const parse = (raw: string): { name: string; email: string } => {
  try {
    const v = JSON.parse(raw || "null") as { name?: string; email?: string } | null;
    return { name: v?.name ?? "", email: v?.email ?? "" };
  } catch {
    return { name: "", email: "" };
  }
};

/** Name and email, asked once per browser (plan §4.3 step 2). The email is for reply notifications and the sign-off. */
export function Identify({ token, studioName, hasLogo }: { token: string; studioName: string; hasLogo: boolean }) {
  const router = useRouter();
  const saved = useSyncExternalStore(
    () => () => undefined,
    readSaved,
    () => "",
  );
  const prefill = parse(saved);
  const [typedName, setName] = useState<string | null>(null);
  const [typedEmail, setEmail] = useState<string | null>(null);
  const name = typedName ?? prefill.name;
  const email = typedEmail ?? prefill.email;
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <form
        className="flex w-full max-w-[400px] flex-col gap-5 rounded-2xl border border-room-line bg-room-surface p-7 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_40px_rgb(0_0_0/0.06)]"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await identifyAction(token, name, email);
            if (!r.ok) return setError(r.error);
            try {
              localStorage.setItem(KEY, JSON.stringify({ name, email }));
            } catch {}
            router.refresh();
          });
        }}
      >
        <BrandMark token={token} name={studioName} hasLogo={hasLogo} />
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-[30px] leading-[1.05]">Who’s reviewing?</h1>
          <p className="text-[14px] text-room-muted">Your name goes on your comments. Your email gets you a note when {studioName} replies, and goes on your approval.</p>
        </div>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-room-fg-2">
          Your name
          <input autoFocus autoComplete="name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className="h-11 rounded-xl border border-room-line bg-room-bg px-3.5 text-[15px] font-normal text-room-fg" />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-room-fg-2">
          Your email
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-xl border border-room-line bg-room-bg px-3.5 text-[15px] font-normal text-room-fg" />
        </label>
        {error && (
          <p role="alert" className="text-[13px] text-[#b42318]">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className="h-11 rounded-xl bg-brand text-[14px] font-semibold text-brand-ink hover:bg-brand-hover disabled:opacity-50">
          {pending ? "One moment…" : "Continue"}
        </button>
      </form>
    </main>
  );
}
