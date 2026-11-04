import Link from "next/link";

import { Page, Title } from "@/components/studio/kit";
import { StudioHeader } from "@/components/studio/StudioHeader";
import { getCurrentMember } from "@/lib/auth";
import { defaultInvoiceLogo } from "@/services/studio/default-logo";
import { getInvoiceSettings } from "@/services/studio/invoices";

import { InvoicingForm } from "./InvoicingForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoicing" };

/** What every invoice says about the studio: name, ABN, address, how to pay, terms, numbering. */
export default async function InvoicingSettingsPage() {
  const member = await getCurrentMember();
  if (member.role !== "owner") {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <p className="text-[14px] text-fg-muted">Invoicing stays with the workspace owner.</p>
      </main>
    );
  }
  const s = await getInvoiceSettings(member.orgId);
  return (
    <>
      <StudioHeader trail={[{ label: "Invoices", href: "/studio/invoices" }, { label: "Settings" }]} />
      <Page>
        <Title
          sub={
            <>
              Drafts use these as they are now. An issued invoice keeps the details it was issued with. The studio name and email come from{" "}
              <Link href="/settings/brand" className="underline hover:text-fg">
                Brand
              </Link>
              .
            </>
          }
        >
          Invoicing
        </Title>
        <InvoicingForm initial={s} defaultLogo={defaultInvoiceLogo()} />
      </Page>
    </>
  );
}
