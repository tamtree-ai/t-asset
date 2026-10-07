/**
 * Comments (plan §4.4). Two levels: a root (numbered per version, may carry an annotation) and
 * replies to it; a reply can quote another reply in the same thread. The depth cap, the quote rule
 * and the edit window are enforced here, and also by check constraints in the database.
 */
import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { type Annotation, parseAnnotation, readAnnotation } from "@/lib/studio/annotation";
import { StudioError } from "@/lib/studio/errors";

import { logEvent } from "./events";
import { findVersion, loadShareContent, versionOrgScope, whereLabel } from "./room";
import type { ShareRow } from "./access";

export const BODY_MAX = 4000;
export const EDIT_WINDOW_MS = 10 * 60 * 1000;

export type Author = { kind: "member"; memberId: string; label: string } | { kind: "reviewer"; reviewerId: string; label: string };

/** Where a comment lands, and who may see or add to it. `internalAllowed` is true only for the studio. */
export type Scope = { orgId: string; projectId: string; shareId: string | null; versionId: string; where: string; internalAllowed: boolean; commentsOpen: boolean };

export async function ownerScope(orgId: string, versionId: string): Promise<Scope | null> {
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return null;
  const v = await versionOrgScope(orgId, versionId);
  if (!v) return null;
  return { orgId, projectId: v.projectId, shareId: null, versionId, where: `${v.assetTitle} · ${v.label} v${v.number}`, internalAllowed: true, commentsOpen: true };
}

/** The version must be one the share shows. */
export async function guestScope(share: ShareRow, versionId: string): Promise<Scope | null> {
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return null;
  const found = findVersion(await loadShareContent(share), versionId);
  if (!found) return null;
  return { orgId: share.orgId, projectId: share.projectId, shareId: share.id, versionId, where: whereLabel(found), internalAllowed: false, commentsOpen: share.commentsOpen };
}

const bodySchema = z
  .string()
  .transform((s) => s.replace(/\r\n/g, "\n").trim())
  .pipe(z.string().min(1, "Write a comment first.").max(BODY_MAX, `Keep a comment under ${BODY_MAX} characters.`));

function assertOpen(scope: Scope) {
  if (!scope.commentsOpen) throw new StudioError("Comments are paused on this review.");
}

const authorCols = (a: Author) => (a.kind === "member" ? { authorMemberId: a.memberId, authorReviewerId: null } : { authorMemberId: null, authorReviewerId: a.reviewerId });

/** A new root comment, numbered after the highest number the version has ever had (hidden comments keep theirs). */
export async function addRoot(scope: Scope, author: Author, input: { body: string; annotation?: unknown; internal?: boolean }) {
  assertOpen(scope);
  const body = bodySchema.parse(input.body);
  const annotation = parseAnnotation(input.annotation ?? null);
  const internal = !!input.internal;
  if (internal && !scope.internalAllowed) throw new StudioError("Only the studio can leave internal comments.");

  for (let attempt = 1; ; attempt++) {
    try {
      const row = await db.transaction(async (tx) => {
        const [{ next }] = (await tx.select({ next: sql<number>`coalesce(max(${schema.studioComments.number}), 0) + 1` }).from(schema.studioComments).where(and(eq(schema.studioComments.versionId, scope.versionId), isNull(schema.studioComments.parentId)))) as [{ next: number }];
        const [created] = await tx
          .insert(schema.studioComments)
          .values({ versionId: scope.versionId, number: Number(next), ...authorCols(author), authorLabel: author.label, body, annotation: annotation as Record<string, unknown> | null, internal })
          .returning();
        return created!;
      });
      if (!internal) await logEvent({ orgId: scope.orgId, projectId: scope.projectId, shareId: scope.shareId, actorLabel: author.label, type: "comment.added", payload: { where: scope.where, commentId: row.id, versionId: scope.versionId, number: row.number, excerpt: body.slice(0, 160), byStudio: author.kind === "member" } });
      return row;
    } catch (e) {
      const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
      if (code !== "23505" || attempt >= 4) throw e;
    }
  }
}

