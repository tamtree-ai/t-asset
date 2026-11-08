/**
 * The Review API (planning/2026-11-08-review-loop, design §2): how a producer such as tamshoot
 * puts work in front of a client and reads what came back. Every function takes the token's
 * `orgId` and never reaches outside it. Creates are idempotent by `externalRef`: sending the same
 * one again returns the existing row (`created: false`), so every call is safe to retry.
 *
 * tasset stays generic (D3): nothing here knows what a skit or a scene is.
 */
import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import type { VersionMeta } from "@/db/schema";
import { getBlobStore, type UploadTarget } from "@/lib/blob";
import { readAnnotation } from "@/lib/studio/annotation";

import { MAX_VARIATIONS } from "./assets";
import { addReply, ownerScope, setResolved } from "./comments";
import { logEvent } from "./events";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, reserveFile, UploadError, VIDEO_TYPES } from "./files";
import { releaseVersions } from "./release";

/** A refusal with an HTTP status and a stable code, turned into `{ error, code }` by the route wrapper. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

const notFound = (what: string) => new ApiError(`${what} was not found.`, 404, "not_found");
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** An upload target lasts this long (design §9: at most an hour). */
export const UPLOAD_VALID_S = 3600;

export const externalRef = z.string().min(1).max(200).regex(/^[\w.:/#-]+$/, "externalRef may hold letters, digits and _ . : / # - only.");
const name = (what: string) => z.string().trim().min(1, `Give the ${what} a name.`).max(120, `Keep the ${what} name under 120 characters.`);

// ── projects ───────────────────────────────────────────────────────────────

const projectInput = z.object({ client: name("client"), project: name("project") });

/** Finds or makes the client and project by name, as `pnpm shorts ingest` always has. */
export async function upsertProject(orgId: string, raw: unknown) {
  const input = projectInput.parse(raw);
  let created = false;
  let [client] = await db.select().from(schema.studioClients).where(and(eq(schema.studioClients.orgId, orgId), eq(schema.studioClients.name, input.client), isNull(schema.studioClients.archivedAt))).orderBy(asc(schema.studioClients.createdAt)).limit(1);
  if (!client) {
    [client] = await db.insert(schema.studioClients).values({ orgId, name: input.client, company: input.client, contacts: [] }).returning();
    created = true;
  }
  let [project] = await db.select().from(schema.studioProjects).where(and(eq(schema.studioProjects.clientId, client!.id), eq(schema.studioProjects.name, input.project), isNull(schema.studioProjects.archivedAt))).orderBy(asc(schema.studioProjects.createdAt)).limit(1);
  if (!project) {
    [project] = await db.insert(schema.studioProjects).values({ orgId, clientId: client!.id, name: input.project }).returning();
    created = true;
  }
  return { projectId: project!.id, clientId: client!.id, created };
}

// ── assets ─────────────────────────────────────────────────────────────────

const assetInput = z.object({
  projectId: z.string().uuid("projectId must be a project id."),
  title: z.string().trim().min(1, "Give it a title.").max(120, "Keep the title under 120 characters."),
  kind: z.enum(["image", "video", "document", "text"]),
  externalRef,
});

async function projectInOrg(orgId: string, projectId: string) {
  const [p] = await db.select().from(schema.studioProjects).where(and(eq(schema.studioProjects.id, projectId), eq(schema.studioProjects.orgId, orgId))).limit(1);
  return p ?? null;
}

async function mainVariation(assetId: string) {
  const [v] = await db.select().from(schema.studioVariations).where(eq(schema.studioVariations.assetId, assetId)).orderBy(asc(schema.studioVariations.sort), asc(schema.studioVariations.createdAt)).limit(1);
  return v ?? (await db.insert(schema.studioVariations).values({ assetId, label: "Main", sort: 0 }).returning())[0]!;
}

/** Finds the asset by `externalRef` in the studio, or makes it (with its "Main" option) in the project. */
export async function upsertAsset(orgId: string, raw: unknown) {
  const input = assetInput.parse(raw);
  if (input.kind === "text") throw new ApiError("Text assets are not available yet.", 422, "not_yet");
  const project = await projectInOrg(orgId, input.projectId);
  if (!project) throw notFound("That project");

  const existing = await assetByRef(orgId, input.externalRef);
  if (existing) {
    if (existing.projectId !== project.id) throw new ApiError("That externalRef belongs to an asset in another project.", 409, "ref_conflict");
    if (existing.kind !== input.kind) throw new ApiError(`That externalRef is a ${existing.kind} asset, not ${input.kind}.`, 409, "kind_conflict");
    return { assetId: existing.id, variationId: (await mainVariation(existing.id)).id, created: false };
  }
  try {
    return await db.transaction(async (tx) => {
      const [{ next }] = (await tx.select({ next: sql<number>`coalesce(max(${schema.studioAssets.sort}), -1) + 1` }).from(schema.studioAssets).where(eq(schema.studioAssets.projectId, project.id))) as [{ next: number }];
      const [asset] = await tx.insert(schema.studioAssets).values({ projectId: project.id, title: input.title, kind: input.kind as "image" | "video" | "document", sort: Number(next), externalRef: input.externalRef }).returning();
      const [variation] = await tx.insert(schema.studioVariations).values({ assetId: asset!.id, label: "Main", sort: 0 }).returning();
      return { assetId: asset!.id, variationId: variation!.id, created: true };
    });
  } catch (e) {
    // Two creates raced; the unique index kept one. Answer with it.
    if (pgCode(e) === "23505") return upsertAsset(orgId, raw);
    throw e;
  }
}

async function assetByRef(orgId: string, ref: string) {
  const [row] = await db
    .select({ id: schema.studioAssets.id, projectId: schema.studioAssets.projectId, kind: schema.studioAssets.kind })
    .from(schema.studioAssets)
    .innerJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioAssets.projectId))
    .where(and(eq(schema.studioProjects.orgId, orgId), eq(schema.studioAssets.externalRef, ref)))
    .orderBy(asc(schema.studioAssets.createdAt))
    .limit(1);
  return row ?? null;
}

