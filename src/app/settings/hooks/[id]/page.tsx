import { notFound } from "next/navigation";

import { Page, Title } from "@/components/studio/kit";
import { StudioHeader } from "@/components/studio/StudioHeader";
import { getCurrentMember } from "@/lib/auth";
import { HOOK_EVENTS } from "@/lib/hooks";
import { StudioError } from "@/lib/studio/errors";
import { credentialLabel, getHook, recentDeliveries } from "@/services/hooks/subscriptions";

import { HookDetail } from "./HookDetail";

export const dynamic = "force-dynamic";

export default async function HookPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember();
  if (member.role !== "owner") notFound();
  const { id } = await params;
  let hook;
  try {
    hook = await getHook(member.orgId, id);
  } catch (e) {
    if (e instanceof StudioError) notFound();
    throw e;
  }
  const deliveries = hook.mode === "push" ? await recentDeliveries(member.orgId, id) : [];
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return (
    <>
      <StudioHeader trail={[{ label: "Hooks", href: "/settings/hooks" }, { label: hook.name }]} />
      <Page>
        <Title sub={hook.mode === "push" ? <>Pushes to {hook.url}</> : <>A pull feed, read with its token.</>}>{hook.name}</Title>
        <HookDetail
          events={HOOK_EVENTS.map((e) => ({ ...e }))}
          hook={{
            id: hook.id,
            name: hook.name,
            mode: hook.mode,
            url: hook.url,
            events: hook.events,
            enabled: hook.enabled,
            credential: credentialLabel(hook),
            lastSuccessAt: iso(hook.lastSuccessAt),
            lastErrorAt: iso(hook.lastErrorAt),
            lastError: hook.lastError,
            lastPolledAt: iso(hook.lastPolledAt),
          }}
          deliveries={deliveries.map((d) => ({ ...d, nextAttemptAt: iso(d.nextAttemptAt), deliveredAt: iso(d.deliveredAt), createdAt: d.createdAt.toISOString() }))}
        />
      </Page>
    </>
  );
}
