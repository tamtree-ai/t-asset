/** Assets, variations and versions (plan §4.1). A version is one uploaded file; the upload itself is `files.ts`. */
import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { StudioError } from "@/lib/studio/errors";

import { fileIdsUnder } from "./clients";
import { removeFiles } from "./files";
import { getProject } from "./projects";

export const MAX_VARIATIONS = 6;

const title = z.string().trim().min(1, "Give it a title.").max(120, "Keep the title under 120 characters.");
const label = z.string().trim().min(1, "Give the option a name.").max(40, "Keep the option name under 40 characters.");

export async function createAsset(orgId: string, projectId: string, raw: { title: string; kind: string }) {
  const input = z.object({ title, kind: z.enum(["image", "video"]) }).parse(raw);
  if (!(await getProject(orgId, projectId))) throw new StudioError("That project was not found.");
  return db.transaction(async (tx) => {
    const [{ next }] = (await tx.select({ next: sql<number>`coalesce(max(${schema.studioAssets.sort}), -1) + 1` }).from(schema.studioAssets).where(eq(schema.studioAssets.projectId, projectId))) as [{ next: number }];
    const [asset] = await tx.insert(schema.studioAssets).values({ projectId, title: input.title, kind: input.kind, sort: Number(next) }).returning();
    const [variation] = await tx.insert(schema.studioVariations).values({ assetId: asset!.id, label: "Main", sort: 0 }).returning();
    return { asset: asset!, variation: variation! };
  });
}

