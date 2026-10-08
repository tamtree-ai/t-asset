/**
 * Invoices (planning/2026-10-08-invoices). Every call takes the caller's orgId and scopes by it.
 * A draft reads the studio and the client live. Issuing takes the next number under a row lock on
 * the brand, and freezes the studio and the client into `snapshot`, so the PDF never changes after.
 */
import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { StudioError } from "@/lib/studio/errors";
import { addDays, computeTotals, DEFAULT_TERMS, type InvoiceBillTo, type InvoiceDiscount, type InvoiceDoc, InvoiceError, type InvoiceStudio, isLogoDataUrl } from "@/lib/studio/invoice";

import { getBrand } from "./brand";
import { logEvent } from "./events";

export type InvoiceRow = typeof schema.studioInvoices.$inferSelect;
export type InvoiceStatus = InvoiceRow["status"];

const UUID = /^[0-9a-f-]{36}$/i;
const TZ = "Australia/Sydney";

/** Today in the studio's timezone, as YYYY-MM-DD. */
export function today(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// ── settings ────────────────────────────────────────────────────────────────

export type InvoiceSettings = {
  legalName: string;
  abn: string;
  address: string;
  gstRegistered: boolean;
  paymentTermsDays: number;
  invoiceTerms: string;
  bankAccountName: string;
  bankBsb: string;
  bankAccountNo: string;
  payByPost: boolean;
  invoicePrefix: string;
  nextInvoiceNo: number;
  invoiceLogo: string | null;
};

export async function getInvoiceSettings(orgId: string): Promise<InvoiceSettings> {
  const [row] = await db.select().from(schema.studioBrand).where(eq(schema.studioBrand.orgId, orgId)).limit(1);
  return {
    legalName: row?.legalName ?? "",
    abn: row?.abn ?? "",
    address: row?.address ?? "",
    gstRegistered: row?.gstRegistered ?? false,
    paymentTermsDays: row?.paymentTermsDays ?? 30,
    invoiceTerms: row?.invoiceTerms ?? DEFAULT_TERMS,
    bankAccountName: row?.bankAccountName ?? "",
    bankBsb: row?.bankBsb ?? "",
    bankAccountNo: row?.bankAccountNo ?? "",
    payByPost: row?.payByPost ?? true,
    invoicePrefix: row?.invoicePrefix ?? "PD",
    nextInvoiceNo: row?.nextInvoiceNo ?? 1,
    invoiceLogo: row?.invoiceLogo ?? null,
  };
}

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null);

/** About 150 KB of image once base64'd: plenty for a logo, small enough to sit in a row. */
const MAX_LOGO_CHARS = 200_000;

export const invoiceSettingsInput = z.object({
  legalName: optText(100),
  abn: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s/g, "") || null)
    .refine((s) => s === null || /^\d{11}$/.test(s), "An ABN is 11 digits."),
  address: optText(300),
  gstRegistered: z.boolean(),
  paymentTermsDays: z.coerce.number().int("Payment terms are whole days.").min(0).max(365, "Payment terms can be at most 365 days."),
  invoiceTerms: z
    .string()
    .trim()
    .max(1200, "Keep the terms under 1200 characters.")
    .transform((s) => (s === "" || s === DEFAULT_TERMS ? null : s)),
  bankAccountName: optText(100),
  bankBsb: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s/g, "") || null)
    .refine((s) => s === null || /^\d{3}-?\d{3}$/.test(s), "A BSB is 6 digits, like 062-000.")
    .transform((s) => (s ? `${s.replace("-", "").slice(0, 3)}-${s.replace("-", "").slice(3)}` : null)),
  bankAccountNo: z
    .string()
    .trim()
    .transform((s) => s || null)
    .refine((s) => s === null || /^[\d\s-]{4,20}$/.test(s), "The account number should be digits."),
  payByPost: z.boolean(),
  invoicePrefix: z.string().trim().max(10, "Keep the prefix under 10 characters.").regex(/^[A-Za-z0-9-]*$/, "The prefix can use letters, digits and dashes."),
  nextInvoiceNo: z.coerce.number().int("The next number must be a whole number.").min(1).max(99_999_999),
  invoiceLogo: z
    .string()
    .nullable()
    .refine((s) => s === null || (s.length <= MAX_LOGO_CHARS && isLogoDataUrl(s)), "The logo must be a PNG, JPEG, WebP or SVG under about 150 KB."),
});

export async function saveInvoiceSettings(orgId: string, raw: unknown): Promise<InvoiceSettings> {
  const input = invoiceSettingsInput.parse(raw);
  if (input.bankBsb && !input.bankAccountNo) throw new StudioError("Add the account number as well as the BSB.");
  const brand = await getBrand(orgId);
  await db
    .insert(schema.studioBrand)
    .values({ orgId, studioName: brand.studioName, accentHex: brand.accentHex, ...input })
    .onConflictDoUpdate({ target: schema.studioBrand.orgId, set: { ...input, updatedAt: new Date() } });
  return getInvoiceSettings(orgId);
}

