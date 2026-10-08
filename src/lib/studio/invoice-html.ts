/**
 * The invoice as one self-contained A4 HTML page (the PD6325 layout). The studio's printable page,
 * its live preview and `pnpm invoice` all render this, so a PDF looks the same wherever it was made.
 */
import { abnLabel, computeTotals, type InvoiceDoc, isLogoDataUrl, longDate, money, qtyLabel } from "./invoice";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const lines = (s: string) => esc(s.trim()).replace(/\r?\n/g, "<br>");

const CSS = `
@page{size:A4;margin:0}
*{box-sizing:border-box}
html{background:#e9e8e4}
body{margin:0;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;color:#222;font-size:10pt;line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:20mm 18mm 16mm;position:relative;display:flex;flex-direction:column}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:10mm}
.logo{max-width:62mm;max-height:22mm}
.wordmark{font-size:18pt;font-weight:300;letter-spacing:.5px}
.from{text-align:right;font-size:9pt;color:#555}
.from b{color:#222;font-size:10pt}
h1{font-weight:300;font-size:26pt;letter-spacing:.5px;margin:16mm 0 8mm}
.meta{display:flex;justify-content:space-between;gap:10mm;margin-bottom:10mm}
.label{font-size:7.5pt;text-transform:uppercase;letter-spacing:1.2px;color:#888;margin-bottom:2px}
.meta table{border-collapse:collapse}.meta td{padding:1px 0;vertical-align:top}.meta td:first-child{color:#888;padding-right:8mm}
table.items{width:100%;border-collapse:collapse}
.items th{font-size:7.5pt;text-transform:uppercase;letter-spacing:1.2px;color:#888;font-weight:600;text-align:left;padding:0 0 6px;border-bottom:1.5px solid #222}
.items td{padding:9px 0;border-bottom:1px solid #e3e3e3;vertical-align:top}
.items tr{break-inside:avoid}
.num{text-align:right!important;font-variant-numeric:tabular-nums;white-space:nowrap;padding-left:6mm!important}
.desc small{display:block;color:#888;font-size:8.5pt}
.totals{width:78mm;margin:6mm 0 0 auto;border-collapse:collapse}
.totals td{padding:4px 0}.totals td:first-child{color:#555}
.totals tr.disc td{color:#2a7a3b}
.totals tr.due td{border-top:1.5px solid #222;padding-top:8px;font-weight:700;font-size:12pt;color:#222}
.dueby{text-align:right;margin-top:3mm;color:#555}
.notes{margin-top:10mm;color:#444;max-width:120mm}
.spacer{flex:1;min-height:12mm}
.foot{font-size:8pt;color:#666;border-top:1px solid #e3e3e3;padding-top:5mm;display:flex;gap:12mm;break-inside:avoid}
.foot>div{flex:1}.foot b{color:#222}
.stamp{position:absolute;top:58mm;right:18mm;border:2px solid currentColor;border-radius:4px;padding:2px 10px;font-weight:700;letter-spacing:3px;font-size:13pt;transform:rotate(-6deg)}
.stamp.draft{color:#b8b8b8}.stamp.paid{color:#2a7a3b}.stamp.void{color:#b42318}
.bar{position:sticky;top:0;z-index:1;display:flex;justify-content:center;gap:10px;padding:10px;background:#e9e8e4;font:13px system-ui,sans-serif}
.bar a,.bar button{font:inherit;padding:7px 14px;border-radius:8px;border:1px solid #c9c7c1;background:#fff;color:#222;text-decoration:none;cursor:pointer}
.bar button{background:#18181b;color:#fff;border-color:#18181b;font-weight:600}
@media print{html{background:#fff}.bar{display:none}.page{margin:0}}
`;

export type RenderOpts = {
  /** The studio's printable page: a bar with Back and Print, hidden when printing. */
  toolbar?: { backHref: string };
};