async function ownedAsset(orgId: string, assetId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return null;
  const [row] = await db
    .select({ asset: schema.studioAssets, project: schema.studioProjects })
    .from(schema.studioAssets)
    .innerJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioAssets.projectId))
    .where(and(eq(schema.studioAssets.id, assetId), eq(schema.studioProjects.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function renameAsset(orgId: string, assetId: string, raw: string) {
  const t = title.parse(raw);
  if (!(await ownedAsset(orgId, assetId))) throw new StudioError("That asset was not found.");
  await db.update(schema.studioAssets).set({ title: t }).where(eq(schema.studioAssets.id, assetId));
}

export async function archiveAsset(orgId: string, assetId: string, archived = true) {
  if (!(await ownedAsset(orgId, assetId))) throw new StudioError("That asset was not found.");
  await db.update(schema.studioAssets).set({ archivedAt: archived ? new Date() : null }).where(eq(schema.studioAssets.id, assetId));
}

export async function deleteAsset(orgId: string, assetId: string) {
  if (!(await ownedAsset(orgId, assetId))) throw new StudioError("That asset was not found.");
  const fileIds = await fileIdsUnder(orgId, { assetId });
  await db.delete(schema.studioAssets).where(eq(schema.studioAssets.id, assetId));
  await removeFiles(orgId, fileIds);
}

async function ownedVariation(orgId: string, variationId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(variationId)) return null;
  const [row] = await db
    .select({ variation: schema.studioVariations, asset: schema.studioAssets })
    .from(schema.studioVariations)
    .innerJoin(schema.studioAssets, eq(schema.studioAssets.id, schema.studioVariations.assetId))
    .innerJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioAssets.projectId))
    .where(and(eq(schema.studioVariations.id, variationId), eq(schema.studioProjects.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function addVariation(orgId: string, assetId: string, raw: string) {
  const l = label.parse(raw);
  if (!(await ownedAsset(orgId, assetId))) throw new StudioError("That asset was not found.");
  const existing = await db.select({ sort: schema.studioVariations.sort }).from(schema.studioVariations).where(eq(schema.studioVariations.assetId, assetId));
  if (existing.length >= MAX_VARIATIONS) throw new StudioError(`An asset holds up to ${MAX_VARIATIONS} options.`);
  const [row] = await db.insert(schema.studioVariations).values({ assetId, label: l, sort: Math.max(-1, ...existing.map((e) => e.sort)) + 1 }).returning();
  return row!;
}

export async function renameVariation(orgId: string, variationId: string, raw: string) {
  const l = label.parse(raw);
  if (!(await ownedVariation(orgId, variationId))) throw new StudioError("That option was not found.");
  await db.update(schema.studioVariations).set({ label: l }).where(eq(schema.studioVariations.id, variationId));
}

export async function deleteVariation(orgId: string, variationId: string) {
  const owned = await ownedVariation(orgId, variationId);
  if (!owned) throw new StudioError("That option was not found.");
  const siblings = await db.select({ id: schema.studioVariations.id }).from(schema.studioVariations).where(eq(schema.studioVariations.assetId, owned.asset.id));
  if (siblings.length <= 1) throw new StudioError("An asset needs at least one option.");
  const fileIds = await fileIdsUnder(orgId, { variationId });
  await db.delete(schema.studioVariations).where(eq(schema.studioVariations.id, variationId));
  await removeFiles(orgId, fileIds);
}

async function ownedVersion(orgId: string, versionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return null;
  const [row] = await db
    .select({ version: schema.studioVersions, asset: schema.studioAssets, project: schema.studioProjects })
    .from(schema.studioVersions)
    .innerJoin(schema.studioVariations, eq(schema.studioVariations.id, schema.studioVersions.variationId))
    .innerJoin(schema.studioAssets, eq(schema.studioAssets.id, schema.studioVariations.assetId))
    .innerJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioAssets.projectId))
    .where(and(eq(schema.studioVersions.id, versionId), eq(schema.studioProjects.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function setChangeNote(orgId: string, versionId: string, note: string) {
  const n = z.string().max(2000, "Keep the note under 2000 characters.").parse(note);
  if (!(await ownedVersion(orgId, versionId))) throw new StudioError("That version was not found.");
  await db.update(schema.studioVersions).set({ changeNote: n.trim() }).where(eq(schema.studioVersions.id, versionId));
}

/** Removes one version, its comments and decisions, and its file. A review that already has comments or a sign-off keeps it: the record matters. */
export async function deleteVersion(orgId: string, versionId: string) {
  const owned = await ownedVersion(orgId, versionId);
  if (!owned) throw new StudioError("That version was not found.");
  const [{ n }] = (await db.select({ n: sql<number>`count(*)` }).from(schema.studioDecisions).where(eq(schema.studioDecisions.versionId, versionId))) as [{ n: number }];
  if (Number(n) > 0) throw new StudioError("This version has a sign-off on record, so it can't be deleted.");
  const fileIds = await fileIdsUnder(orgId, { versionId });
  await db.delete(schema.studioVersions).where(eq(schema.studioVersions.id, versionId));
  await removeFiles(orgId, fileIds);
}

export type VersionView = {
  id: string;
  number: number;
  status: "in_review" | "changes_requested" | "approved";
  changeNote: string;
  createdAt: Date;
  file: typeof schema.studioFiles.$inferSelect;
  openComments: number;
  totalComments: number;
};

/** The asset page: variations as tabs, each with its version stack (newest first) and comment counts. */
export async function assetDetail(orgId: string, assetId: string) {
  const owned = await ownedAsset(orgId, assetId);
  if (!owned) return null;
  const variations = await db.select().from(schema.studioVariations).where(eq(schema.studioVariations.assetId, assetId)).orderBy(asc(schema.studioVariations.sort), asc(schema.studioVariations.createdAt));
  const vIds = variations.map((v) => v.id);
  const rows = vIds.length
    ? await db
        .select({ version: schema.studioVersions, file: schema.studioFiles })
        .from(schema.studioVersions)
        .innerJoin(schema.studioFiles, eq(schema.studioFiles.id, schema.studioVersions.fileId))
        .where(inArray(schema.studioVersions.variationId, vIds))
        .orderBy(desc(schema.studioVersions.number))
    : [];
  const versionIds = rows.map((r) => r.version.id);
  const counts = versionIds.length
    ? await db
        .select({
          versionId: schema.studioComments.versionId,
          total: sql<number>`count(*)`,
          open: sql<number>`count(*) filter (where ${schema.studioComments.resolvedAt} is null)`,
        })
        .from(schema.studioComments)
        .where(and(inArray(schema.studioComments.versionId, versionIds), isNull(schema.studioComments.parentId), isNull(schema.studioComments.deletedAt)))
        .groupBy(schema.studioComments.versionId)
    : [];
  const byVersion = new Map(counts.map((c) => [c.versionId, c]));
  return {
    asset: owned.asset,
    project: owned.project,
    variations: variations.map((v) => ({
      ...v,
      versions: rows
        .filter((r) => r.version.variationId === v.id)
        .map<VersionView>((r) => ({
          id: r.version.id,
          number: r.version.number,
          status: r.version.status,
          changeNote: r.version.changeNote,
          createdAt: r.version.createdAt,
          file: r.file,
          openComments: Number(byVersion.get(r.version.id)?.open ?? 0),
          totalComments: Number(byVersion.get(r.version.id)?.total ?? 0),
        })),
    })),
  };
}
