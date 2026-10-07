"use client";

import { useState, useTransition } from "react";

import { StudioMark } from "@/components/StudioMark";

import { signInAction } from "./actions";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4">
      <StudioMark />
      <h1 className="font-display text-[40px] leading-none">Sign in</h1>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const result = await signInAction(email, password);
            if (result && !result.ok) setError(result.error);
          });
        }}
      >
        <label className="flex flex-col gap-1.5 text-[12.5px] text-fg-3">
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-lg border border-line bg-panel px-3 text-[14px] text-fg" />
        </label>
        <label className="flex flex-col gap-1.5 text-[12.5px] text-fg-3">
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 rounded-lg border border-line bg-panel px-3 text-[14px] text-fg" />
        </label>
        <button type="submit" disabled={pending} className="h-11 rounded-md bg-accent font-semibold text-accent-ink disabled:opacity-60">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-[13px] text-[#ff9a8a]">
          {error}
        </p>
      )}
    </main>
  );
}
