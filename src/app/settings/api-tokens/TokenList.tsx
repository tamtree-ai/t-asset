"use client";

import { useState } from "react";

import { Field, FormError, useRunner } from "@/components/studio/Actions";
import { cardCls, dangerBtn, inputCls, primaryBtn, quietBtn } from "@/components/studio/kit";

import { createApiTokenAction, revokeApiTokenAction } from "./actions";

type Token = { id: string; name: string; hint: string; scopes: string[]; lastUsedAt: string | null; revokedAt: string | null; createdAt: string };

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function TokenList({ tokens }: { tokens: Token[] }) {
  const { run, error, pending } = useRunner();
  const [name, setName] = useState("");
  const [write, setWrite] = useState(true);
  const [made, setMade] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <form
        className={`${cardCls} flex flex-col gap-4 p-5`}
        onSubmit={(e) => {
          e.preventDefault();
          setMade(null);
          setCopied(false);
          run(
            () => createApiTokenAction({ name, scopes: write ? ["review:read", "review:write"] : ["review:read"] }),
            (d) => {
              setMade(d.token);
              setName("");
            },
          );
        }}
      >
        <Field label="Name" hint="Who uses it, e.g. “tamshoot on the studio laptop”.">
          <input className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-[13px] text-fg-2">
          <input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} />
          Can send versions and reply (review:write). Without it, the token only reads.
        </label>
        <FormError message={error} />
        <div>
          <button type="submit" disabled={pending || !name.trim()} className={primaryBtn}>
            Create token
          </button>
        </div>
        {made && (
          <div role="status" className="flex flex-col gap-2 rounded-lg border border-line bg-canvas p-3">
            <p className="text-[13px] text-fg-2">Copy it now. It won’t be shown again.</p>
            <code className="break-all text-[13px] text-fg" data-testid="new-token">
              {made}
            </code>
            <div>
              <button
                type="button"
                className={quietBtn}
                onClick={() => {
                  void navigator.clipboard?.writeText(made).then(() => setCopied(true));
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </form>

      {tokens.length === 0 ? (
        <p className="text-[13px] text-fg-muted">No tokens yet.</p>
      ) : (
        <ul className={`${cardCls} divide-y divide-rule`}>
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-fg">
                  {t.name} <span className="font-normal text-fg-muted">…{t.hint}</span>
                </p>
                <p className="text-[12px] text-fg-muted">
                  {t.scopes.join(", ")} · made {day(t.createdAt)} · {t.lastUsedAt ? `last used ${day(t.lastUsedAt)}` : "never used"}
                  {t.revokedAt && ` · revoked ${day(t.revokedAt)}`}
                </p>
              </div>
              {!t.revokedAt && (
                <button type="button" disabled={pending} className={dangerBtn} onClick={() => confirm(`Revoke “${t.name}”? Anything using it stops at once.`) && run(() => revokeApiTokenAction(t.id))}>
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
