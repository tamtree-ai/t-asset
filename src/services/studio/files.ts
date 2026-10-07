/**
 * Studio Review files (plan §5.1–5.2). An upload is three steps: `startUpload` makes the
 * `studio_files` row and a signed upload, the browser sends the bytes straight to the store, and
 * `finishUpload` checks they arrived, adds the version and hands the file to Tamtree. Every call
 * takes the caller's `orgId`.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { getBlobStore, safeName } from "@/lib/blob";
import { studioEnv } from "@/lib/studio/env";

import { logEvent } from "./events";
import { storageUsed } from "./storage";

export const MAX_IMAGE_BYTES = 30 * 1024 ** 2;
export const MAX_VIDEO_BYTES = 500 * 1024 ** 2;
/** Above this the browser uploads in parts (Vercel Blob multipart). */
export const MULTIPART_ABOVE = 100 * 1024 ** 2;

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/tiff"];
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];

export type Rendition = "original" | "preview" | "poster" | "thumb" | "wm";

export class UploadError extends Error {}

/** `o/<fileId>/<name>`: the name is kept so a download is saved under it. */
export const originalKeyFor = (fileId: string, name: string) => `o/${fileId}/${safeName(name, "original")}`;
/** Where Tamtree puts a file's renditions. */
export const derivedPrefix = (fileId: string) => `d/${fileId}/`;

type FileRow = typeof schema.studioFiles.$inferSelect;

/** The blob and content type for one rendition of a file; null while it has not been made (or does not exist for this kind). */
export function renditionOf(file: FileRow, r: Rendition): { key: string; mime: string } | null {
  const video = file.mime.startsWith("video/");
  switch (r) {
    case "original":
      // A video whose original was deleted to save space downloads as its clean preview.
      if (file.originalKey) return { key: file.originalKey, mime: file.mime };
      return file.previewKey ? { key: file.previewKey, mime: video ? "video/mp4" : "image/webp" } : null;
    case "preview":
      return file.previewKey ? { key: file.previewKey, mime: video ? "video/mp4" : "image/webp" } : null;
    case "wm":
      return file.wmPreviewKey ? { key: file.wmPreviewKey, mime: video ? "video/mp4" : "image/webp" } : null;
    case "poster":
      return file.posterKey ? { key: file.posterKey, mime: "image/jpeg" } : null;
    case "thumb":
      return file.thumbKey ? { key: file.thumbKey, mime: "image/webp" } : null;
  }
}

export async function getFile(orgId: string, fileId: string): Promise<FileRow | null> {
  const [row] = await db.select().from(schema.studioFiles).where(and(eq(schema.studioFiles.id, fileId), eq(schema.studioFiles.orgId, orgId))).limit(1);
  return row ?? null;
}

async function variationTarget(orgId: string, variationId: string) {
  const [target] = await db
    .select({ kind: schema.studioAssets.kind, projectId: schema.studioProjects.id, title: schema.studioAssets.title, label: schema.studioVariations.label })
    .from(schema.studioVariations)
    .innerJoin(schema.studioAssets, eq(schema.studioAssets.id, schema.studioVariations.assetId))
    .innerJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioAssets.projectId))
    .where(and(eq(schema.studioVariations.id, variationId), eq(schema.studioProjects.orgId, orgId)))
    .limit(1);
  return target ?? null;
}

export type StartedUpload = {
  fileId: string;
  key: string;
  driver: "vercel" | "local";
  multipart: boolean;
  /** One PUT that uploads the whole file; null when the browser uploads in parts through `/api/uploads/sign`. */
  target: { method: "PUT"; url: string; headers: Record<string, string> } | null;
};

/** Step 1: checks the file against the variation, the size caps and the storage meter, and reserves a row in state `uploading`. */
export async function startUpload(input: { orgId: string; variationId: string; name: string; mime: string; bytes: number }): Promise<StartedUpload> {
  const target = await variationTarget(input.orgId, input.variationId);
  if (!target) throw new UploadError("That variation was not found.");
  const mime = input.mime.split(";")[0]!.trim().toLowerCase();
  const types = target.kind === "image" ? IMAGE_TYPES : VIDEO_TYPES;
  if (!types.includes(mime)) {
    throw new UploadError(
      target.kind === "image"
        ? `This asset takes a PNG, JPG, WebP, GIF, AVIF or TIFF image, and that file is ${mime || "of an unknown type"}.`
        : `This asset takes an MP4, MOV, WebM or MKV video, and that file is ${mime || "of an unknown type"}.`,
    );
  }
  const max = target.kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (!Number.isFinite(input.bytes) || input.bytes <= 0) throw new UploadError("That file is empty.");
  if (input.bytes > max) throw new UploadError(`That file is over the ${target.kind === "image" ? "30 MB" : "500 MB"} limit for ${target.kind === "image" ? "an image" : "a video"}.`);

  const { softCapBytes } = studioEnv();
  const used = await storageUsed(input.orgId);
  if (used.bytes + input.bytes > softCapBytes) {
    throw new UploadError(`There isn't room: ${mb(used.bytes)} of ${mb(softCapBytes)} is used, and this file is ${mb(input.bytes)}. Delete old versions or assets to make space.`);
  }

  const fileId = randomUUID();
  const key = originalKeyFor(fileId, input.name);
  await db.insert(schema.studioFiles).values({ id: fileId, orgId: input.orgId, originalKey: key, originalName: input.name.slice(0, 200) || "upload", mime, bytes: input.bytes, processing: "uploading" });

  const store = getBlobStore();
  const multipart = store.driver === "vercel" && input.bytes > MULTIPART_ABOVE;
  const upload = multipart ? null : await store.uploadTarget(key, { contentType: mime, maxBytes: input.bytes, validForS: 15 * 60 });
  return { fileId, key, driver: store.driver, multipart, target: upload && { method: upload.method, url: upload.url, headers: upload.headers } };
}