/** The studio as an invoice shows it, from the live settings. */
export async function liveStudio(orgId: string): Promise<InvoiceStudio> {
  const [brand, s] = await Promise.all([getBrand(orgId), getInvoiceSettings(orgId)]);
  return {
    name: s.legalName || brand.studioName,
    abn: s.abn || null,
    address: s.address || null,
    email: brand.supportEmail,
    website: brand.website,
    gstRegistered: s.gstRegistered,
    bankAccountName: s.bankAccountName || null,
    bankBsb: s.bankBsb || null,
    bankAccountNo: s.bankAccountNo || null,
    payByPost: s.payByPost,
    terms: s.invoiceTerms,
    logo: s.invoiceLogo,
  };
}

const billToOf = (c: { name: string; company: string | null; billingAddress: string | null }): InvoiceBillTo => ({ name: c.name, company: c.company, address: c.billingAddress });

// ── drafts ──────────────────────────────────────────────────────────────────

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates look like 2026-11-30.")
  .refine((s) => !Number.isNaN(Date.parse(s)), "That date doesn't exist.");

export const draftInput = z
  .object({
    projectId: z.string().uuid().nullable().default(null),
    issueDate: isoDate,
    dueDate: isoDate,
    lines: z
      .array(
        z.object({
          description: z.string().trim().min(1, "Every line needs a description.").max(200, "Keep a description under 200 characters."),
          detail: z.string().trim().max(200).optional().transform((s) => s || undefined),
          qty: z.number().positive("Quantities must be more than 0.").max(100_000),
          unitCents: z.number().int().min(0, "Prices can't be negative.").max(100_000_000),
        }),
      )
      .max(50, "Fifty lines is the most one invoice takes."),
    discount: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("amount"), cents: z.number().int().min(0), label: z.string().trim().max(60).optional() }),
        z.object({ kind: z.literal("percent"), percent: z.number().min(0).max(100, "A percentage discount is at most 100."), label: z.string().trim().max(60).optional() }),
      ])
      .nullable()
      .default(null),
    notes: z.string().max(2000, "Keep notes under 2000 characters.").default(""),
  })
  .refine((v) => v.dueDate >= v.issueDate, { message: "The due date is before the invoice date." });

async function clientOf(orgId: string, clientId: string) {
  if (!UUID.test(clientId)) return null;
  const [c] = await db.select().from(schema.studioClients).where(and(eq(schema.studioClients.id, clientId), eq(schema.studioClients.orgId, orgId))).limit(1);
  return c ?? null;
}

async function checkProject(orgId: string, clientId: string, projectId: string | null) {
  if (!projectId) return;
  const [p] = await db
    .select({ id: schema.studioProjects.id })
    .from(schema.studioProjects)
    .where(and(eq(schema.studioProjects.id, projectId), eq(schema.studioProjects.orgId, orgId), eq(schema.studioProjects.clientId, clientId)))
    .limit(1);
  if (!p) throw new StudioError("That project isn't one of this client's.");
}

function totalOf(lines: InvoiceDoc["lines"], discount: InvoiceDiscount, gstRegistered: boolean): number {
  try {
    return computeTotals(lines, discount, gstRegistered).totalCents;
  } catch (e) {
    if (e instanceof InvoiceError) throw new StudioError(e.message);
    throw e;
  }
}

export async function createInvoice(orgId: string, raw: { clientId: string; projectId?: string | null }): Promise<InvoiceRow> {
  const client = await clientOf(orgId, raw.clientId);
  if (!client) throw new StudioError("That client was not found.");
  const projectId = raw.projectId || null;
  await checkProject(orgId, client.id, projectId);
  const s = await getInvoiceSettings(orgId);
  const issueDate = today();
  const [row] = await db.insert(schema.studioInvoices).values({ orgId, clientId: client.id, projectId, issueDate, dueDate: addDays(issueDate, s.paymentTermsDays) }).returning();
  return row!;
}

async function draftOf(orgId: string, id: string): Promise<InvoiceRow> {
  const row = await getInvoice(orgId, id);
  if (!row) throw new StudioError("That invoice was not found.");
  if (row.status !== "draft") throw new StudioError(`Invoice ${row.number} has been issued and can't be changed. Duplicate it to make a new one.`);
  return row;
}

