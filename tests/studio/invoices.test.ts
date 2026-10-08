/** Invoices: drafts, numbering under a lock, the frozen snapshot, and org scoping. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { type Ctx, setup } from "./helpers";

vi.mock("server-only", () => ({}));

let c: Ctx;
let a: Awaited<ReturnType<Ctx["org"]>>;
let b: Awaited<ReturnType<Ctx["org"]>>;
let inv: typeof import("@/services/studio/invoices");
let clients: typeof import("@/services/studio/clients");

const PD6325 = {
  projectId: null,
  issueDate: "2026-10-08",
  dueDate: "2026-11-07",
  lines: [
    { description: "Backdrop design for print", detail: "4 m × 2.2 m", qty: 1, unitCents: 12000 },
    { description: "TV screen display design", qty: 3, unitCents: 4000 },
  ],
  discount: { kind: "amount" as const, cents: 11000 },
  notes: "",
};

const settings = (over: Record<string, unknown> = {}) => ({
  legalName: "Photodynamics Photography",
  abn: "78 116 965 476",
  address: "15 Foxall Street\nGrantham Farm NSW 2765",
  gstRegistered: false,
  paymentTermsDays: 30,
  invoiceTerms: "",
  bankAccountName: "",
  bankBsb: "",
  bankAccountNo: "",
  payByPost: true,
  invoicePrefix: "PD",
  nextInvoiceNo: 6325,
  invoiceLogo: null,
  ...over,
});

beforeAll(async () => {
  c = await setup("invoices");
  a = await c.org("a");
  b = await c.org("b");
  inv = await import("@/services/studio/invoices");
  clients = await import("@/services/studio/clients");
});
afterAll(async () => c.cleanup());

describe("settings", () => {
  it("validates and normalises", async () => {
    await expect(inv.saveInvoiceSettings(a.orgId, settings({ abn: "123" }))).rejects.toThrow(/11 digits/);
    await expect(inv.saveInvoiceSettings(a.orgId, settings({ bankBsb: "062000" }))).rejects.toThrow(/account number/);
    await expect(inv.saveInvoiceSettings(a.orgId, settings({ invoiceLogo: "data:text/html;base64,PGI+" }))).rejects.toThrow(/logo/);
    const s = await inv.saveInvoiceSettings(a.orgId, settings({ bankBsb: "062000", bankAccountNo: "1234 5678" }));
    expect(s).toMatchObject({ abn: "78116965476", bankBsb: "062-000", nextInvoiceNo: 6325 });
    expect(s.invoiceTerms).toMatch(/30 days/); // blank means the standard terms
    // The brand itself is untouched.
    const [row] = await c.db.select().from(c.schema.studioBrand).where(eq(c.schema.studioBrand.orgId, a.orgId));
    expect(row!.studioName).toBe("Studio a");
  });
});

describe("drafts and issuing", () => {
  it("PD6325: draft, edit, issue with the next number and a frozen copy", async () => {
    await inv.saveInvoiceSettings(a.orgId, settings());
    const client = await clients.createClient(a.orgId, { name: "Mr Chandana", company: "Kelaniya University Alumni Association" });
    const draft = await inv.createInvoice(a.orgId, { clientId: client.id });
    expect(draft).toMatchObject({ status: "draft", number: null });
    expect(draft.dueDate > draft.issueDate).toBe(true);

    const saved = await inv.updateDraft(a.orgId, draft.id, PD6325);
    expect(saved.totalCents).toBe(13000);

    const issued = await inv.issueInvoice(a.orgId, draft.id, "Owner a");
    expect(issued).toMatchObject({ status: "issued", number: "PD6325", totalCents: 13000 });
    expect(issued.snapshot!.studio.address).toBe("15 Foxall Street\nGrantham Farm NSW 2765");
    expect(issued.snapshot!.billTo.company).toBe("Kelaniya University Alumni Association");

    // A later move leaves the issued invoice as sent, and a draft follows the new address.
    await inv.saveInvoiceSettings(a.orgId, settings({ address: "1 New Road\nSydney NSW 2000", nextInvoiceNo: 6326 }));
    expect((await inv.invoiceDoc(a.orgId, (await inv.getInvoice(a.orgId, draft.id))!)).studio.address).toMatch(/Foxall/);
    const next = await inv.createInvoice(a.orgId, { clientId: client.id });
    expect((await inv.invoiceDoc(a.orgId, next)).studio.address).toMatch(/New Road/);

    // Issued is locked.
    await expect(inv.updateDraft(a.orgId, draft.id, PD6325)).rejects.toThrow(/can't be changed/);
    await expect(inv.issueInvoice(a.orgId, draft.id, "Owner a")).rejects.toThrow(/already issued/);
    await expect(inv.deleteDraft(a.orgId, draft.id)).rejects.toThrow(/can't be changed/);

    // Numbers keep going, and skip one already taken.
    await inv.updateDraft(a.orgId, next.id, PD6325);
    await inv.saveInvoiceSettings(a.orgId, settings({ nextInvoiceNo: 6325 }));
    expect((await inv.issueInvoice(a.orgId, next.id, "Owner a")).number).toBe("PD6326");
    expect((await inv.getInvoiceSettings(a.orgId)).nextInvoiceNo).toBe(6327);

    // A client with invoices can't be deleted.
    await expect(clients.deleteClient(a.orgId, client.id)).rejects.toThrow(/Archive the client instead/);
  });

  it("refuses an empty invoice, a discount over the subtotal, a due date before the issue date", async () => {
    const client = await clients.createClient(a.orgId, { name: "Edge Co" });
    const d = await inv.createInvoice(a.orgId, { clientId: client.id });
    await expect(inv.issueInvoice(a.orgId, d.id, "x")).rejects.toThrow(/at least one line/);
    await expect(inv.updateDraft(a.orgId, d.id, { ...PD6325, discount: { kind: "amount", cents: 99999 } })).rejects.toThrow(/more than the subtotal/);
    await expect(inv.updateDraft(a.orgId, d.id, { ...PD6325, dueDate: "2026-10-01" })).rejects.toThrow(/before the invoice date/);
    await inv.deleteDraft(a.orgId, d.id);
    expect(await inv.getInvoice(a.orgId, d.id)).toBeNull();
  });

  it("adds GST when registered, frozen at issue", async () => {
    const client = await clients.createClient(a.orgId, { name: "GST Co" });
    await inv.saveInvoiceSettings(a.orgId, settings({ gstRegistered: true, nextInvoiceNo: 7000 }));
    const d = await inv.createInvoice(a.orgId, { clientId: client.id });
    expect((await inv.updateDraft(a.orgId, d.id, PD6325)).totalCents).toBe(14300);
    const issued = await inv.issueInvoice(a.orgId, d.id, "x");
    await inv.saveInvoiceSettings(a.orgId, settings({ gstRegistered: false, nextInvoiceNo: 7001 }));
    const doc = await inv.invoiceDoc(a.orgId, issued);
    expect(doc.studio.gstRegistered).toBe(true);
  });

  it("paid, unpaid, void, duplicate and the list", async () => {
    const client = await clients.createClient(a.orgId, { name: "Flow Co" });
    const t = await c.tree(a.orgId, "image", { client: "Other" });
    const d = await inv.createInvoice(a.orgId, { clientId: client.id });
    await expect(inv.updateDraft(a.orgId, d.id, { ...PD6325, projectId: t.projectId })).rejects.toThrow(/isn't one of this client's/);
    await inv.updateDraft(a.orgId, d.id, { ...PD6325, issueDate: "2020-01-01", dueDate: "2020-01-31" });
    await expect(inv.setInvoicePaid(a.orgId, d.id, true, "x")).rejects.toThrow(/Only an issued/);
    await inv.issueInvoice(a.orgId, d.id, "x");

    const overdue = await inv.listInvoices(a.orgId, { status: "overdue" });
    expect(overdue.map((r) => r.id)).toContain(d.id);
    expect(overdue.find((r) => r.id === d.id)!.overdue).toBe(true);

    await inv.setInvoicePaid(a.orgId, d.id, true, "x");
    expect((await inv.getInvoice(a.orgId, d.id))!.status).toBe("paid");
    await inv.setInvoicePaid(a.orgId, d.id, false, "x");
    await inv.voidInvoice(a.orgId, d.id, "x");
    const voided = (await inv.getInvoice(a.orgId, d.id))!;
    expect(voided.status).toBe("void");
    expect(voided.number).toMatch(/^PD\d+$/);

    const copy = await inv.duplicateInvoice(a.orgId, d.id);
    expect(copy).toMatchObject({ status: "draft", number: null, totalCents: 13000, clientId: client.id });
    expect(copy.lines).toEqual(voided.lines);
    expect((await inv.listInvoices(a.orgId, { clientId: client.id }))[0]!.id).toBe(copy.id); // drafts first
  });

  it("edits an issued invoice in place until it's paid", async () => {
    const client = await clients.createClient(a.orgId, { name: "Revise Co" });
    await inv.saveInvoiceSettings(a.orgId, settings({ nextInvoiceNo: 8000 }));
    const d = await inv.createInvoice(a.orgId, { clientId: client.id });
    await expect(inv.reviseInvoice(a.orgId, d.id, PD6325, "x")).rejects.toThrow(/draft is saved/);
    await inv.updateDraft(a.orgId, d.id, PD6325);
    const issued = await inv.issueInvoice(a.orgId, d.id, "x");

    await inv.saveInvoiceSettings(a.orgId, settings({ address: "1 New Street\nSydney NSW 2000", nextInvoiceNo: 8001 }));
    const out = await inv.reviseInvoice(a.orgId, d.id, { ...PD6325, discount: null }, "Owner a");
    expect(out).toMatchObject({ number: issued.number, status: "issued", totalCents: 24000 });
    expect(out.snapshot!.studio.address).toBe("1 New Street\nSydney NSW 2000");
    await expect(inv.reviseInvoice(a.orgId, d.id, { ...PD6325, lines: [] }, "x")).rejects.toThrow(/at least one line/);
    await expect(inv.reviseInvoice(b.orgId, d.id, PD6325, "x")).rejects.toThrow(/not found/);

    await inv.setInvoicePaid(a.orgId, d.id, true, "x");
    await expect(inv.reviseInvoice(a.orgId, d.id, PD6325, "x")).rejects.toThrow(/is paid/);
  });

  it("scopes everything by org", async () => {
    const client = await clients.createClient(a.orgId, { name: "Private Co" });
    const d = await inv.createInvoice(a.orgId, { clientId: client.id });
    await expect(inv.createInvoice(b.orgId, { clientId: client.id })).rejects.toThrow(/not found/);
    expect(await inv.getInvoice(b.orgId, d.id)).toBeNull();
    await expect(inv.updateDraft(b.orgId, d.id, PD6325)).rejects.toThrow(/not found/);
    await expect(inv.issueInvoice(b.orgId, d.id, "x")).rejects.toThrow(/not found/);
    await expect(inv.duplicateInvoice(b.orgId, d.id)).rejects.toThrow(/not found/);
    await expect(inv.voidInvoice(b.orgId, d.id, "x")).rejects.toThrow(/not found/);
    expect(await inv.listInvoices(b.orgId)).toEqual([]);
  });
});