async function assetInOrg(orgId: string, assetId: string) {
  if (!isUuid(assetId)) return null;
  const [row] = await db
    .select({ asset: schema.studioAssets, project: schema.studioProjects })
    .from(schema.studioAssets)
    .innerJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioAssets.projectId))
    .where(and(eq(schema.studioAssets.id, assetId), eq(schema.studioProjects.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

// ── versions ───────────────────────────────────────────────────────────────

const FILE_KINDS = {
  image: { types: IMAGE_TYPES, max: MAX_IMAGE_BYTES },
  video: { types: VIDEO_TYPES, max: MAX_VIDEO_BYTES },
} as const;

const versionInput = z.object({
  externalRef,
  changeNote: z.string().max(2000, "Keep the change note under 2000 characters.").default(""),
  variation: z.string().trim().min(1).max(40).optional(),
  meta: z.object({ why: z.string().max(2000).optional(), hook: z.string().max(500).optional(), closing: z.string().max(500).optional(), durationS: z.number().nonnegative().max(86_400).optional() }).strict().optional(),
  builtFrom: z.union([z.string().uuid("builtFrom must be a version id."), z.object({ externalRef })]).optional(),
  internal: z.boolean().default(true),
  text: z.unknown().optional(),
  file: z
    .object({
      name: z.string().trim().min(1).max(200),
      contentType: z.string().trim().min(1).max(100),
      bytes: z.number().int().positive(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/i, "sha256 must be 64 hex characters.").optional(),
    })
    .optional(),
});

type VersionRow = typeof schema.studioVersions.$inferSelect;
type FileRow = typeof schema.studioFiles.$inferSelect;

/** The variation by label (made if new, up to the option cap), or the asset's first. */
async function variationFor(assetId: string, label: string | undefined) {
  if (!label) return mainVariation(assetId);
  const all = await db.select().from(schema.studioVariations).where(eq(schema.studioVariations.assetId, assetId)).orderBy(asc(schema.studioVariations.sort));
  const found = all.find((v) => v.label === label);
  if (found) return found;
  if (all.length >= MAX_VARIATIONS) throw new ApiError(`An asset holds up to ${MAX_VARIATIONS} options.`, 422, "too_many_variations");
  const [v] = await db.insert(schema.studioVariations).values({ assetId, label, sort: Math.max(-1, ...all.map((x) => x.sort)) + 1 }).returning();
  return v!;
}

/** `builtFrom` as a version id in the same project, or a 422 naming why not. */
async function resolveBuiltFrom(orgId: string, projectId: string, ref: string | { externalRef: string } | undefined): Promise<string | null> {
  if (!ref) return null;
  const base = db
    .select({ id: schema.studioVersions.id, projectId: schema.studioAssets.projectId })
    .from(schema.studioVersions)
    .innerJoin(schema.studioVariations, eq(schema.studioVariations.id, schema.studioVersions.variationId))
    .innerJoin(schema.studioAssets, eq(schema.studioAssets.id, schema.studioVariations.assetId))
    .innerJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioAssets.projectId));
  const rows =
    typeof ref === "string"
      ? await base.where(and(eq(schema.studioProjects.orgId, orgId), eq(schema.studioVersions.id, ref))).limit(2)
      : await base.where(and(eq(schema.studioProjects.orgId, orgId), eq(schema.studioAssets.projectId, projectId), eq(schema.studioVersions.externalRef, ref.externalRef))).limit(2);
  if (rows.length === 0) throw new ApiError("builtFrom names a version that was not found.", 422, "built_from_not_found");
  if (rows.length > 1) throw new ApiError("builtFrom's externalRef matches more than one version in this project; send the version id.", 422, "built_from_ambiguous");
  if (rows[0]!.projectId !== projectId) throw new ApiError("builtFrom must be a version in the same project.", 422, "built_from_other_project");
  return rows[0]!.id;
}

export type CreatedVersion = { versionId: string; number: number; status: VersionRow["status"]; processing: FileRow["processing"]; created: boolean; upload?: UploadTarget };

/**
 * A new version on the asset. File kinds: the row is made at once, internal and `uploading`, with a
 * signed PUT for the bytes; `completeVersion` then hands it to Tamtree. Sending the same
 * `externalRef` again returns that version, with a fresh upload target if its bytes never arrived.
 */
export async function createVersion(orgId: string, assetId: string, raw: unknown): Promise<CreatedVersion> {
  const input = versionInput.parse(raw);
  const owned = await assetInOrg(orgId, assetId);
  if (!owned) throw notFound("That asset");
  const { asset, project } = owned;
  if (input.text !== undefined) throw new ApiError("Text versions are not available yet.", 422, "not_yet");
  if (asset.kind === "document") throw new ApiError("Documents are uploaded from the studio for now: their proofs are made in the browser.", 422, "not_yet");
  if (!input.file) throw new ApiError(`A ${asset.kind} version needs a file.`, 422, "file_required");

  const variation = await variationFor(asset.id, input.variation);
  const again = await versionByRef(variation.id, input.externalRef);
  if (again) return answerExisting(again.version, again.file);

  const kind = FILE_KINDS[asset.kind];
  const mime = input.file.contentType.split(";")[0]!.trim().toLowerCase();
  if (!(kind.types as readonly string[]).includes(mime)) throw new ApiError(`This ${asset.kind} asset takes ${kind.types.join(", ")}; the file is ${mime}.`, 422, "wrong_type");
  if (input.file.bytes > kind.max) throw new ApiError(`The file is over the ${Math.round(kind.max / 1024 ** 2)} MB limit for a ${asset.kind}.`, 413, "too_large");
  const builtFromVersionId = await resolveBuiltFrom(orgId, project.id, input.builtFrom);

  let reserved;
  try {
    reserved = await reserveFile({ orgId, name: input.file.name, mime, bytes: input.file.bytes });
  } catch (e) {
    if (e instanceof UploadError) throw new ApiError(e.message, 413, "storage_full");
    throw e;
  }
  const meta: VersionMeta = { source: "api", ...input.meta, ...(input.internal ? {} : { releaseOnComplete: true }) };
  let version: VersionRow;
  try {
    version = await insertVersion({ variationId: variation.id, fileId: reserved.fileId, changeNote: input.changeNote.trim(), externalRef: input.externalRef, builtFromVersionId, meta });
  } catch (e) {
    await db.delete(schema.studioFiles).where(eq(schema.studioFiles.id, reserved.fileId));
    const raced = pgCode(e) === "23505" ? await versionByRef(variation.id, input.externalRef) : null;
    if (raced) return answerExisting(raced.version, raced.file);
    throw e;
  }
  const upload = await getBlobStore().uploadTarget(reserved.key, { contentType: mime, maxBytes: input.file.bytes, validForS: UPLOAD_VALID_S });
  return { versionId: version.id, number: version.number, status: version.status, processing: "uploading", created: true, upload };
}

async function answerExisting(version: VersionRow, file: FileRow): Promise<CreatedVersion> {
  const out: CreatedVersion = { versionId: version.id, number: version.number, status: version.status, processing: file.processing, created: false };
  if (file.processing === "uploading" && file.originalKey) out.upload = await getBlobStore().uploadTarget(file.originalKey, { contentType: file.mime, maxBytes: file.bytes, validForS: UPLOAD_VALID_S });
  return out;
}

async function versionByRef(variationId: string, ref: string) {
  const [row] = await db
    .select({ version: schema.studioVersions, file: schema.studioFiles })
    .from(schema.studioVersions)
    .innerJoin(schema.studioFiles, eq(schema.studioFiles.id, schema.studioVersions.fileId))
    .where(and(eq(schema.studioVersions.variationId, variationId), eq(schema.studioVersions.externalRef, ref)))
    .limit(1);
  return row ?? null;
}

/** The next number on the variation; a race on the number retries, a race on the ref throws for the caller. */
async function insertVersion(v: { variationId: string; fileId: string; changeNote: string; externalRef: string; builtFromVersionId: string | null; meta: VersionMeta }): Promise<VersionRow> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [next] = await tx.select({ n: sql<number>`coalesce(max(${schema.studioVersions.number}), 0) + 1` }).from(schema.studioVersions).where(eq(schema.studioVersions.variationId, v.variationId));
        const [row] = await tx
          .insert(schema.studioVersions)
          .values({ variationId: v.variationId, number: Number(next!.n), fileId: v.fileId, changeNote: v.changeNote, externalRef: v.externalRef, builtFromVersionId: v.builtFromVersionId, meta: v.meta, releasedAt: null })
          .returning();
        return row!;
      });
    } catch (e) {
      const numberRace = pgCode(e) === "23505" && /number/.test(String((e as { constraint?: string; cause?: { constraint?: string } }).constraint ?? (e as { cause?: { constraint?: string } }).cause?.constraint ?? ""));
      if (!numberRace || attempt >= 4) throw e;
    }
  }
}

