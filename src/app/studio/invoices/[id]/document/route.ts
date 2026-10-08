import { renderInvoiceHtml } from "@/lib/studio/invoice-html";
import { getInvoice, invoiceDoc } from "@/services/studio/invoices";
import { ownerOrNull } from "@/services/studio/owner-route";

export const dynamic = "force-dynamic";

/**
 * The invoice as a page of its own, to print or save as PDF from the browser (the same HTML
 * `pnpm invoice` turns into a PDF). Chrome names the PDF after the title: "Invoice PD6326".
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await ownerOrNull();
  if (!member) return Response.redirect(new URL("/sign-in", req.url), 303);
  const { id } = await params;
  const row = member.role === "owner" ? await getInvoice(member.orgId, id) : null;
  if (!row) return new Response("Not found", { status: 404 });
  const html = renderInvoiceHtml(await invoiceDoc(member.orgId, row), { toolbar: { backHref: `/studio/invoices/${id}` } });
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      // Everything is inline and escaped; the only script is the Print button.
      "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    },
  });
}
