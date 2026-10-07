import Link from "next/link";

import { ClientsEmpty } from "@/components/studio/ClientsEmpty";
import { NewClientForm } from "@/components/studio/ClientForms";
import { ago, cardCls, Page, Title } from "@/components/studio/kit";
import { StudioHeader } from "@/components/studio/StudioHeader";
import { studioMember } from "@/lib/studio/member";
import { listClients } from "@/services/studio/clients";

export const dynamic = "force-dynamic";

/** Clients: who is waiting on whom, at a glance (plan §4.2). */
export default async function StudioHome({ searchParams }: { searchParams: Promise<{ q?: string; archived?: string }> }) {
  const sp = await searchParams;
  const member = await studioMember();
  const archived = sp.archived === "1";
  const clients = await listClients(member.orgId, { q: sp.q, archived });
  const none = clients.length === 0 && !sp.q && !archived;

  return (
    <>
      <StudioHeader trail={[]} />
      <Page wide>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Title sub="Share work, collect comments pinned to the exact spot, and get a clear approval.">Clients</Title>
          <NewClientForm />
        </div>

        {none ? (
          <ClientsEmpty />
        ) : (
          <>
            <form className="flex flex-wrap items-center gap-3" role="search">
              <input name="q" defaultValue={sp.q ?? ""} aria-label="Search clients" placeholder="Search clients" className="h-9 w-64 rounded-lg border border-line bg-canvas px-2.5 text-[13px]" />
              {archived && <input type="hidden" name="archived" value="1" />}
              <button type="submit" className="h-9 rounded-lg border border-line px-3 text-[13px] text-fg-2 hover:bg-hover">
                Search
              </button>
              <Link href={archived ? "/studio" : "/studio?archived=1"} className="text-[13px] text-fg-3 hover:text-fg">
                {archived ? "Show active" : "Show archived"}
              </Link>
            </form>

            {clients.length === 0 ? (
              <p className="text-[13.5px] text-fg-muted">No clients match.</p>
            ) : (
              <div className={`${cardCls} overflow-x-auto`}>
                <table className="w-full min-w-[640px] text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-rule text-[11px] uppercase tracking-[0.06em] text-fg-muted">
                      <th className="px-4 py-3 font-semibold">Client</th>
                      <th className="px-4 py-3 font-semibold">Active projects</th>
                      <th className="px-4 py-3 font-semibold">Waiting on client</th>
                      <th className="px-4 py-3 font-semibold">Waiting on me</th>
                      <th className="px-4 py-3 font-semibold">Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((c) => (
                      <tr key={c.id} className="border-b border-rule last:border-0 hover:bg-hover">
                        <td className="px-4 py-3">
                          <Link href={`/studio/clients/${c.id}`} className="font-medium text-fg hover:underline">
                            {c.name}
                          </Link>
                          {c.company && <span className="ml-2 text-fg-muted">{c.company}</span>}
                        </td>
                        <td className="num px-4 py-3 text-fg-2">{c.activeProjects}</td>
                        <td className="num px-4 py-3 text-fg-2">{c.waitingOnClient}</td>
                        <td className={`num px-4 py-3 ${c.waitingOnMe > 0 ? "text-attention" : "text-fg-2"}`}>{c.waitingOnMe > 0 ? `▲ ${c.waitingOnMe}` : 0}</td>
                        <td className="px-4 py-3 text-fg-muted">{ago(c.lastActivity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Page>
    </>
  );
}
