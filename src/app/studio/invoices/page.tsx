import Link from "next/link";

import { NewInvoiceForm } from "@/components/studio/InvoiceForms";
import { InvoiceStatusLine } from "@/components/studio/InvoiceStatus";
import { cardCls, Empty, Page, Title } from "@/components/studio/kit";
import { StudioHeader } from "@/components/studio/StudioHeader";
import { getCurrentMember } from "@/lib/auth";
import { longDate, money } from "@/lib/studio/invoice";
import { invoicePickers, type InvoiceStatus, listInvoices } from "@/services/studio/invoices";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoices" };

const FILTERS: { key: InvoiceStatus | "overdue" | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "issued", label: "Unpaid" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
];


/** Invoices (planning/2026-10-08-invoices): drafts first, then newest. */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const member = await getCurrentMember();
  if (member.role !== "owner") {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <p className="text-[14px] text-fg-muted">Invoices stay with the workspace owner.</p>
      </main>
    );
  }
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.key === sp.status)?.key ?? "all";
  const [rows, { clients, projects }] = await Promise.all([listInvoices(member.orgId, filter === "all" ? {} : { status: filter }), invoicePickers(member.orgId)]);
  const unpaid = rows.filter((r) => r.status === "issued");

  return (
    <>
      <StudioHeader trail={[{ label: "Invoices" }]} />
      <Page wide>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Title sub={<>Full-price lines, one discount on the whole invoice, numbered when issued. <Link href="/settings/invoicing" className="underline hover:text-fg">Invoicing settings</Link></>}>Invoices</Title>
          <NewInvoiceForm clients={clients} projects={projects} />
        </div>

        <nav aria-label="Filter invoices" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Link key={f.key} href={f.key === "all" ? "/studio/invoices" : `/studio/invoices?status=${f.key}`} aria-current={f.key === filter ? "page" : undefined} className={`rounded-md px-2.5 py-1 text-[13px] ${f.key === filter ? "bg-hover text-fg" : "text-fg-3 hover:text-fg"}`}>
              {f.label}
            </Link>
          ))}
          {filter === "all" && unpaid.length > 0 && <span className="ml-auto self-center text-[12.5px] text-fg-muted">Unpaid: {money(unpaid.reduce((s, r) => s + r.totalCents, 0), true)}</span>}
        </nav>

        {rows.length === 0 ? (
          <Empty title={filter === "all" ? "No invoices yet" : "Nothing here"}>{filter === "all" ? "Start one for a client. It stays a draft, with no number, until you issue it." : null}</Empty>
        ) : (
          <div className={`${cardCls} overflow-x-auto`}>
            <table className="w-full min-w-[680px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-rule text-[11px] uppercase tracking-[0.06em] text-fg-muted">
                  <th className="px-4 py-3 font-semibold">Number</th>
                  <th className="px-4 py-3 font-semibold">Client</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Due</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-rule last:border-0 hover:bg-hover">
                    <td className="px-4 py-3">
                      <Link href={`/studio/invoices/${r.id}`} className="font-medium text-fg hover:underline">
                        {r.number ?? "Draft"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-fg-2">
                      {r.clientName}
                      {r.projectName && <span className="ml-2 text-fg-muted">{r.projectName}</span>}
                    </td>
                    <td className="num px-4 py-3 text-fg-muted">{longDate(r.issueDate)}</td>
                    <td className={`num px-4 py-3 ${r.overdue ? "text-attention" : "text-fg-muted"}`}>{r.overdue ? `▲ ${longDate(r.dueDate)}` : longDate(r.dueDate)}</td>
                    <td className="px-4 py-3">
                      <InvoiceStatusLine status={r.status} overdue={r.overdue} />
                    </td>
                    <td className={`num px-4 py-3 text-right ${r.status === "void" ? "text-fg-muted line-through" : ""}`}>{money(r.totalCents, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Page>
    </>
  );
}
