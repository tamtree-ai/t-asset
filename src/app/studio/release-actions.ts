"use server";

import { revalidatePath } from "next/cache";

import { studioMember } from "@/lib/studio/member";
import { releaseVersions, unreleaseVersion } from "@/services/studio/release";

/** Form action: releases every `version` in the form to the client. Used by the asset page and the queue. */
export async function releaseFormAction(form: FormData): Promise<void> {
  const m = await studioMember();
  const ids = form.getAll("version").filter((v): v is string => typeof v === "string" && v.length > 0);
  await releaseVersions(m.orgId, ids);
  revalidatePath("/studio", "layout");
}

export async function unreleaseFormAction(form: FormData): Promise<void> {
  const m = await studioMember();
  const id = form.get("version");
  if (typeof id === "string") await unreleaseVersion(m.orgId, id);
  revalidatePath("/studio", "layout");
}
