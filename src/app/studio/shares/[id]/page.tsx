import { notFound } from "next/navigation";

import { ago, cardCls, Page, Title } from "@/components/studio/kit";
import { StudioHeader } from "@/components/studio/StudioHeader";
import { ShareLinkPanel } from "@/components/studio/ShareControls";
import { ShareForm } from "@/components/studio/ShareForm";
import { studioMember } from "@/lib/studio/member";
import { getBrand } from "@/services/studio/brand";
import { getClient } from "@/services/studio/clients";
import { describeEvent, listEvents } from "@/services/studio/events";
import { projectOverview } from "@/services/studio/projects";
import { getShare, listReviewers, shareState } from "@/services/studio/shares";

export const dynamic = "force-dynamic";

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await studioMember();
  const found = await getShare(member.orgId, id);
  if (!found) notFound();
  const { share, items } = found;
  const [overview, brand, reviewers, events] = await Promise.all([projectOverview(member.orgId, share.projectId), getBrand(member.orgId), listReviewers(member.orgId, id), listEvents(member.orgId, { shareId: id }, 30)]);
  if (!overview) notFound();
  const client = (await getClient(member.orgId, overview.project.clientId))!;
  const picked = new Set(items.map((i) => i.assetId));
  const state = shareState(share);

  return (
    <>
      <StudioHeader trail={[{ label: client.name, href: `/studio/clients/${client.id}` }, { label: overview.project.name, href: `/studio/projects/${overview.project.id}` }, { label: share.title }]} />
      <Page>
        <Title sub={`${items.length} ${items.length === 1 ? "asset" : "assets"} · ${overview.rounds.label}`}>{share.title}</Title>

        <ShareLinkPanel
          shareId={id}
          state={state}
          template={{ studioName: brand.studioName, clientName: client.contacts[0]?.name?.split(" ")[0] || client.name, title: share.title, expiresAt: share.expiresAt ? share.expiresAt.toISOString().slice(0, 10) : null }}
        />

        <section aria-labelledby="reviewers" className="flex flex-col gap-3">
          <h2 id="reviewers" className="text-[17px] font-semibold">
            Who has opened it
          </h2>
          {reviewers.length === 0 ? (
            <p className="text-[13.5px] text-fg-muted">Nobody yet.</p>
          ) : (
            <ul className={`${cardCls} divide-y divide-rule`}>
              {reviewers.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-[13px]">
                  <span>
                    <span className="font-medium">{r.name}</span> <span className="text-fg-muted">{r.email}</span>
                  </span>
                  <span className="text-[12px] text-fg-muted">{r.lastSeenAt ? `Last seen ${ago(r.lastSeenAt)}` : "Joined"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="edit" className="flex flex-col gap-3">
          <h2 id="edit" className="text-[17px] font-semibold">
            Settings
          </h2>
          <ShareForm
            projectId={share.projectId}
            shareId={id}
            assets={overview.assets.map((a) => ({ id: a.id, title: a.title, kind: a.kind, hasVersion: !!a.latest }))}
            initial={{
              title: share.title,
              message: share.message,
              notes: share.notes,
              expiresAt: share.expiresAt ? share.expiresAt.toISOString().slice(0, 10) : "",
              downloadPolicy: share.downloadPolicy,
              watermark: share.watermark,
              commentsOpen: share.commentsOpen,
              versionMode: share.versionMode,
              assetIds: overview.assets.filter((a) => picked.has(a.id)).map((a) => a.id),
            }}
          />
        </section>

        <section aria-labelledby="activity" className="flex flex-col gap-3">
          <h2 id="activity" className="text-[17px] font-semibold">
            Activity
          </h2>
          {events.length === 0 ? (
            <p className="text-[13.5px] text-fg-muted">Nothing has happened on this link yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-[13px] text-fg-2">
              {events.map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-4 border-b border-rule pb-2 last:border-0">
                  <span>{describeEvent(e)}</span>
                  <time dateTime={e.createdAt.toISOString()} className="shrink-0 text-[12px] text-fg-muted">
                    {ago(e.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Page>
    </>
  );
}
