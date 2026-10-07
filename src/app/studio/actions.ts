"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { type ActionResult, guard, StudioError } from "@/lib/studio/errors";
import { requestOrigin, studioMember } from "@/lib/studio/member";
import { addVariation, archiveAsset, createAsset, deleteAsset, deleteVariation, deleteVersion, renameAsset, renameVariation, setChangeNote } from "@/services/studio/assets";
import { createClient, deleteClient, setClientArchived, updateClient } from "@/services/studio/clients";
import { createProject, deleteProject, setProjectArchived, updateProject } from "@/services/studio/projects";
import { notifyTamtree, retryFile, TamtreeError } from "@/services/studio/tamtree";
import { createShare, getShare, regeneratePasscode, restoreShare, revokeShare, shareSecrets, type ShareInput, updateShare } from "@/services/studio/shares";

/** Create actions return the new id so the client component can navigate; the rest just say ok. */

export async function createClientAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const m = await studioMember();
    const row = await createClient(m.orgId, raw);
    revalidatePath("/studio");
    return { id: row.id };
  });
}

export async function updateClientAction(id: string, raw: unknown): Promise<ActionResult> {
  return guard(async () => {
    const m = await studioMember();
    await updateClient(m.orgId, id, raw);
    revalidatePath("/studio", "layout");
    return undefined;
  });
}

export async function archiveClientAction(id: string, archived: boolean): Promise<ActionResult> {
  return guard(async () => {
    const m = await studioMember();
    await setClientArchived(m.orgId, id, archived);
    revalidatePath("/studio", "layout");
    return undefined;
  });
}

export async function deleteClientAction(id: string): Promise<ActionResult> {
  const r = await guard(async () => {
    const m = await studioMember();
    if (m.role !== "owner") throw new StudioError("Only the owner can delete a client.");
    await deleteClient(m.orgId, id);
    revalidatePath("/studio", "layout");
    return undefined;
  });
  if (r.ok) redirect("/studio");
  return r;
}

export async function createProjectAction(clientId: string, raw: unknown): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const m = await studioMember();
    const row = await createProject(m.orgId, clientId, raw);
    revalidatePath(`/studio/clients/${clientId}`);
    return { id: row.id };
  });
}

export async function updateProjectAction(id: string, raw: unknown): Promise<ActionResult> {
  return guard(async () => {
    const m = await studioMember();
    await updateProject(m.orgId, id, raw);
    revalidatePath("/studio", "layout");
    return undefined;
  });
}

export async function archiveProjectAction(id: string, archived: boolean): Promise<ActionResult> {
  return guard(async () => {
    const m = await studioMember();
    await setProjectArchived(m.orgId, id, archived);
    revalidatePath("/studio", "layout");
    return undefined;
  });
}

export async function deleteProjectAction(id: string, clientId: string): Promise<ActionResult> {
  const r = await guard(async () => {
    const m = await studioMember();
    if (m.role !== "owner") throw new StudioError("Only the owner can delete a project.");
    await deleteProject(m.orgId, id);
    revalidatePath("/studio", "layout");
    return undefined;
  });
  if (r.ok) redirect(`/studio/clients/${clientId}`);
  return r;
}

export async function createAssetAction(projectId: string, raw: { title: string; kind: string }): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const m = await studioMember();
    const { asset } = await createAsset(m.orgId, projectId, raw);
    revalidatePath(`/studio/projects/${projectId}`);
    return { id: asset.id };
  });
}

export async function renameAssetAction(id: string, title: string): Promise<ActionResult> {
  return guard(async () => {
    const m = await studioMember();
    await renameAsset(m.orgId, id, title);
    revalidatePath("/studio", "layout");
    return undefined;
  });
}

export async function archiveAssetAction(id: string, projectId: string): Promise<ActionResult> {
  const r = await guard(async () => {
    const m = await studioMember();
    await archiveAsset(m.orgId, id, true);
    revalidatePath("/studio", "layout");
    return undefined;
  });
  if (r.ok) redirect(`/studio/projects/${projectId}`);
  return r;
}

