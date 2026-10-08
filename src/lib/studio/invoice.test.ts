import { describe, expect, it } from "vitest";

import { abnLabel, addDays, computeTotals, DEFAULT_TERMS, type InvoiceDoc, invoiceWarnings, money, parseMoney } from "./invoice";
import { renderInvoiceHtml } from "./invoice-html";

const studio = {
  name: "Photodynamics Photography",
  abn: "78116965476",
  address: "15 Foxall Street\nGrantham Farm NSW 2765",
  email: null,
  website: null,
  gstRegistered: false,
  bankAccountName: null,
  bankBsb: null,
  bankAccountNo: null,
  payByPost: true,
  terms: DEFAULT_TERMS,
  logo: null,
};

/** PD6325 as reissued on 2026-10-08: full-price lines, one discount on the whole invoice. */
const pd6325: InvoiceDoc = {
  number: "PD6325",
  issueDate: "2026-10-08",
  dueDate: "2026-11-07",
  billTo: { name: "Mr Chandana", company: "Kelaniya University Alumni Association", address: null },
  lines: [
    { description: "Backdrop design for print", detail: "4 m × 2.2 m", qty: 1, unitCents: 12000 },
    { description: "TV screen display design", detail: "One design per screen, 3 screens", qty: 3, unitCents: 4000 },
  ],
  discount: { kind: "amount", cents: 11000 },
  notes: "",
  studio,
};

describe("totals", () => {
  it("PD6325: 240.00 − 110.00 = 130.00, no GST", () => {
    const t = computeTotals(pd6325.lines, pd6325.discount, false);
    expect(t.lines.map((l) => l.amountCents)).toEqual([12000, 12000]);
    expect(t).toMatchObject({ subtotalCents: 24000, discountCents: 11000, gstCents: 0, totalCents: 13000 });
  });

  it("takes GST on the discounted subtotal when registered", () => {
    const t = computeTotals(pd6325.lines, { kind: "percent", percent: 25 }, true);
    expect(t).toMatchObject({ subtotalCents: 24000, discountCents: 6000, gstCents: 1800, totalCents: 19800 });
  });

  it("rounds fractional quantities to the cent", () => {
    expect(computeTotals([{ description: "Editing", qty: 1.5, unitCents: 3333 }], null, false).totalCents).toBe(5000);
  });

  it("refuses what can't be right", () => {
    expect(() => computeTotals([{ description: " ", qty: 1, unitCents: 1 }], null, false)).toThrow(/description/);
    expect(() => computeTotals([{ description: "A", qty: 0, unitCents: 1 }], null, false)).toThrow(/quantity/);
    expect(() => computeTotals([{ description: "A", qty: 1, unitCents: 100 }], { kind: "amount", cents: 101 }, false)).toThrow(/more than the subtotal/);
    expect(() => computeTotals([{ description: "A", qty: 1, unitCents: 100 }], { kind: "percent", percent: 120 }, false)).toThrow(/between 0 and 100/);
  });
});

describe("warnings", () => {
  it("catches a count in the description that disagrees with the quantity", () => {
    const w = invoiceWarnings({ ...pd6325, lines: [{ description: "4x TV screen display designs", qty: 3, unitCents: 4000 }] });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/4× but the quantity is 3/);
    expect(invoiceWarnings({ ...pd6325, lines: [{ description: "3 x TV screens", qty: 3, unitCents: 4000 }] })).toEqual([]);
  });

  it("asks for an ABN and a way to pay", () => {
    const w = invoiceWarnings({ ...pd6325, studio: { ...studio, abn: null, payByPost: false } });
    expect(w.join(" ")).toMatch(/ABN/);
    expect(w.join(" ")).toMatch(/way to pay/);
  });
});

describe("formatting", () => {
  it("parses and prints money", () => {
    expect(parseMoney("$1,234.5")).toBe(123450);
    expect(parseMoney("40")).toBe(4000);
    expect(parseMoney("4.005")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(money(123450, true)).toBe("$1,234.50");
    expect(money(-11000)).toBe("−110.00");
  });

  it("dates and ABNs", () => {
    expect(addDays("2026-10-08", 30)).toBe("2026-11-07");
    expect(addDays("2026-12-20", 30)).toBe("2027-01-19");
    expect(abnLabel("78116965476")).toBe("78 116 965 476");
  });
});

describe("html", () => {
  it("renders an Invoice (not a Tax Invoice) when not registered, with one discount row", () => {
    const html = renderInvoiceHtml(pd6325);
    expect(html).toContain("<h1>Invoice</h1>");
    expect(html).not.toContain("GST 10%");
    expect(html).toContain("No GST has been charged.");
    expect(html).toContain("−110.00");
    expect(html).toContain("$130.00");
    expect(html).toContain("ABN 78 116 965 476");
    expect(html).toContain("15 Foxall Street<br>Grantham Farm NSW 2765");
    expect(html).not.toMatch(/Bank transfer/);
  });

  it("renders a Tax Invoice with GST when registered, and bank details when set", () => {
    const html = renderInvoiceHtml({ ...pd6325, studio: { ...studio, gstRegistered: true, bankBsb: "062-000", bankAccountNo: "1234 5678" } });
    expect(html).toContain("<h1>Tax Invoice</h1>");
    expect(html).toContain("GST 10%");
    expect(html).toContain("BSB 062-000, account 1234 5678");
  });

  it("escapes what people type, and ignores a logo that isn't an image data URL", () => {
    const html = renderInvoiceHtml({
      ...pd6325,
      billTo: { name: "<script>alert(1)</script>", company: null, address: null },
      studio: { ...studio, logo: 'javascript:alert(1)"' },
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
  });

  it("stamps drafts", () => {
    expect(renderInvoiceHtml({ ...pd6325, number: null, status: "draft" })).toContain(">DRAFT<");
  });
});
