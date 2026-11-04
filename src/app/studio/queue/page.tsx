import Link from "next/link";

import { ago, Empty, Page, primaryBtn, Title } from "@/components/studio/kit";
import { StudioHeader } from "@/components/studio/StudioHeader";
import { studioMember } from "@/lib/studio/member";
import { internalQueue, type QueueItem } from "@/services/studio/release";

import { releaseFormAction } from "../release-actions";

export const dynamic = "force-dynamic";

/**
 * Drafts to review: every internal version in the studio, grouped by project. Watch each one in
 * its room, leave notes for a new version, then release the good ones to the client in one go.
 */
export default async function QueuePage() {
  const member = await studioMember();
  const items = await internalQueue(member.orgId);
  const byProject = new Map<string, QueueItem[]>();
  for (const it of items) byProject.set(it.projectId, [...(byProject.get(it.projectId) ?? []), it]);

  return (
    <>
      <StudioHeader trail={[{ label: "Drafts to review" }]} />
      <Page wide>
        <Title sub="Internal drafts your clients can't see yet. Watch each one, leave notes on the exact moment for a new version, and release the ones that are ready.">Drafts to review</Title>
        {items.length === 0 ? (
          <Empty title="Nothing waiting on you">New drafts from the shorts pipeline land here first.</Empty>
        ) : (
          [...byProject.values()].map((group) => (
            <form key={group[0]!.projectId} action={releaseFormAction} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-rule pb-2">
                <h2 className="text-[16px] font-semibold">
                  {group[0]!.clientName} · <Link href={`/studio/projects/${group[0]!.projectId}`} className="hover:underline">{group[0]!.projectName}</Link>
                  <span className="ml-2 text-[13px] font-normal text-fg-muted">{group.length} {group.length === 1 ? "draft" : "drafts"}</span>
                </h2>
                <button type="submit" className={primaryBtn}>
                  Release selected to client
                </button>
              </div>
              <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
                {group.map((it) => (
                  <li key={it.versionId} className="flex flex-col gap-2 rounded-xl border border-line bg-panel p-4">
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/studio/assets/${it.assetId}?v=${it.versionId}`} className="text-[14.5px] font-semibold hover:underline">
                        {it.assetTitle} <span className="font-normal text-fg-muted">v{it.number}</span>
                      </Link>
                      <label className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-fg-3">
                        <input type="checkbox" name="version" value={it.versionId} defaultChecked={it.openComments === 0} />
                        Release
                      </label>
                    </div>
                    <p className="num text-[12px] text-fg-muted">
                      {it.durationS ? `${Math.round(it.durationS)} s · ` : ""}
                      {it.processing === "ready" ? "ready" : it.processing} · {it.openComments} open {it.openComments === 1 ? "note" : "notes"} · {ago(it.createdAt)}
                    </p>
                    {it.meta.hook && <p className="text-[13px] font-medium">“{it.meta.hook}”</p>}
                    {it.meta.why && <p className="text-[13px] leading-relaxed text-fg-2">{it.meta.why}</p>}
                    {it.changeNote && <p className="text-[12.5px] text-fg-muted">What changed: {it.changeNote}</p>}
                  </li>
                ))}
              </ul>
            </form>
          ))
        )}
      </Page>
    </>
  );
}
