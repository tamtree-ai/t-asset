/**
 * Deliverables (planning/2026-10-31-tasset-deliverables, Phase 1): the real files attached to a
 * version (SVG, AI, EPS, the print PDF, a ZIP pack, fonts). They upload like a version's file, are
 * checked by their first bytes, need no processing, and leave only under the share's download rules.
 * Every call takes the caller's `orgId`.
 */
import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { getBlobStore } from "@/lib/blob";
import { DELIVERABLE_TYPES, extensionOf, MAX_DELIVERABLE_BYTES, SNIFF_BYTES, sniffDeliverable } from "@/lib/studio/deliverables";
import { StudioError } from "@/lib/studio/errors";

import { getFile, removeFiles, reserveFile, type StartedUpload, UploadError } from "./files";
import { versionOrgScope } from "./room";

/** The most files one version carries. */
export const MAX_DELIVERABLES = 40;

export type Deliverable = { id: string; versionId: string; fileId: string; label: string; name: string; ext: string; mime: string; bytes: number; sort: number };

/** The deliverables of these versions, in their order. */
export async function listDeliverables(versionIds: string[]): Promise<Deliverable[]> {
  if (versionIds.length === 0) return [];
  const rows = await db
    .select({ row: schema.studioVersionFiles, name: schema.studioFiles.originalName, mime: schema.studioFiles.mime, bytes: schema.studioFiles.bytes })
    .from(schema.studioVersionFiles)
    .innerJoin(schema.studioFiles, eq(schema.studioFiles.id, schema.studioVersionFiles.fileId))
    .where(and(inArray(schema.studioVersionFiles.versionId, versionIds), eq(schema.studioFiles.processing, "ready")))
    .orderBy(asc(schema.studioVersionFiles.sort), asc(schema.studioVersionFiles.createdAt));
  return rows.map((r) => ({ id: r.row.id, versionId: r.row.versionId, fileId: r.row.fileId, label: r.row.label, name: r.name, ext: extensionOf(r.name), mime: r.mime, bytes: r.bytes, sort: r.row.sort }));
}

/** Step 1 for a deliverable: the type comes from the extension (the browser's guess is ignored), then the size and the storage meter. */
export async function startDeliverableUpload(orgId: string, input: { versionId: string; name: string; bytes: number }): Promise<StartedUpload & { mime: string }> {
  if (!(await versionOrgScope(orgId, input.versionId))) throw new UploadError("That version was not found.");
  const type = DELIVERABLE_TYPES[extensionOf(input.name)];
  if (!type) throw new UploadError(`“${input.name}” isn't a type we deliver. Attach SVG, AI, EPS, PDF, ZIP, PNG, JPG, TIFF, OTF, TTF or WOFF2 files.`);
  if (input.bytes > MAX_DELIVERABLE_BYTES) throw new UploadError(`“${input.name}” is over the 200 MB limit for a deliverable. Zip it smaller or split it.`);
  const [{ n }] = (await db.select({ n: sql<number>`count(*)` }).from(schema.studioVersionFiles).where(eq(schema.studioVersionFiles.versionId, input.versionId))) as [{ n: number }];
  if (Number(n) >= MAX_DELIVERABLES) throw new UploadError(`A version holds up to ${MAX_DELIVERABLES} files. Zip some of them together.`);
  return { ...(await reserveFile({ orgId, name: input.name, mime: type.mime, bytes: input.bytes })), mime: type.mime };
}

/**
 * Step 3: the bytes arrived, the right size, and the first kilobyte is what the extension claims.
 * A file that isn't is deleted. Calling it twice returns the same row.
 */