export async function updateDraft(orgId: string, id: string, raw: unknown): Promise<InvoiceRow> {
  const input = draftInput.parse(raw);
  const row = await draftOf(orgId, id);
  await checkProject(orgId, row.clientId, input.projectId);
  const { gstRegistered } = await getInvoiceSettings(orgId);
  const totalCents = totalOf(input.lines, input.discount, gstRegistered);
  const [out] = await db
    .update(schema.studioInvoices)
    .set({ ...input, totalCents, updatedAt: new Date() })
    .where(and(eq(schema.studioInvoices.id, id), eq(schema.studioInvoices.status, "draft")))
    .returning();
  if (!out) throw new StudioError("That invoice was issued meanwhile. Reload the page.");
  return out;
}

export async function deleteDraft(orgId: string, id: string): Promise<void> {
  await draftOf(orgId, id);
  await db.delete(schema.studioInvoices).where(and(eq(schema.studioInvoices.id, id), eq(schema.studioInvoices.orgId, orgId), eq(schema.studioInvoices.status, "draft")));
}

/** A new draft with the same client, project, lines, discount and notes, dated today. */
export async function duplicateInvoice(orgId: string, id: string): Promise<InvoiceRow> {
  const src = await getInvoice(orgId, id);
  if (!src) throw new StudioError("That invoice was not found.");
  const s = await getInvoiceSettings(orgId);
  const issueDate = today();
  const [row] = await db
    .insert(schema.studioInvoices)
    .values({ orgId, clientId: src.clientId, projectId: src.projectId, issueDate, dueDate: addDays(issueDate, s.paymentTermsDays), lines: src.lines, discount: src.discount, notes: src.notes, totalCents: totalOf(src.lines, src.discount, s.gstRegistered) })
    .returning();
  return row!;
}

// ── issuing and after ───────────────────────────────────────────────────────

/** Assigns the next number, freezes the studio and the client, and locks the invoice. */
export async function issueInvoice(orgId: string, id: string, actorLabel: string): Promise<InvoiceRow> {
  const studio = await liveStudio(orgId);
  const brand = await getBrand(orgId);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.studioInvoices).where(and(eq(schema.studioInvoices.id, id), eq(schema.studioInvoices.orgId, orgId))).for("update").limit(1);
    if (!row) throw new StudioError("That invoice was not found.");
    if (row.status !== "draft") throw new StudioError(`Invoice ${row.number} is already issued.`);
    if (row.lines.length === 0) throw new StudioError("Add at least one line before issuing.");
    const [client] = await tx.select().from(schema.studioClients).where(eq(schema.studioClients.id, row.clientId)).limit(1);
    const totalCents = totalOf(row.lines, row.discount, studio.gstRegistered);

    // The brand row is the counter. Make sure it exists, then lock it.
    await tx.insert(schema.studioBrand).values({ orgId, studioName: brand.studioName, accentHex: brand.accentHex }).onConflictDoNothing();
    const [b] = await tx.select({ prefix: schema.studioBrand.invoicePrefix, next: schema.studioBrand.nextInvoiceNo }).from(schema.studioBrand).where(eq(schema.studioBrand.orgId, orgId)).for("update");
    let n = b!.next;
    // Skip numbers already taken (say the counter was set back by hand).
    for (;;) {
      const [taken] = await tx.select({ id: schema.studioInvoices.id }).from(schema.studioInvoices).where(and(eq(schema.studioInvoices.orgId, orgId), eq(schema.studioInvoices.number, `${b!.prefix}${n}`))).limit(1);
      if (!taken) break;
      n++;
    }
    const number = `${b!.prefix}${n}`;
    await tx.update(schema.studioBrand).set({ nextInvoiceNo: n + 1 }).where(eq(schema.studioBrand.orgId, orgId));
    const [out] = await tx
      .update(schema.studioInvoices)
      .set({ number, status: "issued", issuedAt: new Date(), totalCents, snapshot: { studio, billTo: billToOf(client!) }, updatedAt: new Date() })
      .where(eq(schema.studioInvoices.id, id))
      .returning();
    await logEvent({ orgId, projectId: row.projectId, actorLabel, type: "invoice.issued", payload: { invoiceId: id, number, totalCents } }, tx);
    return out!;
  });
}

export async function setInvoicePaid(orgId: string, id: string, paid: boolean, actorLabel: string): Promise<void> {
  const row = await getInvoice(orgId, id);
  if (!row) throw new StudioError("That invoice was not found.");
  if (paid ? row.status !== "issued" : row.status !== "paid") throw new StudioError(paid ? "Only an issued invoice can be marked paid." : "That invoice isn't marked paid.");
  await db
    .update(schema.studioInvoices)
    .set({ status: paid ? "paid" : "issued", paidAt: paid ? new Date() : null, updatedAt: new Date() })
    .where(eq(schema.studioInvoices.id, id));
  await logEvent({ orgId, projectId: row.projectId, actorLabel, type: paid ? "invoice.paid" : "invoice.unpaid", payload: { invoiceId: id, number: row.number } });
}

