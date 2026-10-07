/** Clients (plan §4.1). Every call takes the caller's orgId and scopes by it. */
import "server-only";

import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { StudioError } from "@/lib/studio/errors";

import { removeFiles } from "./files";
import { latestVersions, waiting } from "./status";

export const clientInput = z.object({
  name: z.string().trim().min(1, "Give the client a name.").max(80, "Keep the client name under 80 characters."),
  company: z.string().trim().max(80).optional().transform((s) => s || null),
  notes: z.string().max(4000, "Keep notes under 4000 characters.").default(""),
  contacts: z
    .array(
      z.object({
        name: z.string().trim().max(80).default(""),
        email: z.string().trim().toLowerCase().max(200).refine((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), "A contact's email doesn't look right."),
        role: z.string().trim().max(60).optional(),
      }),
    )
    .max(20)
    .default([]),
});

export type ClientRow = typeof schema.studioClients.$inferSelect;

export async function createClient(orgId: string, raw: unknown): Promise<ClientRow> {
  const input = clientInput.parse(raw);
  const [row] = await db.insert(schema.studioClients).values({ orgId, ...input }).returning();
  return row!;
}

export async function updateClient(orgId: string, id: string, raw: unknown): Promise<ClientRow> {
  const input = clientInput.parse(raw);
  const [row] = await db.update(schema.studioClients).set({ ...input, updatedAt: new Date() }).where(and(eq(schema.studioClients.id, id), eq(schema.studioClients.orgId, orgId))).returning();
  if (!row) throw new StudioError("That client was not found.");
  return row;
}

export async function setClientArchived(orgId: string, id: string, archived: boolean): Promise<void> {
  const [row] = await db
    .update(schema.studioClients)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(schema.studioClients.id, id), eq(schema.studioClients.orgId, orgId)))
    .returning({ id: schema.studioClients.id });
  if (!row) throw new StudioError("That client was not found.");
}

export async function getClient(orgId: string, id: string): Promise<ClientRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select().from(schema.studioClients).where(and(eq(schema.studioClients.id, id), eq(schema.studioClients.orgId, orgId))).limit(1);
  return row ?? null;
}

export type ClientSummary = ClientRow & { activeProjects: number; waitingOnClient: number; waitingOnMe: number; lastActivity: Date };

/** The /studio list: each client with active projects, items waiting on each side, and the last thing that happened. */
export async function listClients(orgId: string, opts: { q?: string; archived?: boolean } = {}): Promise<ClientSummary[]> {
  const q = opts.q?.trim();
  const where = [eq(schema.studioClients.orgId, orgId), opts.archived ? sql`${schema.studioClients.archivedAt} is not null` : isNull(schema.studioClients.archivedAt)];
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(or(ilike(schema.studioClients.name, like), ilike(schema.studioClients.company, like))!);
  }
  const clients = await db.select().from(schema.studioClients).where(and(...where)).orderBy(desc(schema.studioClients.updatedAt));
  if (clients.length === 0) return [];

  const projects = await db.select({ id: schema.studioProjects.id, clientId: schema.studioProjects.clientId, status: schema.studioProjects.status, archivedAt: schema.studioProjects.archivedAt }).from(schema.studioProjects).where(eq(schema.studioProjects.orgId, orgId));
  const latest = await latestVersions(orgId);
  const events = await db
    .select({ projectId: schema.studioEvents.projectId, at: sql<Date>`max(${schema.studioEvents.createdAt})` })
    .from(schema.studioEvents)
    .where(eq(schema.studioEvents.orgId, orgId))
    .groupBy(schema.studioEvents.projectId);
  const lastByProject = new Map(events.map((e) => [e.projectId, new Date(e.at)]));

  return clients.map((c) => {
    const mine = projects.filter((p) => p.clientId === c.id && !p.archivedAt);
    const ids = new Set(mine.map((p) => p.id));
    const w = waiting(latest.filter((l) => ids.has(l.projectId)));
    const last = [c.updatedAt, ...mine.map((p) => lastByProject.get(p.id)).filter((d): d is Date => !!d)].sort((a, b) => b.getTime() - a.getTime())[0]!;
    return { ...c, activeProjects: mine.filter((p) => p.status === "active").length, waitingOnClient: w.onClient, waitingOnMe: w.onMe, lastActivity: last };
  });
}

/** Deletes the client and everything under it, including the stored files. */
export async function deleteClient(orgId: string, id: string): Promise<void> {
  const client = await getClient(orgId, id);
  if (!client) throw new StudioError("That client was not found.");
  const fileIds = await fileIdsUnder(orgId, { clientId: id });
  await db.delete(schema.studioClients).where(and(eq(schema.studioClients.id, id), eq(schema.studioClients.orgId, orgId)));
  await removeFiles(orgId, fileIds);
}

/** File ids of every version below a client or a project: collected before the delete, because versions point at files without a cascade. */
export async function fileIdsUnder(orgId: string, scope: { clientId?: string; projectId?: string; assetId?: string; variationId?: string; versionId?: string }): Promise<string[]> {
  const conds = [eq(schema.studioProjects.orgId, orgId)];
  if (scope.clientId) conds.push(eq(schema.studioProjects.clientId, scope.clientId));
  if (scope.projectId) conds.push(eq(schema.studioProjects.id, scope.projectId));
  if (scope.assetId) conds.push(eq(schema.studioAssets.id, scope.assetId));
  if (scope.variationId) conds.push(eq(schema.studioVariations.id, scope.variationId));
  if (scope.versionId) conds.push(eq(schema.studioVersions.id, scope.versionId));
  const rows = await db
    .select({ fileId: schema.studioVersions.fileId })
    .from(schema.studioVersions)
    .innerJoin(schema.studioVariations, eq(schema.studioVariations.id, schema.studioVersions.variationId))
    .innerJoin(schema.studioAssets, eq(schema.studioAssets.id, schema.studioVariations.assetId))
    .innerJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioAssets.projectId))
    .where(and(...conds));
  return rows.map((r) => r.fileId);
}
