/**
 * An invoice PDF from a JSON file, without the studio running (plan Phase 0).
 *
 *   pnpm invoice invoices/PD6326.json              → invoices/out/PD6326.pdf
 *   pnpm invoice invoices/PD6326.json --html       also writes the .html next to it
 *   pnpm invoice invoices/PD6326.json --studio x.json
 *
 * The studio's details come from invoices/studio.json (see invoices/studio.example.json). Totals are
 * computed; set "expectTotal" and the script refuses a PDF whose total differs.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";
import { z } from "zod";

import { addDays, computeTotals, DEFAULT_TERMS, type InvoiceDoc, invoiceWarnings, money, parseMoney } from "../src/lib/studio/invoice";
import { renderInvoiceHtml } from "../src/lib/studio/invoice-html";

const amount = z.union([z.number().nonnegative(), z.string()]).transform((v, ctx) => {
  const cents = typeof v === "number" ? Math.round(v * 100) : parseMoney(v);
  if (cents === null) ctx.addIssue({ code: "custom", message: `"${v}" isn't an amount.` });
  return cents ?? 0;
});
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD.");

const studioFile = z.object({
  name: z.string().min(1),
  abn: z.string().nullish(),
  address: z.string().nullish(),
  email: z.string().nullish(),
  website: z.string().nullish(),
  gstRegistered: z.boolean().default(false),
  bank: z.object({ accountName: z.string().nullish(), bsb: z.string().nullish(), accountNo: z.string().nullish() }).default({}),
  payByPost: z.boolean().default(true),
  termsDays: z.number().int().positive().default(30),
  terms: z.string().default(DEFAULT_TERMS),
  /** A PNG, JPEG, WebP or SVG, relative to the studio file. */
  logo: z.string().nullish(),
});

const invoiceFile = z.object({
  number: z.string().min(1),
  issueDate: isoDate,
  dueDate: isoDate.optional(),
  billTo: z.object({ name: z.string().min(1), company: z.string().nullish(), address: z.string().nullish() }),
  lines: z.array(z.object({ description: z.string().min(1), detail: z.string().optional(), qty: z.number().positive(), unitPrice: amount })).min(1),
  discount: z.union([z.object({ amount, label: z.string().optional() }), z.object({ percent: z.number().min(0).max(100), label: z.string().optional() })]).nullish(),
  notes: z.string().default(""),
  expectTotal: amount.optional(),
});

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" };

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--studio");
  if (!file) throw new Error("Usage: pnpm invoice <invoice.json> [--studio studio.json] [--html]");
  const studioPath = args.includes("--studio") ? args[args.indexOf("--studio") + 1]! : path.join(path.dirname(file), "studio.json");

  const s = studioFile.parse(JSON.parse(await readFile(studioPath, "utf8")));
  const inv = invoiceFile.parse(JSON.parse(await readFile(file, "utf8")));

  // Without a "logo" in studio.json, the studio's default logo (the app uses the same file).
  const logoPath = s.logo ? path.resolve(path.dirname(studioPath), s.logo) : path.resolve("src/assets/invoice-logo.png");
  const mime = MIME[path.extname(logoPath).toLowerCase()];
  if (!mime) throw new Error(`The logo must be PNG, JPEG, WebP or SVG: ${logoPath}`);
  const logo = `data:${mime};base64,${(await readFile(logoPath)).toString("base64")}`;

  const doc: InvoiceDoc = {
    number: inv.number,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate ?? addDays(inv.issueDate, s.termsDays),
    billTo: { name: inv.billTo.name, company: inv.billTo.company ?? null, address: inv.billTo.address ?? null },
    lines: inv.lines.map((l) => ({ description: l.description, detail: l.detail, qty: l.qty, unitCents: l.unitPrice })),
    discount: !inv.discount ? null : "percent" in inv.discount ? { kind: "percent", percent: inv.discount.percent, label: inv.discount.label } : { kind: "amount", cents: inv.discount.amount, label: inv.discount.label },
    notes: inv.notes,
    studio: {
      name: s.name,
      abn: s.abn ?? null,
      address: s.address ?? null,
      email: s.email ?? null,
      website: s.website ?? null,
      gstRegistered: s.gstRegistered,
      bankAccountName: s.bank.accountName ?? null,
      bankBsb: s.bank.bsb ?? null,
      bankAccountNo: s.bank.accountNo ?? null,
      payByPost: s.payByPost,
      terms: s.terms,
      logo,
    },
    status: "issued",
  };

  for (const w of invoiceWarnings(doc)) console.warn(`⚠ ${w}`);
  const t = computeTotals(doc.lines, doc.discount, doc.studio.gstRegistered);
  if (inv.expectTotal !== undefined && inv.expectTotal !== t.totalCents) throw new Error(`The total comes to ${money(t.totalCents, true)}, not the expected ${money(inv.expectTotal, true)}. Nothing was written.`);

  const html = renderInvoiceHtml(doc);
  const outDir = path.join(path.dirname(file), "out");
  await mkdir(outDir, { recursive: true });
  const base = path.join(outDir, inv.number.replace(/[^\w.-]/g, "_"));
  if (args.includes("--html")) await writeFile(`${base}.html`, html);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({ path: `${base}.pdf`, format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
  console.log(`${base}.pdf  ·  subtotal ${money(t.subtotalCents)}  discount ${money(t.discountCents)}  GST ${money(t.gstCents)}  total ${money(t.totalCents, true)}`);
}

main().catch((e) => {
  console.error(e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n") : e instanceof Error ? e.message : e);
  process.exit(1);
});
