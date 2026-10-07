/**
 * What a share shows: its assets, their options and the versions a guest may open. Latest mode
 * shows everything up to the newest; pinned mode stops at the versions pinned when the link was
 * made, so a new upload does not appear until the studio unpins it.
 */
import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/db";
import { type VersionStatus } from "@/lib/studio/rounds";

type ShareRow = typeof schema.studioShares.$inferSelect;
type FileRow = typeof schema.studioFiles.$inferSelect;

export type RoomFile = Pick<FileRow, "id" | "mime" | "width" | "height" | "durationS" | "fpsNum" | "fpsDen" | "processing" | "bytes" | "originalName" | "sha256">;

export type RoomVersion = { id: string; number: number; status: VersionStatus; changeNote: string; createdAt: Date; file: RoomFile };
export type RoomVariation = { id: string; label: string; versions: RoomVersion[] };
export type RoomAsset = { id: string; title: string; kind: "image" | "video"; variations: RoomVariation[] };

export async function loadShareContent(share: Pick<ShareRow, "id" | "versionMode">): Promise<RoomAsset[]> {
  const items = await db.select().from(schema.studioShareItems).where(eq(schema.studioShareItems.shareId, share.id)).orderBy(asc(schema.studioShareItems.sort));
  if (items.length === 0) return [];
  const assetIds = items.map((i) => i.assetId);
  const assets = await db.select().from(schema.studioAssets).where(inArray(schema.studioAssets.id, assetIds));
  const variations = await db.select().from(schema.studioVariations).where(inArray(schema.studioVariations.assetId, assetIds)).orderBy(asc(schema.studioVariations.sort), asc(schema.studioVariations.createdAt));
  const vIds = variations.map((v) => v.id);
  const versions = vIds.length
    ? await db
        .select({ version: schema.studioVersions, file: schema.studioFiles })
        .from(schema.studioVersions)
        .innerJoin(schema.studioFiles, eq(schema.studioFiles.id, schema.studioVersions.fileId))
        .where(inArray(schema.studioVersions.variationId, vIds))
        .orderBy(asc(schema.studioVersions.number))
    : [];

  const pinnedIds = new Set(items.flatMap((i) => i.pinnedVersionIds));
  // Pinned: a variation is shown up to its highest pinned version, and not at all if nothing in it was pinned.
  const cutoff = new Map<string, number>();
  if (share.versionMode === "pinned") for (const r of versions) if (pinnedIds.has(r.version.id)) cutoff.set(r.version.variationId, Math.max(cutoff.get(r.version.variationId) ?? 0, r.version.number));

  return items.flatMap((item) => {
    const asset = assets.find((a) => a.id === item.assetId);
    if (!asset || asset.archivedAt) return [];
    const vars = variations
      .filter((v) => v.assetId === asset.id)
      .map<RoomVariation>((v) => ({
        id: v.id,
        label: v.label,
        versions: versions
          .filter((r) => r.version.variationId === v.id && (share.versionMode === "latest" || r.version.number <= (cutoff.get(v.id) ?? 0)))
          .map((r) => ({
            id: r.version.id,
            number: r.version.number,
            status: r.version.status,
            changeNote: r.version.changeNote,
            createdAt: r.version.createdAt,
            file: { id: r.file.id, mime: r.file.mime, width: r.file.width, height: r.file.height, durationS: r.file.durationS, fpsNum: r.file.fpsNum, fpsDen: r.file.fpsDen, processing: r.file.processing, bytes: r.file.bytes, originalName: r.file.originalName, sha256: r.file.sha256 },
          })),
      }))
      .filter((v) => v.versions.length > 0);
    return vars.length ? [{ id: asset.id, title: asset.title, kind: asset.kind, variations: vars }] : [];
  });
}

export type Found = { asset: RoomAsset; variation: RoomVariation; version: RoomVersion; latest: boolean };

/** A version inside the loaded content, with whether it is the newest of its option. */
export function findVersion(content: RoomAsset[], versionId: string): Found | null {
  for (const asset of content)
    for (const variation of asset.variations) {
      const version = variation.versions.find((v) => v.id === versionId);
      if (version) return { asset, variation, version, latest: variation.versions[variation.versions.length - 1]!.id === version.id };
    }
  return null;
}

export function findFile(content: RoomAsset[], fileId: string): Found | null {
  for (const asset of content)
    for (const variation of asset.variations) {
      const version = variation.versions.find((v) => v.file.id === fileId);
      if (version) return { asset, variation, version, latest: variation.versions[variation.versions.length - 1]!.id === version.id };
    }
  return null;
}

export const whereLabel = (f: Found) => `${f.asset.title} · ${f.variation.label} v${f.version.number}`;

/** Whether the previews of this version carry the watermark: switched on for the share, and the version is not yet approved. */
export function watermarked(share: Pick<ShareRow, "watermark">, status: VersionStatus): boolean {
  return share.watermark && status !== "approved";
}

export function canDownloadOriginal(share: Pick<ShareRow, "downloadPolicy">, status: VersionStatus): boolean {
  if (share.downloadPolicy === "always") return true;
  if (share.downloadPolicy === "after_approval") return status === "approved";
  return false;
}

export async function versionOrgScope(orgId: string, versionId: string) {
  const [row] = await db
    .select({ projectId: schema.studioProjects.id, assetTitle: schema.studioAssets.title, label: schema.studioVariations.label, number: schema.studioVersions.number, status: schema.studioVersions.status })
    .from(schema.studioVersions)
    .innerJoin(schema.studioVariations, eq(schema.studioVariations.id, schema.studioVersions.variationId))
    .innerJoin(schema.studioAssets, eq(schema.studioAssets.id, schema.studioVariations.assetId))
    .innerJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioAssets.projectId))
    .where(and(eq(schema.studioVersions.id, versionId), eq(schema.studioProjects.orgId, orgId)))
    .limit(1);
  return row ?? null;
}