export async function deleteAssetAction(id: string, projectId: string): Promise<ActionResult> {
  const r = await guard(async () => {
    const m = await studioMember();
    if (m.role !== "owner") throw new StudioError("Only the owner can delete an asset.");
    await deleteAsset(m.orgId, id);
    revalidatePath("/studio", "layout");
    return undefined;
  });
  if (r.ok) redirect(`/studio/projects/${projectId}`);
  return r;
}

export async function addVariationAction(assetId: string, label: string): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const m = await studioMember();
    const row = await addVariation(m.orgId, assetId, label);
    revalidatePath(`/studio/assets/${assetId}`);
    return { id: row.id };
  });
}

export async function renameVariationAction(variationId: string, label: string): Promise<ActionResult> {
  return guard(async () => {
    const m = await studioMember();
    await renameVariation(m.orgId, variationId, label);
    revalidatePath("/studio", "layout");
    return undefined;
  });
}

export async function deleteVariationAction(variationId: string): Promise<ActionResult> {
  return guard(async () => {
    const m = await studioMember();
    await deleteVariation(m.orgId, variationId);
    revalidatePath("/studio", "layout");
    return undefined;
  });
}

export async function setChangeNoteAction(versionId: string, note: string): Promise<ActionResult> {
  return guard(async () => {
    const m = await studioMember();
    await setChangeNote(m.orgId, versionId, note);
    revalidatePath("/studio", "layout");
    return undefined;
  });
}

export async function deleteVersionAction(versionId: string): Promise<ActionResult> {
  return guard(async () => {
    const m = await studioMember();
    await deleteVersion(m.orgId, versionId);
    revalidatePath("/studio", "layout");
    return undefined;
  });
}

export async function createShareAction(projectId: string, raw: ShareInput): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const m = await studioMember();
    const { share } = await createShare(m.orgId, m.memberId, projectId, raw);
    revalidatePath(`/studio/projects/${projectId}`);
    return { id: share.id };
  });
}

export async function updateShareAction(shareId: string, raw: ShareInput): Promise<ActionResult> {
  return guard(async () => {
    const m = await studioMember();
    await updateShare(m.orgId, shareId, raw);
    revalidatePath("/studio", "layout");
    return undefined;
  });
}

export async function regeneratePasscodeAction(shareId: string): Promise<ActionResult<{ passcode: string }>> {
  return guard(async () => {
    const m = await studioMember();
    const passcode = await regeneratePasscode(m.orgId, shareId);
    revalidatePath(`/studio/shares/${shareId}`);
    return { passcode };
  });
}

export async function revokeShareAction(shareId: string): Promise<ActionResult> {
  return guard(async () => {
    const m = await studioMember();
    await revokeShare(m.orgId, shareId);
    revalidatePath("/studio", "layout");
    return undefined;
  });
}

export async function restoreShareAction(shareId: string): Promise<ActionResult> {
  return guard(async () => {
    const m = await studioMember();
    await restoreShare(m.orgId, shareId);
    revalidatePath("/studio", "layout");
    return undefined;
  });
}

/** The link and passcode to copy, decrypted on demand (they are never in the page's HTML). */
export async function revealShareAction(shareId: string): Promise<ActionResult<{ url: string; passcode: string; passcodeDisplay: string }>> {
  return guard(async () => {
    const m = await studioMember();
    const found = await getShare(m.orgId, shareId);
    if (!found) throw new StudioError("That review link was not found.");
    const s = shareSecrets(found.share, await requestOrigin());
    return { url: s.url, passcode: s.passcode, passcodeDisplay: s.passcodeDisplay };
  });
}

/** Sends a failed (or stuck) file back to Tamtree. */
export async function retryProcessingAction(fileId: string, assetId: string): Promise<ActionResult> {
  return guard(async () => {
    const m = await studioMember();
    try {
      await retryFile(m.orgId, fileId);
    } catch (e) {
      if (e instanceof TamtreeError) throw new StudioError(e.message);
      throw e;
    }
    after(() => notifyTamtree(fileId));
    revalidatePath(`/studio/assets/${assetId}`);
    return undefined;
  });
}
