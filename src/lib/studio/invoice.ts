/**
 * Invoices: the totals and the rules (planning/2026-10-08-invoices/plan.md). Pure, so the studio,
 * the preview in the browser and `pnpm invoice` all compute the same numbers.
 *
 * Money is integer cents. Lines are always at full price; the only discount is one row on the
 * whole invoice. GST is 10% of the discounted subtotal, and only when the studio is registered.
 */

export const GST_RATE = 0.1;
export const CURRENCY = "AUD";

export type InvoiceLine = { description: string; detail?: string; qty: number; unitCents: number };
export type InvoiceDiscount = { kind: "amount"; cents: number; label?: string } | { kind: "percent"; percent: number; label?: string } | null;

export type InvoiceTotals = {
  lines: (InvoiceLine & { amountCents: number })[];
  subtotalCents: number;
  discountCents: number;
  gstCents: number;
  totalCents: number;
};

/** What an invoice needs from the studio. Issued invoices keep a copy, so a later change (a new address) leaves them as sent. */
export type InvoiceStudio = {
  name: string;
  abn: string | null;
  address: string | null;
  email: string | null;
  website: string | null;
  gstRegistered: boolean;
  bankAccountName: string | null;
  bankBsb: string | null;
  bankAccountNo: string | null;
  payByPost: boolean;
  terms: string;
  /** A data: URL (PNG, JPEG, WebP or SVG), or null for the studio name in text. */
  logo: string | null;
};

export type InvoiceBillTo = { name: string; company: string | null; address: string | null };

export type InvoiceDoc = {
  number: string | null;
  issueDate: string;
  dueDate: string;
  billTo: InvoiceBillTo;
  lines: InvoiceLine[];
  discount: InvoiceDiscount;
  notes: string;
  studio: InvoiceStudio;
  status?: "draft" | "issued" | "paid" | "void";
};

export class InvoiceError extends Error {}

export const DEFAULT_TERMS =
  "Payment is due within 30 days of the invoice date. Interest may be charged on invoices unpaid after 30 days at the greater of 8% p.a. or 4% above our bank's rate. Please raise any queries within 7 days.";

const round = (n: number) => Math.round(n + Number.EPSILON * Math.sign(n));

export function lineAmount(l: InvoiceLine): number {
  return round(l.qty * l.unitCents);
}

export function computeTotals(lines: InvoiceLine[], discount: InvoiceDiscount, gstRegistered: boolean): InvoiceTotals {
  for (const l of lines) {
    if (!l.description.trim()) throw new InvoiceError("Every line needs a description.");
    if (!(l.qty > 0)) throw new InvoiceError(`"${l.description}": the quantity must be more than 0.`);
    if (!Number.isInteger(l.unitCents) || l.unitCents < 0) throw new InvoiceError(`"${l.description}": the unit price must be 0 or more.`);
  }
  const withAmounts = lines.map((l) => ({ ...l, amountCents: lineAmount(l) }));
  const subtotalCents = withAmounts.reduce((s, l) => s + l.amountCents, 0);
  let discountCents = 0;
  if (discount?.kind === "amount") discountCents = discount.cents;
  if (discount?.kind === "percent") {
    if (!(discount.percent >= 0 && discount.percent <= 100)) throw new InvoiceError("A percentage discount must be between 0 and 100.");
    discountCents = round((subtotalCents * discount.percent) / 100);
  }
  if (!Number.isInteger(discountCents) || discountCents < 0) throw new InvoiceError("The discount must be 0 or more.");
  if (discountCents > subtotalCents) throw new InvoiceError("The discount is more than the subtotal.");
  const net = subtotalCents - discountCents;
  const gstCents = gstRegistered ? round(net * GST_RATE) : 0;
  return { lines: withAmounts, subtotalCents, discountCents, gstCents, totalCents: net + gstCents };
}

/**
 * Things that are allowed but probably wrong, shown before issuing. The one that started this:
 * "4x TV screen display designs" with a quantity of 3.
 */
export function invoiceWarnings(doc: Pick<InvoiceDoc, "lines" | "studio" | "billTo">): string[] {
  const out: string[] = [];
  for (const l of doc.lines) {
    const m = /(?:^|\s)(\d+)\s*[x×]\s/i.exec(l.description + " ");
    if (m && Number(m[1]) !== l.qty) out.push(`"${l.description}" says ${m[1]}× but the quantity is ${l.qty}. Put the count in the quantity only.`);
  }
  if (!doc.studio.abn) out.push("No ABN is set (Settings → Invoicing). Australian invoices should show one.");
  if (!doc.studio.address) out.push("No studio address is set (Settings → Invoicing).");
  if (!doc.studio.bankBsb && !doc.studio.payByPost) out.push("No way to pay is shown: add bank details or turn on payment by post.");
  if (!doc.billTo.name.trim()) out.push("The invoice has no one to bill.");
  return out;
}

/** "1234.5" or "$1,234.50" → cents. Null when it isn't a money amount. */
export function parseMoney(s: string): number | null {
  const t = s.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return round(Number(t) * 100);
}

export function money(cents: number, symbol = false): string {
  const s = (Math.abs(cents) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? "−" : ""}${symbol ? "$" : ""}${s}`;
}

export function qtyLabel(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/0$/, "");
}

/** YYYY-MM-DD plus whole days, in UTC so a timezone never shifts the date. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** "78116965476" → "78 116 965 476". Anything that isn't 11 digits is left as typed. */
export function abnLabel(abn: string): string {
  const d = abn.replace(/\s/g, "");
  return /^\d{11}$/.test(d) ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : abn;
}

const LOGO_RE = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
export const isLogoDataUrl = (s: string) => LOGO_RE.test(s);
