/** The activity log (plan §5.2). Written by every service that changes something a client or the studio should see; the notifier batches from it. */
import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "@/db";

export type EventType =
  | "share.created"
  | "share.revoked"
  | "version.uploaded"
  | "comment.added"
  | "comment.replied"
  | "comment.resolved"
  | "comment.reopened"
  | "comment.hidden"
  | "decision.approved"
  | "decision.changes_requested"
  | "reviewer.joined"
  | "share.opened";

type Db = Pick<typeof db, "insert">;

export async function logEvent(
  e: { orgId: string; projectId?: string | null; shareId?: string | null; actorLabel: string; type: EventType; payload?: Record<string, unknown> },
  conn: Db = db,
): Promise<void> {
  await conn.insert(schema.studioEvents).values({ orgId: e.orgId, projectId: e.projectId ?? null, shareId: e.shareId ?? null, actorLabel: e.actorLabel, type: e.type, payload: e.payload ?? {} });
}

export async function listEvents(orgId: string, scope: { projectId?: string; shareId?: string }, limit = 50) {
  const where = [eq(schema.studioEvents.orgId, orgId)];
  if (scope.projectId) where.push(eq(schema.studioEvents.projectId, scope.projectId));
  if (scope.shareId) where.push(eq(schema.studioEvents.shareId, scope.shareId));
  return db.select().from(schema.studioEvents).where(and(...where)).orderBy(desc(schema.studioEvents.createdAt)).limit(limit);
}

/** One line for the feed: "Sam commented on #3 · Banner v2". */
export function describeEvent(e: { type: string; actorLabel: string; payload: Record<string, unknown> }): string {
  const p = e.payload;
  const where = typeof p.where === "string" && p.where ? ` on ${p.where}` : "";
  switch (e.type) {
    case "share.created":
      return `${e.actorLabel} created the review link${typeof p.title === "string" ? ` “${p.title}”` : ""}`;
    case "share.revoked":
      return `${e.actorLabel} ended the review link`;
    case "share.opened":
      return `${e.actorLabel} opened the review link`;
    case "version.uploaded":
      return `${e.actorLabel} uploaded${where}`;
    case "comment.added":
      return `${e.actorLabel} commented${where}`;
    case "comment.replied":
      return `${e.actorLabel} replied${where}`;
    case "comment.resolved":
      return `${e.actorLabel} resolved a comment${where}`;
    case "comment.reopened":
      return `${e.actorLabel} reopened a comment${where}`;
    case "comment.hidden":
      return `${e.actorLabel} hid a comment${where}`;
    case "decision.approved":
      return `${e.actorLabel} approved${where}`;
    case "decision.changes_requested":
      return `${e.actorLabel} requested changes${where}`;
    case "reviewer.joined":
      return `${e.actorLabel} joined the review`;
    default:
      return `${e.actorLabel}: ${e.type}`;
  }
}
