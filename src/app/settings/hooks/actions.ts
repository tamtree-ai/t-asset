"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMember } from "@/lib/auth";
import { type ActionResult, guard, StudioError } from "@/lib/studio/errors";
import { createHook, deleteHook, redeliver, rotateCredential, sendTest, updateHook } from "@/services/hooks/subscriptions";

async function owner() {
  const m = await getCurrentMember();
  if (m.role !== "owner") throw new StudioError("Only the owner manages hooks.");
  return m;
}

const refresh = (id?: string) => {
  revalidatePath("/settings/hooks");
  if (id) revalidatePath(`/settings/hooks/${id}`);
};

/** Returns the secret (push) or feed token (pull): the only time it is ever shown. */
export async function createHookAction(raw: unknown): Promise<ActionResult<{ id: string; credential: string }>> {
  return guard(async () => {
    const m = await owner();
    const { hook, credential } = await createHook(m.orgId, raw);
    refresh();
    return { id: hook.id, credential };
  });
}

export async function updateHookAction(id: string, raw: unknown): Promise<ActionResult> {
  return guard(async () => {
    const m = await owner();
    await updateHook(m.orgId, id, raw);
    refresh(id);
    return undefined;
  });
}

export async function rotateHookAction(id: string): Promise<ActionResult<{ credential: string }>> {
  return guard(async () => {
    const m = await owner();
    const r = await rotateCredential(m.orgId, id);
    refresh(id);
    return r;
  });
}

export async function deleteHookAction(id: string): Promise<ActionResult> {
  return guard(async () => {
    const m = await owner();
    await deleteHook(m.orgId, id);
    refresh();
    return undefined;
  });
}

type SendResult = { status: string; httpStatus: number | null; error: string | null } | null;

export async function sendTestAction(id: string): Promise<ActionResult<SendResult>> {
  return guard(async () => {
    const m = await owner();
    const sent = await sendTest(m.orgId, id, m.name ?? "You");
    refresh(id);
    return sent && { status: sent.status, httpStatus: sent.httpStatus, error: sent.error };
  });
}

export async function redeliverAction(id: string, eventId: string): Promise<ActionResult<SendResult>> {
  return guard(async () => {
    const m = await owner();
    const sent = await redeliver(m.orgId, id, eventId);
    refresh(id);
    return sent && { status: sent.status, httpStatus: sent.httpStatus, error: sent.error };
  });
}
