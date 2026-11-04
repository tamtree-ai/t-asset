import type { InvoiceRow } from "@/services/studio/invoices";

type Status = InvoiceRow["status"];

const LABEL: Record<Status, string> = { draft: "Draft", issued: "Unpaid", paid: "Paid", void: "Void" };

/** A dot and a word, like the review statuses. Green is Paid; amber is overdue. */
export function InvoiceStatusLine({ status, overdue = false }: { status: Status; overdue?: boolean }) {
  const dot = status === "paid" ? "bg-ready" : overdue ? "bg-attention" : status === "issued" ? "bg-fg-3" : "bg-line-strong";
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-2">
      <span aria-hidden className={`size-2 rounded-full ${dot}`} />
      {overdue && <span aria-hidden className="text-attention">▲</span>}
      {overdue ? "Overdue" : LABEL[status]}
    </span>
  );
}
