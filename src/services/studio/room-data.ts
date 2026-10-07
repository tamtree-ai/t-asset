/** Builds what the review room renders for one reviewer: the share's content with each version's watermark, download and sign-off state. */
import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/db";
import type { RoomAssetView } from "@/lib/studio/room-types";

import type { ShareRow } from "./access";
import { canDownloadOriginal, findVersion, type RoomAsset, watermarked } from "./room";

export async function latestSignoffs(versionIds: string[]) {
  if (versionIds.length === 0) return new Map<string, { decision: "approved" | "changes_requested"; name: string; at: string }>();
  const rows = await db.select().from(schema.studioDecisions).where(inArray(schema.studioDecisions.versionId, versionIds)).orderBy(desc(schema.studioDecisions.createdAt));
  const out = new Map<string, { decision: "approved" | "changes_requested"; name: string; at: string }>();
  for (const r of rows) if (!out.has(r.versionId)) out.set(r.versionId, { decision: r.decision, name: r.signedName, at: r.createdAt.toISOString() });
  return out;
}

export function toView(share: Pick<ShareRow, "watermark" | "downloadPolicy">, content: RoomAsset[], signoffs: Awaited<ReturnType<typeof latestSignoffs>>): RoomAssetView[] {
  return content.map((a) => ({
    id: a.id,
    title: a.title,
    kind: a.kind,
    variations: a.variations.map((v) => ({
      id: v.id,
      label: v.label,
      versions: v.versions.map((x, i) => ({
        id: x.id,
        number: x.number,
        status: x.status,
        changeNote: x.changeNote,
        createdAt: x.createdAt.toISOString(),
        file: { id: x.file.id, mime: x.file.mime, width: x.file.width, height: x.file.height, durationS: x.file.durationS, fpsNum: x.file.fpsNum, fpsDen: x.file.fpsDen, processing: x.file.processing, bytes: x.file.bytes, originalName: x.file.originalName },
        marked: watermarked(share, x.status),
        canDownload: canDownloadOriginal(share, x.status),
        latest: i === v.versions.length - 1,
        signoff: signoffs.get(x.id) ?? null,
      })),
    })),
  }));
}

/** The version to open: the one in `?v=`, if the share shows it, else the first asset's first option, newest version. */
export function initialSelection(content: RoomAsset[], versionId?: string | null) {
  const found = versionId ? findVersion(content, versionId) : null;
  if (found) return { assetId: found.asset.id, variationId: found.variation.id, versionId: found.version.id };
  const a = content[0]!;
  const v = a.variations[0]!;
  return { assetId: a.id, variationId: v.id, versionId: v.versions[v.versions.length - 1]!.id };
}

export async function projectClientName(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: schema.studioClients.name, contacts: schema.studioClients.contacts })
    .from(schema.studioProjects)
    .innerJoin(schema.studioClients, eq(schema.studioClients.id, schema.studioProjects.clientId))
    .where(and(eq(schema.studioProjects.id, projectId)))
    .limit(1);
  return row?.name ?? null;
}
