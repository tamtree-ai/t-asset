"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMember } from "@/lib/auth";
import { type ActionResult, guard, StudioError } from "@/lib/studio/errors";
import { saveBrand } from "@/services/studio/brand";

export async function saveBrandAction(raw: unknown): Promise<ActionResult> {
  return guard(async () => {
    const m = await getCurrentMember();
    if (m.role !== "owner") throw new StudioError("Only the owner can change the brand.");
    await saveBrand(m.orgId, raw);
    revalidatePath("/settings/brand");
    return undefined;
  });
}