/** For `/api/uploads/sign` (Vercel Blob multipart): the row an owner may still upload to, or null. */
export async function uploadingFile(orgId: string, fileId: string): Promise<FileRow | null> {
  const f = await getFile(orgId, fileId);
  return f && f.processing === "uploading" ? f : null;
}

/**
 * Step 3: the bytes are in the store and the right size, so the file becomes a version (state
 * `pending`) for Tamtree to process. Calling it twice for one file returns the same version.
 */
export async function finishUpload(input: { orgId: string; memberId: string; fileId: string; variationId: string; changeNote: string }): Promise<{ fileId: string; versionId: string; number: number; alreadyDone: boolean }> {
  const file = await getFile(input.orgId, input.fileId);
  if (!file) throw new UploadError("That upload was not found. Start it again.");
  if (file.processing !== "uploading") {
    const [v] = await db.select({ id: schema.studioVersions.id, number: schema.studioVersions.number }).from(schema.studioVersions).where(eq(schema.studioVersions.fileId, file.id)).limit(1);
    if (v) return { fileId: file.id, versionId: v.id, number: v.number, alreadyDone: true };
    throw new UploadError("That upload was not found. Start it again.");
  }
  const target = await variationTarget(input.orgId, input.variationId);
  if (!target) throw new UploadError("That variation was not found.");
  if (!file.mime.startsWith(`${target.kind}/`)) throw new UploadError(`This asset takes ${target.kind === "image" ? "an image" : "a video"}.`);

  const head = await getBlobStore().head(file.originalKey!);
  if (!head) throw new UploadError("The file didn't arrive. Upload it again.");
  if (head.size !== file.bytes) throw new UploadError(`The file arrived incomplete (${head.size} of ${file.bytes} bytes). Upload it again.`);

  const created = await insertVersion(input, file.id);
  await logEvent({ orgId: input.orgId, projectId: target.projectId, actorLabel: "You", type: "version.uploaded", payload: { where: `${target.title} · ${target.label} v${created.number}`, versionId: created.id } });
  return { fileId: file.id, versionId: created.id, number: created.number, alreadyDone: false };
}

/** Marks the file `pending` and adds the next version number, together. Two uploads to one variation at once pick the same number; the unique index rejects the second, which tries again. */
async function insertVersion(input: { memberId: string; variationId: string; changeNote: string }, fileId: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        await tx.update(schema.studioFiles).set({ processing: "pending", error: null }).where(eq(schema.studioFiles.id, fileId));
        const [next] = await tx
          .select({ n: sql<number>`coalesce(max(${schema.studioVersions.number}), 0) + 1` })
          .from(schema.studioVersions)
          .where(eq(schema.studioVersions.variationId, input.variationId));
        const [version] = await tx
          .insert(schema.studioVersions)
          .values({ variationId: input.variationId, number: Number(next!.n), fileId, changeNote: input.changeNote.slice(0, 2000), createdBy: input.memberId })
          .returning({ id: schema.studioVersions.id, number: schema.studioVersions.number });
        return version!;
      });
    } catch (e) {
      const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
      if (code !== "23505" || attempt >= 4) throw e;
    }
  }
}

/** Every blob key a file row points at. */
export function keysOf(f: FileRow): string[] {
  return [...new Set([f.originalKey, f.previewKey, f.thumbKey, f.posterKey, f.wmPreviewKey].filter((k): k is string => !!k))];
}

/**
 * Deletes blobs, remembering any that fail in `deleted_blobs` so the daily cleanup retries them.
 * Never throws: a row is already gone by the time its blobs are removed.
 */
export async function deleteBlobs(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await getBlobStore().delete(keys);
    await db.delete(schema.deletedBlobs).where(inArray(schema.deletedBlobs.key, keys));
  } catch (e) {
    console.error("[blob delete]", e);
    await db
      .insert(schema.deletedBlobs)
      .values(keys.map((key) => ({ key })))
      .onConflictDoUpdate({ target: schema.deletedBlobs.key, set: { attempts: sql`${schema.deletedBlobs.attempts} + 1`, failedAt: new Date() } });
  }
}

/** Deletes file rows (org-scoped) and every blob they point at. A row a version still points at is kept (foreign key), so call this after the versions are gone. */
export async function removeFiles(orgId: string, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return;
  const rows = await db.select().from(schema.studioFiles).where(and(eq(schema.studioFiles.orgId, orgId), inArray(schema.studioFiles.id, fileIds)));
  for (const f of rows) {
    try {
      await db.delete(schema.studioFiles).where(eq(schema.studioFiles.id, f.id));
    } catch {
      continue; // still in use
    }
    await deleteBlobs(keysOf(f));
  }
}

const mb = (n: number) => `${Math.round(n / 1024 ** 2)} MB`;
