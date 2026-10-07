/** Projects (plan §4.1, §5.2): one campaign for one client, with the rounds the contract includes. */
import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { StudioError } from "@/lib/studio/errors";
import { type DecisionLite, roundsState } from "@/lib/studio/rounds";

import { fileIdsUnder, getClient } from "./clients";
import { removeFiles } from "./files";
import { assetStatuses, latestVersions, projectStatus, waiting } from "./status";

export const projectInput = z.object({
  name: z.string().trim().min(1, "Give the project a name.").max(100, "Keep the project name under 100 characters."),
  dueDate: z
    .string()
    .trim()
    .optional()
    .transform((s) => s || null)
    .refine((s) => s === null || (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))), "The due date should look like 2026-11-30."),
  roundsIncluded: z.coerce.number().int("Rounds must be a whole number.").min(0, "Rounds can't be negative.").max(20, "Twenty rounds is the most t-shoot counts."),
  status: z.enum(["active", "paused", "delivered"]).default("active"),
});

export type ProjectRow = typeof schema.studioProjects.$inferSelect;

export async function createProject(orgId: string, clientId: string, raw: unknown): Promise<ProjectRow> {
  const input = projectInput.parse(raw);
  if (!(await getClient(orgId, clientId))) throw new StudioError("That client was not found.");
  const [row] = await db.insert(schema.studioProjects).values({ orgId, clientId, ...input }).returning();
  return row!;
}

export async function updateProject(orgId: string, id: string, raw: unknown): Promise<ProjectRow> {
  const input = projectInput.parse(raw);
  const [row] = await db.update(schema.studioProjects).set({ ...input, updatedAt: new Date() }).where(and(eq(schema.studioProjects.id, id), eq(schema.studioProjects.orgId, orgId))).returning();
  if (!row) throw new StudioError("That project was not found.");
  return row;
}

export async function setProjectArchived(orgId: string, id: string, archived: boolean): Promise<void> {
  const [row] = await db
    .update(schema.studioProjects)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(schema.studioProjects.id, id), eq(schema.studioProjects.orgId, orgId)))
    .returning({ id: schema.studioProjects.id });
  if (!row) throw new StudioError("That project was not found.");
}

export async function getProject(orgId: string, id: string): Promise<ProjectRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select().from(schema.studioProjects).where(and(eq(schema.studioProjects.id, id), eq(schema.studioProjects.orgId, orgId))).limit(1);
  return row ?? null;
}

export async function deleteProject(orgId: string, id: string): Promise<void> {
  if (!(await getProject(orgId, id))) throw new StudioError("That project was not found.");
  const fileIds = await fileIdsUnder(orgId, { projectId: id });
  await db.delete(schema.studioProjects).where(and(eq(schema.studioProjects.id, id), eq(schema.studioProjects.orgId, orgId)));
  await removeFiles(orgId, fileIds);
}

/** The decisions that count against a project's rounds. */
export async function projectDecisions(orgId: string, projectId: string): Promise<DecisionLite[]> {
  const rows = await db
    .select({ versionId: schema.studioDecisions.versionId, decision: schema.studioDecisions.decision })
    .from(schema.studioDecisions)
    .innerJoin(schema.studioVersions, eq(schema.studioVersions.id, schema.studioDecisions.versionId))
    .innerJoin(schema.studioVariations, eq(schema.studioVariations.id, schema.studioVersions.variationId))
    .innerJoin(schema.studioAssets, eq(schema.studioAssets.id, schema.studioVariations.assetId))
    .innerJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioAssets.projectId))
    .where(and(eq(schema.studioProjects.id, projectId), eq(schema.studioProjects.orgId, orgId)));
  return rows;
}

export async function projectRounds(orgId: string, project: Pick<ProjectRow, "id" | "roundsIncluded">) {
  return roundsState(await projectDecisions(orgId, project.id), project.roundsIncluded);
}

/** A client page's rows: each project with its status, due date and rounds. */
export async function listProjects(orgId: string, clientId: string, opts: { archived?: boolean } = {}) {
  const projects = await db
    .select()
    .from(schema.studioProjects)
    .where(and(eq(schema.studioProjects.orgId, orgId), eq(schema.studioProjects.clientId, clientId), opts.archived ? undefined : isNull(schema.studioProjects.archivedAt)))
    .orderBy(desc(schema.studioProjects.createdAt));
  if (projects.length === 0) return [];
  const ids = projects.map((p) => p.id);
  const [latest, assets] = await Promise.all([
    latestVersions(orgId, ids),
    db.select({ id: schema.studioAssets.id, projectId: schema.studioAssets.projectId }).from(schema.studioAssets).where(isNull(schema.studioAssets.archivedAt)),
  ]);
  return Promise.all(
    projects.map(async (p) => {
      const assetIds = assets.filter((a) => a.projectId === p.id).map((a) => a.id);
      return { ...p, assetCount: assetIds.length, rollup: projectStatus(latest, p.id, assetIds), waiting: waiting(latest, p.id), rounds: await projectRounds(orgId, p) };
    }),
  );
}

/** Everything the project page shows. */
export async function projectOverview(orgId: string, id: string) {
  const project = await getProject(orgId, id);
  if (!project) return null;
  const [client, assets, latest, rounds] = await Promise.all([
    getClient(orgId, project.clientId),
    db.select().from(schema.studioAssets).where(and(eq(schema.studioAssets.projectId, id), isNull(schema.studioAssets.archivedAt))).orderBy(asc(schema.studioAssets.sort), asc(schema.studioAssets.createdAt)),
    latestVersions(orgId, [id]),
    projectRounds(orgId, project),
  ]);
  const assetIds = assets.map((a) => a.id);
  const fileIds = latest.map((l) => l.fileId);
  const [files, variations] = await Promise.all([
    fileIds.length ? db.select({ id: schema.studioFiles.id, processing: schema.studioFiles.processing }).from(schema.studioFiles).where(inArray(schema.studioFiles.id, fileIds)) : [],
    assetIds.length ? db.select({ id: schema.studioVariations.id, assetId: schema.studioVariations.assetId }).from(schema.studioVariations).where(inArray(schema.studioVariations.assetId, assetIds)) : [],
  ]);
  const processing = new Map(files.map((f) => [f.id, f.processing]));
  const statuses = assetStatuses(latest);
  return {
    project,
    client: client!,
    rounds,
    status: projectStatus(latest, id, assetIds),
    waiting: waiting(latest, id),
    assets: assets.map((a) => {
      const top = latest.filter((l) => l.assetId === a.id).sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0] ?? null;
      return {
        ...a,
        variationCount: variations.filter((v) => v.assetId === a.id).length,
        status: statuses.get(a.id) ?? ("empty" as const),
        latest: top ? { versionId: top.versionId, number: top.number, fileId: top.fileId, processing: processing.get(top.fileId) ?? "pending" } : null,
      };
    }),
  };
}
