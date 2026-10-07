"use client";

import { useState } from "react";

import { regeneratePasscodeAction, restoreShareAction, revealShareAction, revokeShareAction } from "@/app/studio/actions";

import { ActionButton, FormError, useRunner } from "./Actions";
import { cardCls, primaryBtn, quietBtn } from "./kit";

/** The link and passcode, decrypted only when asked, with a message ready to paste into email or WhatsApp. */
export function ShareLinkPanel({ shareId, state, template }: { shareId: string; state: "live" | "expired" | "revoked"; template: { studioName: string; clientName: string; title: string; expiresAt: string | null } }) {
  const { run, error, pending } = useRunner();
  const [secret, setSecret] = useState<{ url: string; passcode: string; passcodeDisplay: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied("Select the text and copy it.");
    }
  }
  const message = secret
    ? [
        `Hi ${template.clientName},`,
        "",
        `“${template.title}” is ready for your review. You can leave comments straight on the work, and approve it when you're happy.`,
        "",
        `Link: ${secret.url}`,
        `Passcode: ${secret.passcodeDisplay}`,
        ...(template.expiresAt ? [`Open until: ${template.expiresAt}`] : []),
        "",
        "Thanks,",
        template.studioName,
      ].join("\n")
    : "";

  return (
    <section aria-labelledby="link" className={`${cardCls} flex flex-col gap-4 p-5`}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="link" className="text-[17px] font-semibold">
          Link and passcode
        </h2>
        <span className="text-[12.5px] text-fg-2">{state === "live" ? "Open" : state === "expired" ? "Expired" : "Ended"}</span>
      </div>
      {secret ? (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input readOnly aria-label="Review link" value={secret.url} onFocus={(e) => e.currentTarget.select()} className="h-9 rounded-lg border border-line bg-canvas px-2.5 font-mono text-[12.5px]" />
            <button type="button" className={quietBtn} onClick={() => copy("Link copied.", secret.url)}>
              Copy link
            </button>
            <input readOnly aria-label="Passcode" value={secret.passcodeDisplay} className="num h-9 rounded-lg border border-line bg-canvas px-2.5 text-[15px] tracking-[0.2em]" />
            <button type="button" className={quietBtn} onClick={() => copy("Passcode copied.", secret.passcode)}>
              Copy passcode
            </button>
          </div>
          <textarea readOnly aria-label="Message to send" rows={9} value={message} className="w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-[13px] leading-relaxed" onFocus={(e) => e.currentTarget.select()} />
          <div className="flex items-center gap-3">
            <button type="button" className={primaryBtn} onClick={() => copy("Message copied.", message)}>
              Copy link + passcode message
            </button>
            {copied && <span role="status" className="text-[12.5px] text-fg-3">{copied}</span>}
          </div>
        </div>
      ) : (
        <div>
          <button type="button" disabled={pending} className={quietBtn} onClick={() => run(() => revealShareAction(shareId), setSecret)}>
            Show link and passcode
          </button>
        </div>
      )}
      <FormError message={error} />
      <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
        <ActionButton
          confirm="Make a new passcode? Everyone who already unlocked the link has to type the new one."
          action={async () => {
            const r = await regeneratePasscodeAction(shareId);
            if (r.ok) setSecret(null);
            return r;
          }}
        >
          New passcode
        </ActionButton>
        {state === "revoked" ? (
          <ActionButton action={() => restoreShareAction(shareId)}>Reopen link</ActionButton>
        ) : (
          <ActionButton kind="danger" confirm="End this review link now? The client sees “this link has ended”, and everyone is signed out of it." action={() => revokeShareAction(shareId)}>
            End link
          </ActionButton>
        )}
      </div>
    </section>
  );
}
