/** Comment export and the approval certificate's data (plan §2, §6 Phase 5). Owner-side: every call takes the orgId. */
import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db, schema } from "@/db";
import { readAnnotation } from "@/lib/studio/annotation";
import { toCsv } from "@/lib/studio/csv";
import { StudioError } from "@/lib/studio/errors";
import { type Fps, formatTimecode } from "@/lib/studio/timecode";

const HEADER = ["Project", "Asset", "Option", "Version", "#", "Status", "Resolved by", "Author", "From", "Posted", "Where", "Time", "Time out", "Frame", "X", "Y", "Width", "Height", "Comment", "Replies", "Internal"];

type Scope = { versionId?: string; projectId?: string };

/** One row per root comment, replies folded into one cell, oldest version first. Hidden comments are left out. */
export async function commentsCsv(orgId: string, scope: Scope): Promise<{ csv: string; name: string }> {
  if (!scope.versionId && !scope.projectId) throw new StudioError("Say which version or project to export.");
  const conds = [eq(schema.studioProjects.orgId, orgId)];
  if (scope.versionId) conds.push(eq(schema.studioVersions.id, scope.versionId));
  if (scope.projectId) conds.push(eq(schema.studioProjects.id, scope.projectId));
  const versions = await db
    .select({
      id: schema.studioVersions.id,
      number: schema.studioVersions.number,
      fpsNum: schema.studioFiles.fpsNum,
      fpsDen: schema.studioFiles.fpsDen,
      variation: schema.studioVariations.label,
      asset: schema.studioAssets.title,
      project: schema.studioProjects.name,
    })
    .from(schema.studioVersions)
    .innerJoin(schema.studioFiles, eq(schema.studioFiles.id, schema.studioVersions.fileId))
    .innerJoin(schema.studioVariations, eq(schema.studioVariations.id, schema.studioVersions.variationId))
    .innerJoin(schema.studioAssets, eq(schema.studioAssets.id, schema.studioVariations.assetId))
    .innerJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioAssets.projectId))
    .where(and(...conds))
    .orderBy(asc(schema.studioAssets.sort), asc(schema.studioVariations.sort), asc(schema.studioVersions.number));
  if (versions.length === 0) throw new StudioError("Nothing to export here.");

  const comments = await db
    .select()
    .from(schema.studioComments)
    .where(and(inArray(schema.studioComments.versionId, versions.map((v) => v.id)), isNull(schema.studioComments.deletedAt)))
    .orderBy(asc(schema.studioComments.createdAt));

  const rows: unknown[][] = [];
  for (const v of versions) {
    const mine = comments.filter((c) => c.versionId === v.id);
    const fps: Fps | null = v.fpsNum && v.fpsDen ? { num: v.fpsNum, den: v.fpsDen } : null;
    for (const root of mine.filter((c) => !c.parentId).sort((a, b) => (a.number ?? 0) - (b.number ?? 0))) {
      const a = readAnnotation(root.annotation);
      const replies = mine.filter((c) => c.parentId === root.id).map((r) => `${r.authorLabel}: ${r.body.replace(/\s+/g, " ")}`).join("\n");
      rows.push([
        v.project,
        v.asset,
        v.variation,
        `v${v.number}`,
        root.number,
        root.resolvedAt ? "Resolved" : "Open",
        root.resolvedByLabel ?? "",
        root.authorLabel,
        root.authorMemberId ? "Studio" : "Client",
        root.createdAt.toISOString(),
        !a ? "General" : a.shape === "rect" ? "Box" : a.shape === "pin" ? "Pin" : "Moment",
        a?.t !== undefined ? formatTimecode(a.t, fps) : "",
        a?.tEnd !== undefined ? formatTimecode(a.tEnd, fps) : "",
        a?.frame ?? "",
        a && a.shape !== "time" ? a.x.toFixed(4) : "",
        a && a.shape !== "time" ? a.y.toFixed(4) : "",
        a?.w !== undefined ? a.w.toFixed(4) : "",
        a?.h !== undefined ? a.h.toFixed(4) : "",
        root.body,
        replies,
        root.internal ? "Yes" : "",
      ]);
    }
  }
  const base = scope.versionId ? `${versions[0]!.asset}-${versions[0]!.variation}-v${versions[0]!.number}` : versions[0]!.project;
  return { csv: toCsv(HEADER, rows), name: `${base.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-")}-comments.csv` };
}

/** Everything the certificate page prints for one version. */
export async function certificateData(orgId: string, versionId: string) {
  const [v] = await db
    .select({
      version: schema.studioVersions,
      file: schema.studioFiles,
      variation: schema.studioVariations.label,
      asset: schema.studioAssets.title,
      assetId: schema.studioAssets.id,
      project: schema.studioProjects,
    })
    .from(schema.studioVersions)
    .innerJoin(schema.studioFiles, eq(schema.studioFiles.id, schema.studioVersions.fileId))
    .innerJoin(schema.studioVariations, eq(schema.studioVariations.id, schema.studioVersions.variationId))
    .innerJoin(schema.studioAssets, eq(schema.studioAssets.id, schema.studioVariations.assetId))
    .innerJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioAssets.projectId))
    .where(and(eq(schema.studioVersions.id, versionId), eq(schema.studioProjects.orgId, orgId)))
    .limit(1);
  if (!v) return null;
  const [client] = await db.select({ name: schema.studioClients.name }).from(schema.studioClients).where(eq(schema.studioClients.id, v.project.clientId)).limit(1);
  const decisions = await db.select().from(schema.studioDecisions).where(eq(schema.studioDecisions.versionId, versionId)).orderBy(asc(schema.studioDecisions.createdAt));
  return { ...v, clientName: client?.name ?? "", decisions };
}