/** A reply to a root. `quoteId`, if given, must be another reply in the same thread. */
export async function addReply(scope: Scope, author: Author, input: { parentId: string; quoteId?: string | null; body: string }) {
  assertOpen(scope);
  const body = bodySchema.parse(input.body);
  const parent = await getInVersion(scope, input.parentId);
  if (!parent) throw new StudioError("That comment was not found.");
  if (parent.parentId) throw new StudioError("Replies go on the original comment, not on another reply. Use “reply to this” on a reply to quote it.");
  if (parent.internal && !scope.internalAllowed) throw new StudioError("That comment was not found.");
  let quoteId: string | null = null;
  if (input.quoteId) {
    const quote = await getInVersion(scope, input.quoteId);
    if (!quote || quote.parentId !== parent.id) throw new StudioError("You can only quote a reply in the same thread.");
    quoteId = quote.id;
  }
  const [row] = await db
    .insert(schema.studioComments)
    .values({ versionId: scope.versionId, parentId: parent.id, quoteId, ...authorCols(author), authorLabel: author.label, body, internal: parent.internal })
    .returning();
  if (!parent.internal) await logEvent({ orgId: scope.orgId, projectId: scope.projectId, shareId: scope.shareId, actorLabel: author.label, type: "comment.replied", payload: { where: scope.where, commentId: row!.id, parentId: parent.id, versionId: scope.versionId, number: parent.number, excerpt: body.slice(0, 160), byStudio: author.kind === "member" } });
  return row!;
}

async function getInVersion(scope: Scope, commentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(commentId)) return null;
  const [row] = await db.select().from(schema.studioComments).where(and(eq(schema.studioComments.id, commentId), eq(schema.studioComments.versionId, scope.versionId), isNull(schema.studioComments.deletedAt))).limit(1);
  if (!row || (row.internal && !scope.internalAllowed)) return null;
  return row;
}

/** Resolve or reopen a root. Anyone in the review can; the label says who. */
export async function setResolved(scope: Scope, commentId: string, by: string, resolved: boolean) {
  const row = await getInVersion(scope, commentId);
  if (!row || row.parentId) throw new StudioError("That comment was not found.");
  await db.update(schema.studioComments).set(resolved ? { resolvedAt: new Date(), resolvedByLabel: by } : { resolvedAt: null, resolvedByLabel: null }).where(eq(schema.studioComments.id, commentId));
  if (!row.internal) await logEvent({ orgId: scope.orgId, projectId: scope.projectId, shareId: scope.shareId, actorLabel: by, type: resolved ? "comment.resolved" : "comment.reopened", payload: { where: scope.where, commentId, number: row.number } });
}

function isAuthor(row: { authorMemberId: string | null; authorReviewerId: string | null }, a: Author) {
  return a.kind === "member" ? row.authorMemberId === a.memberId : row.authorReviewerId === a.reviewerId;
}

/** Only the author edits, and only for 10 minutes. */
export async function editComment(scope: Scope, author: Author, commentId: string, rawBody: string, now = new Date()) {
  const body = bodySchema.parse(rawBody);
  const row = await getInVersion(scope, commentId);
  if (!row || !isAuthor(row, author)) throw new StudioError("You can only edit your own comments.");
  if (now.getTime() - row.createdAt.getTime() > EDIT_WINDOW_MS) throw new StudioError("Comments can be edited for 10 minutes after they're posted.");
  await db.update(schema.studioComments).set({ body, editedAt: now }).where(eq(schema.studioComments.id, commentId));
}

