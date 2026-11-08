import Link from "next/link";

import { cardCls, Page, Title } from "@/components/studio/kit";
import { StudioHeader } from "@/components/studio/StudioHeader";
import { getCurrentMember } from "@/lib/auth";
import { HOOK_EVENTS, MAX_HOOKS } from "@/lib/hooks";
import { ago } from "@/lib/studio/format";
import { listHooks } from "@/services/hooks/subscriptions";

import { NewHook } from "./NewHook";

export const dynamic = "force-dynamic";

/** Hooks: tell tamshoot, Tamtree or any HTTPS endpoint when something happens here (docs/hooks.md). */
export default async function HooksPage() {
  const member = await getCurrentMember();
  if (member.role !== "owner") {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <p className="text-[14px] text-fg-muted">Hooks stay with the workspace owner.</p>
      </main>
    );
  }
  const hooks = await listHooks(member.orgId);
  const now = new Date();
  return (
    <>
      <StudioHeader trail={[{ label: "Hooks" }]} />
      <Page>
        <Title
          sub={
            <>
              A hook tells another tool (tamshoot, a Tamtree workflow, your own script) when a client comments, decides, or signs in. Each event is sent with the
              project, asset, version and comment, and the reviewer’s name and email, so it can act without asking back. Internal comments are never sent.
            </>
          }
        >
          Hooks
        </Title>
        <div className="flex flex-col gap-6">
          {hooks.length > 0 && (
            <ul className={`${cardCls} divide-y divide-rule`}>
              {hooks.map((h) => (
                <li key={h.id}>
                  <Link href={`/settings/hooks/${h.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-hover">
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-fg">
                        {h.name} {!h.enabled && <span className="font-normal text-fg-muted">· off</span>}
                      </p>
                      <p className="truncate text-[12px] text-fg-muted">
                        {h.mode === "push" ? `Push to ${h.url}` : "Pull feed"} · {h.events.length} event{h.events.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <p className="text-[12px] text-fg-muted">
                      {h.lastErrorAt && (!h.lastSuccessAt || h.lastErrorAt > h.lastSuccessAt) ? (
                        <span className="text-[#ff9b8a]">Last send failed {ago(h.lastErrorAt, now)}</span>
                      ) : h.mode === "pull" ? (
                        h.lastPolledAt ? `Last checked ${ago(h.lastPolledAt, now)}` : "Never checked"
                      ) : h.lastSuccessAt ? (
                        `Last sent ${ago(h.lastSuccessAt, now)}`
                      ) : (
                        "Nothing sent yet"
                      )}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {hooks.length < MAX_HOOKS ? <NewHook events={HOOK_EVENTS.map((e) => ({ ...e }))} /> : <p className="text-[13px] text-fg-muted">A studio holds up to {MAX_HOOKS} hooks. Delete one to add another.</p>}
        </div>
      </Page>
    </>
  );
}
