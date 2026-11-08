"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, FormError, useRunner } from "@/components/studio/Actions";
import { cardCls, dangerBtn, inputCls, primaryBtn, quietBtn } from "@/components/studio/kit";

import { deleteHookAction, redeliverAction, rotateHookAction, sendTestAction, updateHookAction } from "../actions";
import { CredentialBox } from "../CredentialBox";
import { EventPicker } from "../EventPicker";

type EventOption = { type: string; label: string; group: string };
type HookView = {
  id: string;
  name: string;
  mode: "push" | "pull";
  url: string | null;
  events: string[];
  enabled: boolean;
  credential: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastPolledAt: string | null;
};
type Delivery = { eventId: string; type: string; status: string; attempts: number; lastHttpStatus: number | null; lastError: string | null; nextAttemptAt: string | null; deliveredAt: string | null; createdAt: string };
type SendResult = { status: string; httpStatus: number | null; error: string | null } | null;

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function resultLine(r: SendResult, mode: "push" | "pull"): string {
  if (!r) return mode === "pull" ? "Added a test.ping to the feed. It shows on the next read." : "Nothing was sent.";
  if (r.status === "delivered") return `Delivered (HTTP ${r.httpStatus}).`;
  if (r.status === "pending") return `Not delivered: ${r.error} It will be tried again.`;
  return `Not delivered: ${r.error}`;
}

export function HookDetail({ hook, deliveries, events }: { hook: HookView; deliveries: Delivery[]; events: EventOption[] }) {
  const router = useRouter();
  const { run, error, pending } = useRunner();
  const [picked, setPicked] = useState(hook.events);
  const [url, setUrl] = useState(hook.url ?? "");
  const [result, setResult] = useState<string | null>(null);
  const [credential, setCredential] = useState<string | null>(null);
  const failing = hook.lastErrorAt && (!hook.lastSuccessAt || hook.lastErrorAt > hook.lastSuccessAt);

  return (
    <div className="flex flex-col gap-6">
      <section className={`${cardCls} flex flex-col gap-3 p-5`}>
        <p className="text-[13px] text-fg-2">
          {hook.enabled ? "On" : "Off"} · {hook.mode === "push" ? "secret" : "feed token"} <code>{hook.credential}</code>
          {hook.mode === "pull" && ` · ${hook.lastPolledAt ? `last read ${when(hook.lastPolledAt)}` : "never read"}`}
          {hook.mode === "push" && hook.lastSuccessAt && ` · last delivered ${when(hook.lastSuccessAt)}`}
        </p>
        {failing && hook.lastError && (
          <p role="alert" className="text-[13px] text-[#ff9b8a]">
            Last attempt failed: {hook.lastError}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending || !hook.enabled} className={primaryBtn} onClick={() => run(() => sendTestAction(hook.id), (r) => setResult(resultLine(r, hook.mode)))}>
            Send test
          </button>
          <button type="button" disabled={pending} className={quietBtn} onClick={() => run(() => updateHookAction(hook.id, { enabled: !hook.enabled }))}>
            {hook.enabled ? "Turn off" : "Turn on"}
          </button>
          <button
            type="button"
            disabled={pending}
            className={quietBtn}
            onClick={() =>
              confirm(`Make a new ${hook.mode === "push" ? "secret" : "token"}? The old one stops working at once, so update the receiver straight after.`) &&
              run(() => rotateHookAction(hook.id), (d) => setCredential(d.credential))
            }
          >
            Rotate {hook.mode === "push" ? "secret" : "token"}
          </button>
          <button
            type="button"
            disabled={pending}
            className={dangerBtn}
            onClick={() =>
              confirm(`Delete “${hook.name}”? Nothing more is sent to it.`) &&
              run(
                () => deleteHookAction(hook.id),
                () => router.push("/settings/hooks"),
              )
            }
          >
            Delete
          </button>
        </div>
        {result && (
          <p role="status" className="text-[13px] text-fg-2">
            {result}
          </p>
        )}
        {credential && <CredentialBox mode={hook.mode} credential={credential} hookId={hook.id} />}
        <FormError message={error} />
      </section>

      <form
        className={`${cardCls} flex flex-col gap-4 p-5`}
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateHookAction(hook.id, hook.mode === "push" ? { events: picked, url } : { events: picked }));
        }}
      >
        {hook.mode === "push" && (
          <Field label="Address">
            <input className={inputCls} value={url} type="url" onChange={(e) => setUrl(e.target.value)} />
          </Field>
        )}
        <EventPicker events={events} picked={picked} onChange={setPicked} />
        <div>
          <button type="submit" disabled={pending || !picked.length} className={quietBtn}>
            Save changes
          </button>
        </div>
      </form>

      {hook.mode === "push" && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[15px] font-semibold text-fg">Recent deliveries</h2>
          {deliveries.length === 0 ? (
            <p className="text-[13px] text-fg-muted">Nothing sent yet.</p>
          ) : (
            <ul className={`${cardCls} divide-y divide-rule`}>
              {deliveries.map((d) => (
                <li key={d.eventId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-[13px] text-fg">
                      <code>{d.type}</code> · {when(d.createdAt)}
                    </p>
                    <p className="text-[12px] text-fg-muted">
                      {d.status === "delivered" ? `Delivered${d.lastHttpStatus ? ` (HTTP ${d.lastHttpStatus})` : ""}` : d.status === "pending" ? "Waiting to retry" : "Failed"} · {d.attempts} attempt
                      {d.attempts === 1 ? "" : "s"}
                      {d.status === "pending" && d.nextAttemptAt && ` · next ${when(d.nextAttemptAt)}`}
                      {d.status !== "delivered" && d.lastError && ` · ${d.lastError}`}
                    </p>
                  </div>
                  {d.status !== "delivered" && (
                    <button type="button" disabled={pending || !hook.enabled} className={quietBtn} onClick={() => run(() => redeliverAction(hook.id, d.eventId), (r) => setResult(resultLine(r, hook.mode)))}>
                      Redeliver
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
