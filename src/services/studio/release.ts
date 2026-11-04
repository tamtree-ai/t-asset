/**
 * Internal versions and releasing them. A version made by the studio's pipeline (an agent draft)
 * starts internal: the owner and editors review it in the same room, comment, and get new
 * versions, and the client sees nothing until the owner releases it. Releasing is one action for
 * any number of versions: the "one approval" for a batch of drafts.
 */
import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import type { VersionMeta } from "@/db/schema";

import { logEvent } from "./events";

export type QueueItem = {
  versionId: string;
  number: number;
  createdAt: Date;
  changeNote: string;
  meta: VersionMeta;
  assetId: string;
  assetTitle: string;
  variationLabel: string;
  projectId: string;
  projectName: string;
  clientName: string;
  processing: string;
  durationS: number | null;
  openComments: number;
};

/** Every internal version in the studio, newest project first, then in asset order. */
export async function internalQueue(orgId: string): Promise<QueueItem[]> {
  const rows = await db
    .select({
      versionId: schema.studioVersions.id,
      number: schema.studioVersions.number,
      createdAt: schema.studioVersions.createdAt,
      changeNote: schema.studioVersions.changeNote,
      meta: schema.studioVersions.meta,
      assetId: schema.studioAssets.id,
      assetTitle: schema.studioAssets.title,
      variationLabel: schema.studioVariations.label,
      projectId: schema.studioProjects.id,
      projectName: schema.studioProjects.name,
      clientName: schema.studioClients.name,
      processing: schema.studioFiles.processing,
      durationS: schema.studioFiles.durationS,
    })
    .from(schema.studioVersions)
    .innerJoin(schema.studioFiles, eq(schema.studioFiles.id, schema.studioVersions.fileId))
    .innerJoin(schema.studioVariations, eq(schema.studioVariations.id, schema.studioVersions.variationId))
    .innerJoin(schema.studioAssets, eq(schema.studioAssets.id, schema.studioVariations.assetId))
    .innerJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioAssets.projectId))
    .innerJoin(schema.studioClients, eq(schema.studioClients.id, schema.studioProjects.clientId))
    .where(and(eq(schema.studioProjects.orgId, orgId), isNull(schema.studioVersions.releasedAt), isNull(schema.studioAssets.archivedAt)))
    .orderBy(desc(schema.studioProjects.createdAt), asc(schema.studioAssets.sort), asc(schema.studioVersions.number));
  const ids = rows.map((r) => r.versionId);
  const counts = ids.length
    ? await db
        .select({ versionId: schema.studioComments.versionId, open: sql<number>`count(*)` })
        .from(schema.studioComments)
        .where(and(inArray(schema.studioComments.versionId, ids), isNull(schema.studioComments.parentId), isNull(schema.studioComments.deletedAt), isNull(schema.studioComments.resolvedAt)))
        .groupBy(schema.studioComments.versionId)
    : [];
  const open = new Map(counts.map((c) => [c.versionId, Number(c.open)]));
  return rows.map((r) => ({ ...r, durationS: r.durationS === null ? null : Number(r.durationS), openComments: open.get(r.versionId) ?? 0 }));
}

/** Releases the versions to every share of their project. Versions of another studio are ignored. Returns how many were released. */
export async function releaseVersions(orgId: string, versionIds: string[]): Promise<number> {
  if (!versionIds.length) return 0;
  const owned = await db
    .select({ id: schema.studioVersions.id, projectId: schema.studioProjects.id, title: schema.studioAssets.title, number: schema.studioVersions.number })
    .from(schema.studioVersions)
    .innerJoin(schema.studioVariations, eq(schema.studioVariations.id, schema.studioVersions.variationId))
    .innerJoin(schema.studioAssets, eq(schema.studioAssets.id, schema.studioVariations.assetId))
    .innerJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioAssets.projectId))
    .where(and(eq(schema.studioProjects.orgId, orgId), inArray(schema.studioVersions.id, versionIds), isNull(schema.studioVersions.releasedAt)));
  if (!owned.length) return 0;
  await db.update(schema.studioVersions).set({ releasedAt: new Date() }).where(inArray(schema.studioVersions.id, owned.map((o) => o.id)));
  for (const projectId of new Set(owned.map((o) => o.projectId))) {
    const these = owned.filter((o) => o.projectId === projectId);
    await logEvent({ orgId, projectId, actorLabel: "You", type: "version.released", payload: { where: these.map((o) => `${o.title} v${o.number}`).join(", "), count: these.length } });
  }
  return owned.length;
}

/** Whether a share's assets have internal drafts in them: the room says "on its way", not "ended". */
export async function shareHasDrafts(shareId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.studioVersions.id })
    .from(schema.studioShareItems)
    .innerJoin(schema.studioVariations, eq(schema.studioVariations.assetId, schema.studioShareItems.assetId))
    .innerJoin(schema.studioVersions, eq(schema.studioVersions.variationId, schema.studioVariations.id))
    .where(and(eq(schema.studioShareItems.shareId, shareId), isNull(schema.studioVersions.releasedAt)))
    .limit(1);
  return !!row;
}

/** Takes a released version back to internal (e.g. released by mistake, before the client looked). */
export async function unreleaseVersion(orgId: string, versionId: string): Promise<void> {
  const [v] = await db
    .select({ id: schema.studioVersions.id })
    .from(schema.studioVersions)
    .innerJoin(schema.studioVariations, eq(schema.studioVariations.id, schema.studioVersions.variationId))
    .innerJoin(schema.studioAssets, eq(schema.studioAssets.id, schema.studioVariations.assetId))
    .innerJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioAssets.projectId))
    .where(and(eq(schema.studioProjects.orgId, orgId), eq(schema.studioVersions.id, versionId)));
  if (v) await db.update(schema.studioVersions).set({ releasedAt: null }).where(eq(schema.studioVersions.id, versionId));
}
