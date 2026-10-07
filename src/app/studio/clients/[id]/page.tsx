import Link from "next/link";
import { notFound } from "next/navigation";

import { ClientEditor } from "@/components/studio/ClientForms";
import { cardCls, Empty, Page, StatusLine, Title } from "@/components/studio/kit";
import { StudioHeader } from "@/components/studio/StudioHeader";
import { NewProjectForm } from "@/components/studio/ProjectForms";
import { studioMember } from "@/lib/studio/member";
import { getClient } from "@/services/studio/clients";
import { listProjects } from "@/services/studio/projects";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ archived?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const member = await studioMember();
  const client = await getClient(member.orgId, id);
  if (!client) notFound();
  const archived = sp.archived === "1";
  const projects = await listProjects(member.orgId, id, { archived });

  return (
    <>
      <StudioHeader trail={[{ label: client.name }]} />
      <Page>
        <Title sub={client.company ?? undefined}>{client.name}</Title>

        <section aria-labelledby="projects" className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id="projects" className="text-[17px] font-semibold">
              Projects
            </h2>
            <div className="flex items-center gap-4">
              <Link href={archived ? `/studio/clients/${id}` : `/studio/clients/${id}?archived=1`} className="text-[13px] text-fg-3 hover:text-fg">
                {archived ? "Show active" : "Show archived"}
              </Link>
              <NewProjectForm clientId={id} />
            </div>
          </div>
          {projects.length === 0 ? (
            <Empty title="No projects here">A project holds the assets for one campaign, and how many revision rounds the contract includes.</Empty>
          ) : (
            <ul className={`${cardCls} divide-y divide-rule`}>
              {projects.map((p) => (
                <li key={p.id}>
                  <Link href={`/studio/projects/${p.id}`} className="grid grid-cols-1 items-center gap-2 px-4 py-3.5 hover:bg-hover sm:grid-cols-[minmax(0,1fr)_150px_110px_120px]">
                    <span className="min-w-0 truncate text-[14px] font-medium">
                      {p.name}
                      {p.status !== "active" && <span className="ml-2 text-[12px] font-normal text-fg-muted">{p.status === "paused" ? "Paused" : "Delivered"}</span>}
                    </span>
                    <StatusLine status={p.rollup} />
                    <span className="num text-[12.5px] text-fg-muted">{p.dueDate ? `Due ${p.dueDate}` : "No due date"}</span>
                    <span className={`num text-[12.5px] ${p.rounds.over ? "text-attention" : "text-fg-muted"}`}>{p.rounds.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="details" className="flex flex-col gap-4">
          <h2 id="details" className="text-[17px] font-semibold">
            Details
          </h2>
          <ClientEditor client={{ id: client.id, name: client.name, company: client.company, notes: client.notes, contacts: client.contacts, archived: !!client.archivedAt }} />
        </section>
      </Page>
    </>
  );
}
