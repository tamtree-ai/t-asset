import Link from "next/link";
import { notFound } from "next/navigation";

import { ProjectActions } from "./ProjectActions";
import { ProjectEditor } from "@/components/studio/ProjectForms";
import { ago, cardCls, Empty, Page, StatusLine, Title } from "@/components/studio/kit";
import { StudioHeader } from "@/components/studio/StudioHeader";
import { studioMember } from "@/lib/studio/member";
import { describeEvent, listEvents } from "@/services/studio/events";
import { projectOverview } from "@/services/studio/projects";
import { listShares } from "@/services/studio/shares";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await studioMember();
  const overview = await projectOverview(member.orgId, id);
  if (!overview) notFound();
  const { project, client, rounds, assets } = overview;
  const [shares, events] = await Promise.all([listShares(member.orgId, id), listEvents(member.orgId, { projectId: id }, 30)]);

  return (
    <>
      <StudioHeader trail={[{ label: client.name, href: `/studio/clients/${client.id}` }, { label: project.name }]} />
      <Page wide>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Title
            sub={
              <>
                {client.name} · <span className={rounds.over ? "text-attention" : ""}>{rounds.label}</span>
                {rounds.note && <span className="ml-2">{rounds.note}</span>}
                {project.dueDate && <> · Due {project.dueDate}</>}
              </>
            }
          >
            {project.name}
          </Title>
          <div className="flex items-center gap-2.5">
            <StatusLine status={overview.status} />
            <ProjectActions projectId={id} canShare={assets.some((a) => a.latest)} />
          </div>
        </div>

        <section aria-labelledby="assets" className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id="assets" className="text-[17px] font-semibold">
              Assets
            </h2>
            {assets.some((a) => a.latest) && (
              <a href={`/api/studio/export?project=${id}`} className="text-[13px] text-fg-3 hover:text-fg">
                Export all comments (CSV)
              </a>
            )}
          </div>
          {assets.length === 0 ? (
            <Empty title="No assets yet">Add a banner, poster or video, upload the first version, then share it with your client.</Empty>
          ) : (
            <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {assets.map((a) => (
                <li key={a.id}>
                  <Link href={`/studio/assets/${a.id}`} className={`${cardCls} group flex h-full flex-col overflow-hidden hover:border-line-strong`}>
                    <div className="flex aspect-[4/3] items-center justify-center bg-canvas-script">
                      {a.latest && a.latest.processing === "ready" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/studio/files/${a.latest.fileId}?r=thumb`} alt="" className="size-full object-cover" />
                      ) : (
                        <span className="flex items-center gap-2 text-[12.5px] text-fg-muted">
                          {a.latest ? (
                            <>
                              <span aria-hidden className="animate-filming size-2 rounded-full bg-accent" />
                              {a.latest.processing === "failed" ? "Couldn't process" : "Processing…"}
                            </>
                          ) : (
                            "No upload yet"
                          )}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 p-3">
                      <span className="truncate text-[13.5px] font-medium">{a.title}</span>
                      <span className="text-[12px] text-fg-muted">
                        {a.kind === "video" ? "Video" : "Image"} · {a.variationCount} {a.variationCount === 1 ? "option" : "options"}
                        {a.latest ? ` · v${a.latest.number}` : ""}
                      </span>
                      <StatusLine status={a.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="shares" className="flex flex-col gap-4">
          <h2 id="shares" className="text-[17px] font-semibold">
            Review links
          </h2>
          {shares.length === 0 ? (
            <p className="text-[13.5px] text-fg-muted">Nothing shared yet. Once an asset has a version, “New review link” makes a link and a passcode.</p>
          ) : (
            <ul className={`${cardCls} divide-y divide-rule`}>
              {shares.map((s) => (
                <li key={s.id}>
                  <Link href={`/studio/shares/${s.id}`} className="grid items-center gap-2 px-4 py-3.5 hover:bg-hover sm:grid-cols-[minmax(0,1fr)_110px_130px_150px]">
                    <span className="truncate text-[14px] font-medium">{s.title}</span>
                    <span className="text-[12.5px] text-fg-muted">{s.assetCount} {s.assetCount === 1 ? "asset" : "assets"}</span>
                    <span className="text-[12.5px] text-fg-muted">{s.reviewers.length} {s.reviewers.length === 1 ? "reviewer" : "reviewers"}</span>
                    <span className="text-[12.5px] text-fg-2">{s.state === "live" ? "Open" : s.state === "expired" ? "Expired" : "Ended"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="activity" className="flex flex-col gap-4">
          <h2 id="activity" className="text-[17px] font-semibold">
            Activity
          </h2>
          {events.length === 0 ? (
            <p className="text-[13.5px] text-fg-muted">Uploads, comments and decisions show up here.</p>
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

        <section aria-labelledby="settings" className="flex flex-col gap-4">
          <h2 id="settings" className="text-[17px] font-semibold">
            Project settings
          </h2>
          <ProjectEditor project={{ id, clientId: client.id, name: project.name, dueDate: project.dueDate, roundsIncluded: project.roundsIncluded, status: project.status, archived: !!project.archivedAt }} />
        </section>
      </Page>
    </>
  );
}
