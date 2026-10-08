import Link from "next/link";
import { notFound } from "next/navigation";

import { InvoiceEditor, InvoicePreview, IssuedInvoiceActions } from "@/components/studio/InvoiceForms";
import { InvoiceStatusLine } from "@/components/studio/InvoiceStatus";
import { Page, Title } from "@/components/studio/kit";
import { StudioHeader } from "@/components/studio/StudioHeader";
import { getCurrentMember } from "@/lib/auth";
import { longDate, money } from "@/lib/studio/invoice";
import { renderInvoiceHtml } from "@/lib/studio/invoice-html";
import { getClient } from "@/services/studio/clients";
import { getInvoice, getInvoiceSettings, invoiceDoc, today } from "@/services/studio/invoices";
import { listProjects } from "@/services/studio/projects";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await getCurrentMember();
  if (member.role !== "owner") notFound();
  const row = await getInvoice(member.orgId, id);
  if (!row) notFound();
  const [doc, client] = await Promise.all([invoiceDoc(member.orgId, row), getClient(member.orgId, row.clientId)]);
  const trail = [{ label: "Invoices", href: "/studio/invoices" }, { label: row.number ?? "Draft" }];

  if (row.status === "draft") {
    const [projects, settings] = await Promise.all([listProjects(member.orgId, row.clientId), getInvoiceSettings(member.orgId)]);
    return (
      <>
        <StudioHeader trail={trail} />
        <Page wide>
          <Title
            sub={
              <>
                Draft for{" "}
                <Link href={`/studio/clients/${row.clientId}`} className="underline hover:text-fg">
                  {client?.name}
                </Link>
                {!client?.billingAddress && " · no billing address on the client (optional)"}
              </>
            }
          >
            New invoice
          </Title>
          <InvoiceEditor
            draft={{ id: row.id, projectId: row.projectId, issueDate: row.issueDate, dueDate: row.dueDate, lines: row.lines, discount: row.discount, notes: row.notes }}
            studio={doc.studio}
            billTo={doc.billTo}
            projects={projects.map((p) => ({ id: p.id, name: p.name }))}
            termsDays={settings.paymentTermsDays}
          />
        </Page>
      </>
    );
  }

  const status = row.status as "issued" | "paid" | "void";
  const overdue = status === "issued" && row.dueDate < today();
  return (
    <>
      <StudioHeader trail={trail} />
      <Page wide>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Title
            sub={
              <span className="inline-flex flex-wrap items-center gap-x-2">
                <InvoiceStatusLine status={status} overdue={overdue} /> · {client?.name} · {money(row.totalCents, true)} · due {longDate(row.dueDate)}
                {row.paidAt && <> · paid {longDate(row.paidAt.toISOString().slice(0, 10))}</>}
              </span>
            }
          >
            {row.number}
          </Title>
          <IssuedInvoiceActions id={row.id} status={status} />
        </div>
        <div className="mx-auto w-full max-w-[640px]">
          <InvoicePreview html={renderInvoiceHtml(doc)} title={`Invoice ${row.number}`} />
        </div>
      </Page>
    </>
  );
}