/** Cancels an issued invoice. It keeps its number, so the sequence has no gaps to explain. */
export async function voidInvoice(orgId: string, id: string, actorLabel: string): Promise<void> {
  const row = await getInvoice(orgId, id);
  if (!row) throw new StudioError("That invoice was not found.");
  if (row.status === "draft") throw new StudioError("A draft can just be deleted.");
  if (row.status === "void") return;
  await db.update(schema.studioInvoices).set({ status: "void", voidedAt: new Date(), updatedAt: new Date() }).where(eq(schema.studioInvoices.id, id));
  await logEvent({ orgId, projectId: row.projectId, actorLabel, type: "invoice.voided", payload: { invoiceId: id, number: row.number } });
}

// ── reading ─────────────────────────────────────────────────────────────────

export async function getInvoice(orgId: string, id: string): Promise<InvoiceRow | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(schema.studioInvoices).where(and(eq(schema.studioInvoices.id, id), eq(schema.studioInvoices.orgId, orgId))).limit(1);
  return row ?? null;
}

/** What the invoice shows: the frozen copy once issued, the live studio and client while a draft. */
export async function invoiceDoc(orgId: string, row: InvoiceRow): Promise<InvoiceDoc> {
  let studio: InvoiceStudio, billTo: InvoiceBillTo;
  if (row.snapshot) ({ studio, billTo } = row.snapshot);
  else {
    const client = await clientOf(orgId, row.clientId);
    studio = await liveStudio(orgId);
    billTo = client ? billToOf(client) : { name: "", company: null, address: null };
  }
  return { number: row.number, issueDate: row.issueDate, dueDate: row.dueDate, billTo, lines: row.lines, discount: row.discount, notes: row.notes, studio, status: row.status };
}

export type InvoiceListItem = Pick<InvoiceRow, "id" | "number" | "status" | "issueDate" | "dueDate" | "totalCents" | "clientId" | "projectId"> & { clientName: string; projectName: string | null; overdue: boolean };

export async function listInvoices(orgId: string, opts: { status?: InvoiceStatus | "overdue"; clientId?: string; projectId?: string } = {}): Promise<InvoiceListItem[]> {
  const where = [eq(schema.studioInvoices.orgId, orgId)];
  const now = today();
  if (opts.status === "overdue") where.push(eq(schema.studioInvoices.status, "issued"), sql`${schema.studioInvoices.dueDate} < ${now}`);
  else if (opts.status) where.push(eq(schema.studioInvoices.status, opts.status));
  if (opts.clientId && UUID.test(opts.clientId)) where.push(eq(schema.studioInvoices.clientId, opts.clientId));
  if (opts.projectId && UUID.test(opts.projectId)) where.push(eq(schema.studioInvoices.projectId, opts.projectId));
  const rows = await db
    .select({
      id: schema.studioInvoices.id,
      number: schema.studioInvoices.number,
      status: schema.studioInvoices.status,
      issueDate: schema.studioInvoices.issueDate,
      dueDate: schema.studioInvoices.dueDate,
      totalCents: schema.studioInvoices.totalCents,
      clientId: schema.studioInvoices.clientId,
      projectId: schema.studioInvoices.projectId,
      clientName: schema.studioClients.name,
      projectName: schema.studioProjects.name,
    })
    .from(schema.studioInvoices)
    .innerJoin(schema.studioClients, eq(schema.studioClients.id, schema.studioInvoices.clientId))
    .leftJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioInvoices.projectId))
    .where(and(...where))
    .orderBy(sql`${schema.studioInvoices.status} = 'draft' desc`, desc(schema.studioInvoices.issueDate), desc(schema.studioInvoices.createdAt));
  return rows.map((r) => ({ ...r, overdue: r.status === "issued" && r.dueDate < now }));
}

export async function invoiceCount(orgId: string, clientId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.studioInvoices).where(and(eq(schema.studioInvoices.orgId, orgId), eq(schema.studioInvoices.clientId, clientId)));
  return r?.n ?? 0;
}

/** Active clients and projects, for "New invoice". */
export async function invoicePickers(orgId: string) {
  const [clients, projects] = await Promise.all([
    db.select({ id: schema.studioClients.id, name: schema.studioClients.name }).from(schema.studioClients).where(and(eq(schema.studioClients.orgId, orgId), isNull(schema.studioClients.archivedAt))).orderBy(asc(schema.studioClients.name)),
    db.select({ id: schema.studioProjects.id, name: schema.studioProjects.name, clientId: schema.studioProjects.clientId }).from(schema.studioProjects).where(and(eq(schema.studioProjects.orgId, orgId), isNull(schema.studioProjects.archivedAt))).orderBy(asc(schema.studioProjects.name)),
  ]);
  return { clients, projects };
}