async function versionInOrg(orgId: string, versionId: string) {
  if (!isUuid(versionId)) return null;
  const [row] = await db
    .select({ version: schema.studioVersions, file: schema.studioFiles, variation: schema.studioVariations, asset: schema.studioAssets, project: schema.studioProjects })
    .from(schema.studioVersions)
    .innerJoin(schema.studioFiles, eq(schema.studioFiles.id, schema.studioVersions.fileId))
    .innerJoin(schema.studioVariations, eq(schema.studioVariations.id, schema.studioVersions.variationId))
    .innerJoin(schema.studioAssets, eq(schema.studioAssets.id, schema.studioVariations.assetId))
    .innerJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioAssets.projectId))
    .where(and(eq(schema.studioVersions.id, versionId), eq(schema.studioProjects.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

/**
 * The bytes are in the store: checks their size and type, hands the file to Tamtree (`notify`, run
 * after the response by the route) and, if the version was created with `internal: false`,
 * releases it. Calling it again answers with the current state.
 */
export async function completeVersion(orgId: string, versionId: string): Promise<{ version: VersionView; notifyFileId: string | null }> {
  const row = await versionInOrg(orgId, versionId);
  if (!row) throw notFound("That version");
  const { version, file } = row;
  if (file.processing !== "uploading") return { version: await getVersion(orgId, versionId), notifyFileId: null };

  const head = await getBlobStore().head(file.originalKey!);
  if (!head) throw new ApiError("The file has not arrived. PUT it to the upload target first.", 409, "not_uploaded");
  if (head.size !== file.bytes) throw new ApiError(`The file arrived incomplete (${head.size} of ${file.bytes} bytes). Upload it again.`, 409, "incomplete");
  const ct = head.contentType.split(";")[0]!.trim().toLowerCase();
  if (ct !== file.mime && ct !== "application/octet-stream") throw new ApiError(`The file arrived as ${ct}, not ${file.mime}.`, 409, "wrong_type");

  const moved = await db
    .update(schema.studioFiles)
    .set({ processing: "pending", error: null })
    .where(and(eq(schema.studioFiles.id, file.id), eq(schema.studioFiles.processing, "uploading")))
    .returning({ id: schema.studioFiles.id });
  if (moved.length === 0) return { version: await getVersion(orgId, versionId), notifyFileId: null };

  await logEvent({ orgId, projectId: row.project.id, actorLabel: "API", type: "version.uploaded", payload: { where: `${row.asset.title} · ${row.variation.label} v${version.number}`, versionId } });
  if (version.meta.releaseOnComplete && !version.releasedAt) await releaseVersions(orgId, [versionId]);
  return { version: await getVersion(orgId, versionId), notifyFileId: file.id };
}

/** Internal → visible to the client. A version whose bytes are still on the way can't be released. */
export async function releaseVersion(orgId: string, versionId: string): Promise<VersionView> {
  const row = await versionInOrg(orgId, versionId);
  if (!row) throw notFound("That version");
  if (row.file.processing === "uploading") throw new ApiError("The file has not been completed yet. Call complete first.", 409, "not_uploaded");
  if (!row.version.releasedAt) await releaseVersions(orgId, [versionId]);
  return getVersion(orgId, versionId);
}

export type VersionView = {
  id: string;
  assetId: string;
  externalRef: string | null;
  number: number;
  status: VersionRow["status"];
  released: boolean;
  processing: FileRow["processing"];
  decision: { kind: "approved" | "changes_requested"; by: string; at: string; note: string | null } | null;
  builtFrom: { versionId: string; assetId: string; assetTitle: string; number: number } | null;
};

export async function getVersion(orgId: string, versionId: string): Promise<VersionView> {
  const row = await versionInOrg(orgId, versionId);
  if (!row) throw notFound("That version");
  const [d] = await db.select().from(schema.studioDecisions).where(eq(schema.studioDecisions.versionId, versionId)).orderBy(desc(schema.studioDecisions.createdAt)).limit(1);
  let builtFrom: VersionView["builtFrom"] = null;
  if (row.version.builtFromVersionId) {
    const src = await versionInOrg(orgId, row.version.builtFromVersionId);
    if (src) builtFrom = { versionId: src.version.id, assetId: src.asset.id, assetTitle: src.asset.title, number: src.version.number };
  }
  return {
    id: row.version.id,
    assetId: row.asset.id,
    externalRef: row.version.externalRef,
    number: row.version.number,
    status: row.version.status,
    released: !!row.version.releasedAt,
    processing: row.file.processing,
    decision: d ? { kind: d.decision, by: d.signedName, at: d.createdAt.toISOString(), note: d.note } : null,
    builtFrom,
  };
}

// ── comments ───────────────────────────────────────────────────────────────

export type ApiComment = { id: string; number: number | null; parentId: string | null; author: string; byStudio: boolean; body: string; annotation: unknown; internal: boolean; resolved: boolean; createdAt: string };

/** Roots and replies on the version, oldest first; `since` keeps only those made after it. Hidden ones are left out. */
export async function listComments(orgId: string, versionId: string, since?: string | null): Promise<ApiComment[]> {
  if (!(await versionInOrg(orgId, versionId))) throw notFound("That version");
  let after: Date | null = null;
  if (since) {
    after = new Date(since);
    if (Number.isNaN(after.getTime())) throw new ApiError("since must be an ISO time.", 400, "bad_since");
  }
  const c = schema.studioComments;
  const rows = await db
    .select()
    .from(c)
    // Postgres keeps microseconds and an ISO cursor only milliseconds: compare at the cursor's precision, or the last row comes back again.
    .where(and(eq(c.versionId, versionId), isNull(c.deletedAt), ...(after ? [sql`date_trunc('milliseconds', ${c.createdAt}) > ${after.toISOString()}::timestamptz`] : [])))
    .orderBy(asc(c.createdAt));
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    parentId: r.parentId,
    author: r.authorLabel,
    byStudio: !!r.authorMemberId,
    body: r.body,
    annotation: readAnnotation(r.annotation),
    internal: r.internal,
    resolved: !!r.resolvedAt,
    createdAt: r.createdAt.toISOString(),
  }));
}

