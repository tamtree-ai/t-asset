"use client";

import { useState } from "react";

import { quietBtn } from "@/components/studio/kit";

/** A new secret or feed token, shown once, with what to do with it on the other side. */
export function CredentialBox({ mode, credential, hookId }: { mode: "push" | "pull"; credential: string; hookId: string }) {
  const [copied, setCopied] = useState(false);
  const feedUrl = typeof window === "undefined" ? `/api/hooks/${hookId}/events` : `${window.location.origin}/api/hooks/${hookId}/events`;
  return (
    <div role="status" className="flex flex-col gap-2 rounded-lg border border-line bg-canvas p-3">
      <p className="text-[13px] text-fg-2">{mode === "push" ? "The signing secret." : "The feed token."} Copy it now. It won’t be shown again.</p>
      <code className="break-all text-[13px] text-fg" data-testid="new-credential">
        {credential}
      </code>
      <div>
        <button type="button" className={quietBtn} onClick={() => void navigator.clipboard?.writeText(credential).then(() => setCopied(true))}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {mode === "push" ? (
        <p className="text-[12px] leading-relaxed text-fg-muted">
          Every delivery is signed with it: <code>X-Tamtree-Signature: sha256=…</code> over <code>&lt;X-Tamtree-Timestamp&gt;.&lt;body&gt;</code>. In a Tamtree Webhook
          Trigger, set Verify sender to Signed and paste it as the Webhook signing secret.
        </p>
      ) : (
        <p className="text-[12px] leading-relaxed text-fg-muted">
          Read <code className="break-all">{feedUrl}</code> with <code>Authorization: Bearer &lt;token&gt;</code>. In Tamtree, use Poll for new data with Where the items are{" "}
          <code>{"{{ $json['items'] }}"}</code> and Unique field <code>id</code>. Every read wakes the database, so check every 30 minutes or more on Neon.
        </p>
      )}
    </div>
  );
}