/** The author removes their own within 10 minutes. A root with replies keeps its place (so #numbers hold) only if hidden by the owner; the author can't delete a thread others replied to. */
export async function deleteOwn(scope: Scope, author: Author, commentId: string, now = new Date()) {
  const row = await getInVersion(scope, commentId);
  if (!row || !isAuthor(row, author)) throw new StudioError("You can only delete your own comments.");
  if (now.getTime() - row.createdAt.getTime() > EDIT_WINDOW_MS) throw new StudioError("Comments can be deleted for 10 minutes after they're posted.");
  if (!row.parentId) {
    const [{ n }] = (await db.select({ n: sql<number>`count(*)` }).from(schema.studioComments).where(and(eq(schema.studioComments.parentId, row.id), isNull(schema.studioComments.deletedAt)))) as [{ n: number }];
    if (Number(n) > 0) throw new StudioError("Others have replied to this comment, so it can't be deleted.");
  }
  await db.update(schema.studioComments).set({ deletedAt: now }).where(eq(schema.studioComments.id, commentId));
}

/** The owner hides any comment (soft delete). It stays in the log. */
export async function hideComment(scope: Scope, byLabel: string, commentId: string) {
  if (!scope.internalAllowed) throw new StudioError("Only the studio can hide comments.");
  const row = await getInVersion(scope, commentId);
  if (!row) throw new StudioError("That comment was not found.");
  await db.update(schema.studioComments).set({ deletedAt: new Date() }).where(eq(schema.studioComments.id, commentId));
  await logEvent({ orgId: scope.orgId, projectId: scope.projectId, shareId: scope.shareId, actorLabel: byLabel, type: "comment.hidden", payload: { where: scope.where, commentId, number: row.number } });
}

export type Viewer = { memberId?: string; reviewerId?: string };

export type CommentView = {
  id: string;
  number: number | null;
  parentId: string | null;
  quote: { id: string; authorLabel: string; excerpt: string } | null;
  authorLabel: string;
  byStudio: boolean;
  body: string;
  annotation: Annotation | null;
  internal: boolean;
  resolved: boolean;
  resolvedByLabel: string | null;
  createdAt: string;
  edited: boolean;
  /** The viewer wrote it and the 10-minute window is open. */
  canEdit: boolean;
  replies: CommentView[];
};

/** The version's threads, oldest root first. Internal comments are included only when the scope allows them. */
export async function listThreads(scope: Scope, viewer: Viewer, now = new Date()): Promise<CommentView[]> {
  const rows = await db.select().from(schema.studioComments).where(and(eq(schema.studioComments.versionId, scope.versionId), isNull(schema.studioComments.deletedAt))).orderBy(asc(schema.studioComments.createdAt));
  const visible = rows.filter((r) => scope.internalAllowed || !r.internal);
  const byId = new Map(visible.map((r) => [r.id, r]));
  const view = (r: (typeof rows)[number]): CommentView => {
    const q = r.quoteId ? byId.get(r.quoteId) : undefined;
    const mine = (viewer.memberId && r.authorMemberId === viewer.memberId) || (viewer.reviewerId && r.authorReviewerId === viewer.reviewerId);
    return {
      id: r.id,
      number: r.number,
      parentId: r.parentId,
      quote: q ? { id: q.id, authorLabel: q.authorLabel, excerpt: q.body.slice(0, 140) } : null,
      authorLabel: r.authorLabel,
      byStudio: !!r.authorMemberId,
      body: r.body,
      annotation: readAnnotation(r.annotation),
      internal: r.internal,
      resolved: !!r.resolvedAt,
      resolvedByLabel: r.resolvedByLabel,
      createdAt: r.createdAt.toISOString(),
      edited: !!r.editedAt,
      canEdit: !!mine && now.getTime() - r.createdAt.getTime() <= EDIT_WINDOW_MS,
      replies: [],
    };
  };
  const roots = visible.filter((r) => !r.parentId).map(view);
  const index = new Map(roots.map((r) => [r.id, r]));
  for (const r of visible) if (r.parentId) index.get(r.parentId)?.replies.push(view(r));
  return roots;
}
