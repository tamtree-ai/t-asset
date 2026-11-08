"use client";

import Link from "next/link";
import { useState } from "react";

import { Field, FormError, useRunner } from "@/components/studio/Actions";
import { cardCls, inputCls, primaryBtn } from "@/components/studio/kit";

import { createHookAction } from "./actions";
import { CredentialBox } from "./CredentialBox";
import { EventPicker } from "./EventPicker";

type EventOption = { type: string; label: string; group: string };

export function NewHook({ events }: { events: EventOption[] }) {
  const { run, error, pending } = useRunner();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"push" | "pull">("push");
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [made, setMade] = useState<{ id: string; credential: string; mode: "push" | "pull" } | null>(null);

  return (
    <form
      className={`${cardCls} flex flex-col gap-4 p-5`}
      onSubmit={(e) => {
        e.preventDefault();
        setMade(null);
        run(
          () => createHookAction(mode === "push" ? { mode, name, events: picked, url } : { mode, name, events: picked }),
          (d) => {
            setMade({ ...d, mode });
            setName("");
            setUrl("");
            setPicked([]);
          },
        );
      }}
    >
      <h2 className="text-[15px] font-semibold text-fg">Add a hook</h2>
      <Field label="Name" hint="What it is for, e.g. “tamshoot: comments and decisions”.">
        <input className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium text-fg-2">How it hears about events</legend>
        <label className="flex items-start gap-2 text-[13px] text-fg-2">
          <input type="radio" name="mode" checked={mode === "push"} onChange={() => setMode("push")} className="mt-0.5" />
          <span>
            <strong className="font-medium text-fg">Push</strong> (recommended): t-asset sends each event to an address, signed, and retries for a day if it’s down.
          </span>
        </label>
        <label className="flex items-start gap-2 text-[13px] text-fg-2">
          <input type="radio" name="mode" checked={mode === "pull"} onChange={() => setMode("pull")} className="mt-0.5" />
          <span>
            <strong className="font-medium text-fg">Pull</strong>: the tool reads a feed of recent events with a token. For when its address can’t be reached from the internet.
          </span>
        </label>
      </fieldset>
      {mode === "push" && (
        <Field label="Address" hint="Where to send events. https:// (a local http:// address works in development).">
          <input className={inputCls} value={url} type="url" placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
        </Field>
      )}
      <EventPicker events={events} picked={picked} onChange={setPicked} />
      <FormError message={error} />
      <div>
        <button type="submit" disabled={pending || !name.trim() || !picked.length || (mode === "push" && !url.trim())} className={primaryBtn}>
          Add hook
        </button>
      </div>
      {made && (
        <>
          <CredentialBox mode={made.mode} credential={made.credential} hookId={made.id} />
          <p className="text-[13px]">
            <Link href={`/settings/hooks/${made.id}`} className="text-accent underline-offset-2 hover:underline">
              Open the hook
            </Link>{" "}
            to send a test.
          </p>
        </>
      )}
    </form>
  );
}