export function renderInvoiceHtml(doc: InvoiceDoc, opts: RenderOpts = {}): string {
  const s = doc.studio;
  const t = computeTotals(doc.lines, doc.discount, s.gstRegistered);
  const title = s.gstRegistered ? "Tax Invoice" : "Invoice";
  const docTitle = `${title} ${doc.number ?? "(draft)"}`;
  const status = doc.status ?? "issued";
  const stamp = status === "draft" ? "DRAFT" : status === "paid" ? "PAID" : status === "void" ? "VOID" : null;

  const from = [
    `<b>${esc(s.name)}</b>`,
    s.abn ? `ABN ${esc(abnLabel(s.abn))}` : "",
    s.address ? lines(s.address) : "",
    s.email ? esc(s.email) : "",
    s.website ? esc(s.website.replace(/^https?:\/\//, "")) : "",
  ].filter(Boolean);

  const billTo = [`<b>${esc(doc.billTo.name)}</b>`, doc.billTo.company ? esc(doc.billTo.company) : "", doc.billTo.address ? lines(doc.billTo.address) : ""].filter(Boolean);

  const rows = t.lines
    .map(
      (l) =>
        `<tr><td class="desc">${esc(l.description)}${l.detail?.trim() ? `<small>${esc(l.detail)}</small>` : ""}</td><td class="num">${qtyLabel(l.qty)}</td><td class="num">${money(l.unitCents)}</td><td class="num">${money(l.amountCents)}</td></tr>`,
    )
    .join("");

  const discountLabel = doc.discount?.label?.trim() || "Discount";
  const discountPct = doc.discount?.kind === "percent" ? ` (${qtyLabel(doc.discount.percent)}%)` : "";
  const totals = [
    `<tr><td>Subtotal</td><td class="num">${money(t.subtotalCents)}</td></tr>`,
    t.discountCents > 0 ? `<tr class="disc"><td>${esc(discountLabel)}${discountPct}</td><td class="num">${money(-t.discountCents)}</td></tr>` : "",
    s.gstRegistered ? `<tr><td>GST 10%</td><td class="num">${money(t.gstCents)}</td></tr>` : "",
    `<tr class="due"><td>Total due (AUD)</td><td class="num">${money(t.totalCents, true)}</td></tr>`,
  ].join("");

  const ref = doc.number ? `Please use invoice number ${esc(doc.number)} as the reference.` : "Please use the invoice number as the reference.";
  const bank = s.bankBsb && s.bankAccountNo ? `Bank transfer: ${esc(s.bankAccountName ?? s.name)}, BSB ${esc(s.bankBsb)}, account ${esc(s.bankAccountNo)}.` : "";
  const post = s.payByPost && s.address ? `By post: ${esc(s.name)}, ${esc(s.address.trim().replace(/\s*\r?\n\s*/g, ", "))}.` : "";
  const pay = [ref, bank, post].filter(Boolean).join("<br>");
  const terms = [esc(s.terms), s.gstRegistered ? "" : "No GST has been charged."].filter(Boolean).join(" ");

  const logo = s.logo && isLogoDataUrl(s.logo) ? `<img class="logo" src="${s.logo}" alt="${esc(s.name)}">` : `<div class="wordmark">${esc(s.name)}</div>`;
  const bar = opts.toolbar ? `<div class="bar"><a href="${esc(opts.toolbar.backHref)}">← Back</a><button type="button" onclick="window.print()">Print or save as PDF</button></div>` : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(docTitle)}</title><style>${CSS}</style></head><body>${bar}<div class="page">
${stamp ? `<div class="stamp ${status}">${stamp}</div>` : ""}
<div class="top">${logo}<div class="from">${from.join("<br>")}</div></div>
<h1>${title}</h1>
<div class="meta"><div><div class="label">Bill to</div>${billTo.join("<br>")}</div>
<table><tr><td>Invoice no.</td><td><b>${doc.number ? esc(doc.number) : "Draft"}</b></td></tr><tr><td>Invoice date</td><td>${longDate(doc.issueDate)}</td></tr><tr><td>Due date</td><td>${longDate(doc.dueDate)}</td></tr></table></div>
<table class="items"><thead><tr><th style="width:58%">Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table class="totals">${totals}</table>
<div class="dueby">Please pay by <b>${longDate(doc.dueDate)}</b></div>
${doc.notes.trim() ? `<div class="notes">${lines(doc.notes)}</div>` : ""}
<div class="spacer"></div>
<div class="foot"><div><b>How to pay</b><br>${pay}</div><div><b>Terms</b><br>${terms}</div></div>
</div></body></html>`;
}
