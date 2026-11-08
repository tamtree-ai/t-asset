"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMember } from "@/lib/auth";
import { type ActionResult, guard, StudioError } from "@/lib/studio/errors";
import { createApiToken, revokeApiToken } from "@/services/studio/api-tokens";

async function owner() {
  const m = await getCurrentMember();
  if (m.role !== "owner") throw new StudioError("Only the owner manages API tokens.");
  return m;
}

/** Returns the plain token: the only time it is ever shown. */
export async function createApiTokenAction(raw: unknown): Promise<ActionResult<{ token: string }>> {
  return guard(async () => {
    const m = await owner();
    const { token } = await createApiToken(m.orgId, raw);
    revalidatePath("/settings/api-tokens");
    return { token };
  });
}

export async function revokeApiTokenAction(id: string): Promise<ActionResult> {
  return guard(async () => {
    const m = await owner();
    await revokeApiToken(m.orgId, id);
    revalidatePath("/settings/api-tokens");
    return undefined;
  });
}
