import Link from "next/link";

import { NewAssetForm } from "@/components/studio/AssetForms";
import { NewInvoiceForm } from "@/components/studio/InvoiceForms";
import { quietBtn } from "@/components/studio/kit";

/** The header actions on a project: invoice it (owner), make a review link (once something is uploaded), add an asset. */
export function ProjectActions({ projectId, canShare, invoiceFor }: { projectId: string; canShare: boolean; invoiceFor?: string }) {
  return (
    <div className="flex items-start gap-2">
      {invoiceFor && <NewInvoiceForm clientId={invoiceFor} projectId={projectId} kind="quiet" />}
      {canShare && (
        <Link href={`/studio/projects/${projectId}/share`} className={quietBtn}>
          New review link
        </Link>
      )}
      <NewAssetForm projectId={projectId} />
    </div>
  );
}
