"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMember } from "@/lib/auth";
import { type ActionResult, guard, StudioError } from "@/lib/studio/errors";
import { createInvoice, deleteDraft, duplicateInvoice, issueInvoice, saveInvoiceSettings, setInvoicePaid, updateDraft, voidInvoice } from "@/services/studio/invoices";

/** Invoices are money: the owner's alone, like the brand. */
async function owner() {
  const m = await getCurrentMember();
  if (m.role !== "owner") throw new StudioError("Only the owner can work on invoices.");
  return { orgId: m.orgId, label: m.name || m.email };
}

const touched = () => revalidatePath("/studio", "layout");

export async function createInvoiceAction(raw: { clientId: string; projectId?: string | null }): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const m = await owner();
    const row = await createInvoice(m.orgId, raw);
    touched();
    return { id: row.id };
  });
}

export async function saveDraftAction(id: string, raw: unknown): Promise<ActionResult> {
  return guard(async () => {
    const m = await owner();
    await updateDraft(m.orgId, id, raw);
    touched();
    return undefined;
  });
}

/** Saves what's on screen, then issues it, so what was previewed is what gets the number. */
export async function issueInvoiceAction(id: string, raw: unknown): Promise<ActionResult<{ number: string }>> {
  return guard(async () => {
    const m = await owner();
    await updateDraft(m.orgId, id, raw);
    const row = await issueInvoice(m.orgId, id, m.label);
    touched();
    return { number: row.number! };
  });
}

export async function deleteDraftAction(id: string): Promise<ActionResult> {
  return guard(async () => {
    const m = await owner();
    await deleteDraft(m.orgId, id);
    touched();
    return undefined;
  });
}

export async function duplicateInvoiceAction(id: string): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const m = await owner();
    const row = await duplicateInvoice(m.orgId, id);
    touched();
    return { id: row.id };
  });
}

export async function setPaidAction(id: string, paid: boolean): Promise<ActionResult> {
  return guard(async () => {
    const m = await owner();
    await setInvoicePaid(m.orgId, id, paid, m.label);
    touched();
    return undefined;
  });
}

export async function voidInvoiceAction(id: string): Promise<ActionResult> {
  return guard(async () => {
    const m = await owner();
    await voidInvoice(m.orgId, id, m.label);
    touched();
    return undefined;
  });
}

export async function saveInvoiceSettingsAction(raw: unknown): Promise<ActionResult> {
  return guard(async () => {
    const m = await owner();
    await saveInvoiceSettings(m.orgId, raw);
    revalidatePath("/settings/invoicing");
    touched();
    return undefined;
  });
}