const replyInput = z.object({ body: z.string(), resolve: z.boolean().default(false) });

/**
 * A reply from the studio ("Changed in v2"), posted as the studio's owner under the studio's name.
 * A reply to a reply lands on its thread's root. `resolve` also resolves the thread.
 */
export async function replyToComment(orgId: string, commentId: string, raw: unknown) {
  const input = replyInput.parse(raw);
  if (!isUuid(commentId)) throw notFound("That comment");
  const [target] = await db.select().from(schema.studioComments).where(and(eq(schema.studioComments.id, commentId), isNull(schema.studioComments.deletedAt))).limit(1);
  if (!target) throw notFound("That comment");
  const scope = await ownerScope(orgId, target.versionId);
  if (!scope) throw notFound("That comment");
  const rootId = target.parentId ?? target.id;
  const author = await studioAuthor(orgId);
  const reply = await addReply(scope, author, { parentId: rootId, body: input.body });
  if (input.resolve) await setResolved(scope, rootId, author.label, true);
  return { id: reply.id, parentId: rootId, resolved: input.resolve };
}

async function studioAuthor(orgId: string) {
  const [m] = await db.select().from(schema.members).where(eq(schema.members.orgId, orgId)).orderBy(sql`${schema.members.role} = 'owner' desc`, asc(schema.members.createdAt)).limit(1);
  if (!m) throw new ApiError("The studio has no members.", 500, "no_member");
  const [brand] = await db.select({ name: schema.studioBrand.studioName }).from(schema.studioBrand).where(eq(schema.studioBrand.orgId, orgId)).limit(1);
  return { kind: "member" as const, memberId: m.id, label: brand?.name || m.name || "Studio" };
}

function pgCode(e: unknown): string | undefined {
  return (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
}