export async function finishDeliverable(orgId: string, input: { versionId: string; fileId: string }): Promise<Deliverable> {
  if (!(await versionOrgScope(orgId, input.versionId))) throw new UploadError("That version was not found.");
  const file = await getFile(orgId, input.fileId);
  if (!file) throw new UploadError("That upload was not found. Start it again.");
  const [existing] = await db.select().from(schema.studioVersionFiles).where(and(eq(schema.studioVersionFiles.versionId, input.versionId), eq(schema.studioVersionFiles.fileId, file.id))).limit(1);
  if (existing) return (await listDeliverables([input.versionId])).find((d) => d.id === existing.id)!;
  if (file.processing !== "uploading") throw new UploadError("That upload was not found. Start it again.");

  const store = getBlobStore();
  const head = await store.head(file.originalKey!);
  if (!head) throw new UploadError("The file didn't arrive. Upload it again.");
  if (head.size !== file.bytes) throw new UploadError(`The file arrived incomplete (${head.size} of ${file.bytes} bytes). Upload it again.`);
  const sniffed = sniffDeliverable(file.originalName, await store.readStart(file.originalKey!, SNIFF_BYTES));
  if (!sniffed.ok) {
    await removeFiles(orgId, [file.id]);
    throw new UploadError(sniffed.error);
  }

  const row = await db.transaction(async (tx) => {
    await tx.update(schema.studioFiles).set({ processing: "ready", mime: sniffed.mime, error: null }).where(eq(schema.studioFiles.id, file.id));
    const [next] = await tx.select({ n: sql<number>`coalesce(max(${schema.studioVersionFiles.sort}), -1) + 1` }).from(schema.studioVersionFiles).where(eq(schema.studioVersionFiles.versionId, input.versionId));
    const [r] = await tx
      .insert(schema.studioVersionFiles)
      .values({ versionId: input.versionId, fileId: file.id, label: defaultLabel(file.originalName, sniffed.label), sort: Number(next!.n) })
      .returning();
    return r!;
  });
  return (await listDeliverables([input.versionId])).find((d) => d.id === row.id)!;
}

/** "primary-logo.svg" → "primary-logo — SVG". */
const defaultLabel = (name: string, typeLabel: string) => `${name.replace(/\.[^.]+$/, "").slice(0, 100) || name} — ${typeLabel}`;

/** A deliverable row, checked to be in the caller's org. */
async function ownedRow(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select().from(schema.studioVersionFiles).where(eq(schema.studioVersionFiles.id, id)).limit(1);
  if (!row || !(await versionOrgScope(orgId, row.versionId))) return null;
  return row;
}

const labelInput = z.string().trim().min(1, "Give the file a label.").max(120, "Keep the label under 120 characters.");

export async function renameDeliverable(orgId: string, id: string, raw: string): Promise<void> {
  const label = labelInput.parse(raw);
  if (!(await ownedRow(orgId, id))) throw new StudioError("That file was not found.");
  await db.update(schema.studioVersionFiles).set({ label }).where(eq(schema.studioVersionFiles.id, id));
}

/** Moves a file one place up (-1) or down (+1) in its version's list. */
export async function moveDeliverable(orgId: string, id: string, by: -1 | 1): Promise<void> {
  const row = await ownedRow(orgId, id);
  if (!row) throw new StudioError("That file was not found.");
  const list = await db.select({ id: schema.studioVersionFiles.id }).from(schema.studioVersionFiles).where(eq(schema.studioVersionFiles.versionId, row.versionId)).orderBy(asc(schema.studioVersionFiles.sort), asc(schema.studioVersionFiles.createdAt));
  const at = list.findIndex((r) => r.id === id);
  const to = at + by;
  if (to < 0 || to >= list.length) return;
  [list[at], list[to]] = [list[to]!, list[at]!];
  await db.transaction(async (tx) => {
    for (const [sort, r] of list.entries()) await tx.update(schema.studioVersionFiles).set({ sort }).where(eq(schema.studioVersionFiles.id, r.id));
  });
}

export async function removeDeliverable(orgId: string, id: string): Promise<void> {
  const row = await ownedRow(orgId, id);
  if (!row) throw new StudioError("That file was not found.");
  await db.delete(schema.studioVersionFiles).where(eq(schema.studioVersionFiles.id, id));
  await removeFiles(orgId, [row.fileId]);
}

/** For the guest route: the deliverable `fileId` attached to one of these versions, or null. */
export async function deliverableIn(versionIds: string[], fileId: string): Promise<{ versionId: string; fileId: string; label: string } | null> {
  if (versionIds.length === 0 || !/^[0-9a-f-]{36}$/i.test(fileId)) return null;
  const [row] = await db
    .select({ versionId: schema.studioVersionFiles.versionId, fileId: schema.studioVersionFiles.fileId, label: schema.studioVersionFiles.label })
    .from(schema.studioVersionFiles)
    .where(and(inArray(schema.studioVersionFiles.versionId, versionIds), eq(schema.studioVersionFiles.fileId, fileId)))
    .limit(1);
  return row ?? null;
}
