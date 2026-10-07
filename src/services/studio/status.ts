/**
 * Which version of each variation is "the latest", and what that says about an asset, a project
 * and a client (waiting on the client, or on me). One query, reused by every list screen.
 */
import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { type VersionStatus, rollupAsset, rollupProject, type ProjectRollup } from "@/lib/studio/rounds";

export type LatestVersion = {
  projectId: string;
  assetId: string;
  variationId: string;
  versionId: string;
  number: number;
  status: VersionStatus;
  fileId: string;
  createdAt: Date;
};

/** The newest version of every variation in `orgId`, optionally limited to some projects. */
export async function latestVersions(orgId: string, projectIds?: string[]): Promise<LatestVersion[]> {
  if (projectIds && projectIds.length === 0) return [];
  const filter = projectIds ? sql`and p.id in (${sql.join(projectIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  const res = await db.execute(sql`
    select distinct on (v.variation_id)
      p.id as "projectId", a.id as "assetId", v.variation_id as "variationId", v.id as "versionId",
      v.number, v.status, v.file_id as "fileId", v.created_at as "createdAt"
    from studio_versions v
    join studio_variations va on va.id = v.variation_id
    join studio_assets a on a.id = va.asset_id and a.archived_at is null
    join studio_projects p on p.id = a.project_id
    where p.org_id = ${orgId}::uuid ${filter}
    order by v.variation_id, v.number desc
  `);
  return (res.rows as (Omit<LatestVersion, "createdAt"> & { createdAt: Date | string })[]).map((r) => ({ ...r, number: Number(r.number), createdAt: new Date(r.createdAt) }));
}

/** assetId → status, from the latest version of each variation. */
export function assetStatuses(latest: LatestVersion[]): Map<string, VersionStatus | "empty"> {
  const byAsset = new Map<string, VersionStatus[]>();
  for (const l of latest) byAsset.set(l.assetId, [...(byAsset.get(l.assetId) ?? []), l.status]);
  return new Map([...byAsset].map(([id, s]) => [id, rollupAsset(s)]));
}

export function projectStatus(latest: LatestVersion[], projectId: string, assetIds: string[]): ProjectRollup {
  const statuses = assetStatuses(latest.filter((l) => l.projectId === projectId));
  return rollupProject(assetIds.map((id) => statuses.get(id) ?? "empty"));
}

/** Items waiting on the client (in review) and on the studio (changes requested), counted per asset so two options aren't two waits. */
export function waiting(latest: LatestVersion[], projectId?: string): { onClient: number; onMe: number } {
  const statuses = assetStatuses(projectId ? latest.filter((l) => l.projectId === projectId) : latest);
  let onClient = 0;
  let onMe = 0;
  for (const s of statuses.values()) {
    if (s === "in_review") onClient++;
    if (s === "changes_requested") onMe++;
  }
  return { onClient, onMe };
}

export { STATUS_WORD } from "@/lib/studio/rounds";
