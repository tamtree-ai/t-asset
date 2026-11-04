/**
 * Studio Review files (plan §5.1–5.2). An upload is three steps: `startUpload` makes the
 * `studio_files` row and a signed upload, the browser sends the bytes straight to the store, and
 * `finishUpload` checks they arrived, adds the version and hands the file to Tamtree. An image's
 * watermarked preview and a document's proofs are made by the owner's browser in between, against
 * targets from `renditionTargets` (planning/2026-10-31-tasset-deliverables). Every call takes the
 * caller's `orgId`.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { getBlobStore, safeName } from "@/lib/blob";
import { studioEnv } from "@/lib/studio/env";
import { StudioError } from "@/lib/studio/errors";
import { type BrowserKind, browserOutputs, MAX_DOCUMENT_PAGES, mimeOfKey, type ProofFormat } from "@/lib/studio/renditions";
import { proofFooter, proofText, watermarkText } from "@/lib/studio/watermark";

import { logEvent } from "./events";
import { today } from "./invoices";
import { storageUsed } from "./storage";

export const MAX_IMAGE_BYTES = 30 * 1024 ** 2;
export const MAX_VIDEO_BYTES = 500 * 1024 ** 2;
/** A brand guide. Kept at 100 MB on Hobby, so it is always a single PUT. */
export const MAX_DOCUMENT_BYTES = 100 * 1024 ** 2;
/** Above this the browser uploads in parts (Vercel Blob multipart). */
export const MULTIPART_ABOVE = 100 * 1024 ** 2;

/** Only types every browser shows as they are: an image is reviewed from its original, with no Tamtree step. */
export const IMAGE_TYPES = ["image/png", "image/jpeg"];
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];
export const DOCUMENT_TYPES = ["application/pdf"];

export type AssetKind = "image" | "video" | "document";

const KIND: Record<AssetKind, { types: string[]; max: number; maxLabel: string; one: string; takes: string }> = {
  image: { types: IMAGE_TYPES, max: MAX_IMAGE_BYTES, maxLabel: "30 MB", one: "an image", takes: "a PNG or JPG image" },
  video: { types: VIDEO_TYPES, max: MAX_VIDEO_BYTES, maxLabel: "500 MB", one: "a video", takes: "an MP4, MOV, WebM or MKV video" },
  document: { types: DOCUMENT_TYPES, max: MAX_DOCUMENT_BYTES, maxLabel: "100 MB", one: "a document", takes: "a PDF" },
};

export type Rendition = "original" | "preview" | "poster" | "thumb" | "wm";

/** A StudioError, so an action shows it as it is. */
export class UploadError extends StudioError {}

/** `o/<fileId>/<name>`: the name is kept so a download is saved under it. */
export const originalKeyFor = (fileId: string, name: string) => `o/${fileId}/${safeName(name, "original")}`;
/** Where Tamtree puts a file's renditions. */
export const derivedPrefix = (fileId: string) => `d/${fileId}/`;

type FileRow = typeof schema.studioFiles.$inferSelect;

/** The blob and content type for one rendition of a file; null while it has not been made (or does not exist for this kind). */
export function renditionOf(file: FileRow, r: Rendition): { key: string; mime: string } | null {
  const video = file.mime.startsWith("video/");
  // An image's preview is its original, so it keeps its type; anything made says its type in its extension.
  const of = (key: string | null, made: string) => (key ? { key, mime: key === file.originalKey ? file.mime : (mimeOfKey(key) ?? made) } : null);
  switch (r) {
    case "original":
      // A video whose original was deleted to save space downloads as its clean preview.
      if (file.originalKey) return { key: file.originalKey, mime: file.mime };
      return of(file.previewKey, video ? "video/mp4" : "image/webp");
    case "preview":
      return of(file.previewKey, video ? "video/mp4" : "image/webp");
    case "wm":
      return of(file.wmPreviewKey, video ? "video/mp4" : "image/webp");
    case "poster":
      return of(file.posterKey, "image/jpeg");
    case "thumb":
      return of(file.thumbKey, "image/webp");
  }
}

export async function getFile(orgId: string, fileId: string): Promise<FileRow | null> {
  const [row] = await db.select().from(schema.studioFiles).where(and(eq(schema.studioFiles.id, fileId), eq(schema.studioFiles.orgId, orgId))).limit(1);
  return row ?? null;
}

/** Whether a file of this type can be a version of an asset of this kind. */
const fits = (kind: AssetKind, mime: string) => KIND[kind].types.includes(mime);

/** An image uploaded before its browser made a watermark: every rendition is still the original. */
export const needsWatermark = (f: Pick<FileRow, "mime" | "originalKey" | "wmPreviewKey" | "processing">) =>
  f.processing === "ready" && IMAGE_TYPES.includes(f.mime) && !!f.originalKey && f.wmPreviewKey === f.originalKey;

async function variationTarget(orgId: string, variationId: string) {
  const [target] = await db
    .select({ kind: schema.studioAssets.kind, projectId: schema.studioProjects.id, title: schema.studioAssets.title, label: schema.studioVariations.label, clientName: schema.studioClients.name })
    .from(schema.studioVariations)
    .innerJoin(schema.studioAssets, eq(schema.studioAssets.id, schema.studioVariations.assetId))
    .innerJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioAssets.projectId))
    .innerJoin(schema.studioClients, eq(schema.studioClients.id, schema.studioProjects.clientId))
    .where(and(eq(schema.studioVariations.id, variationId), eq(schema.studioProjects.orgId, orgId)))
    .limit(1);
  return target ?? null;
}

export type StartedUpload = {
  fileId: string;
  key: string;
  driver: "vercel" | "local";
  multipart: boolean;
  /** Local driver: one PUT that uploads the whole file. Vercel Blob: null, and the browser uses the SDK's `uploadPresigned` against `/api/uploads/sign`. */
  target: { method: "PUT"; url: string; headers: Record<string, string> } | null;
};

/** Step 1: checks the file against the variation, the size caps and the storage meter, and reserves a row in state `uploading`. */
export async function startUpload(input: { orgId: string; variationId: string; name: string; mime: string; bytes: number }): Promise<StartedUpload> {
  const target = await variationTarget(input.orgId, input.variationId);
  if (!target) throw new UploadError("That variation was not found.");
  const mime = input.mime.split(";")[0]!.trim().toLowerCase();
  const k = KIND[target.kind];
  if (!fits(target.kind, mime)) throw new UploadError(`This asset takes ${k.takes}, and that file is ${mime || "of an unknown type"}.`);
  if (input.bytes > k.max) throw new UploadError(`That file is over the ${k.maxLabel} limit for ${k.one}.`);
  return reserveFile({ orgId: input.orgId, name: input.name, mime, bytes: input.bytes });
}

/**
 * Checks the size and the storage meter, makes the row in state `uploading` and the upload for it.
 * Shared by versions and deliverables.
 */
export async function reserveFile(input: { orgId: string; name: string; mime: string; bytes: number }): Promise<StartedUpload> {
  if (!Number.isFinite(input.bytes) || input.bytes <= 0) throw new UploadError("That file is empty.");
  const { softCapBytes } = studioEnv();
  const used = await storageUsed(input.orgId);
  if (used.bytes + input.bytes > softCapBytes) {
    throw new UploadError(`There isn't room: ${mb(used.bytes)} of ${mb(softCapBytes)} is used, and this file is ${mb(input.bytes)}. Delete old versions or assets to make space.`);
  }

  const fileId = randomUUID();
  const key = originalKeyFor(fileId, input.name);
  await db.insert(schema.studioFiles).values({ id: fileId, orgId: input.orgId, originalKey: key, originalName: input.name.slice(0, 200) || "upload", mime: input.mime, bytes: input.bytes, processing: "uploading" });

  const store = getBlobStore();
  const multipart = store.driver === "vercel" && input.bytes > MULTIPART_ABOVE;
  const upload = store.driver === "local" ? await store.uploadTarget(key, { contentType: input.mime, maxBytes: input.bytes, validForS: 15 * 60 }) : null;
  return { fileId, key, driver: store.driver, multipart, target: upload && { method: upload.method, url: upload.url, headers: upload.headers } };
}

/** For `/api/uploads/sign` (Vercel Blob multipart): the row an owner may still upload to, or null. */
export async function uploadingFile(orgId: string, fileId: string): Promise<FileRow | null> {
  const f = await getFile(orgId, fileId);
  return f && f.processing === "uploading" ? f : null;
}

/**
 * What the owner's browser measured before sending a file: the hash a sign-off records, and the
 * size (an image's pixels; a document's first proof page). A document also says how many pages.
 */
export type FileFacts = { sha256: string; width: number; height: number; pageCount?: number };

export type RenditionTargets = {
  kind: BrowserKind;
  targets: Record<string, { method: "PUT"; url: string; headers: Record<string, string>; key: string; contentType: string; maxBytes: number }>;
  /** Tiled over an image's preview. */
  watermarkText: string;
  /** Tiled over every proof page of a document, with the footer along its foot. */
  proofText: string;
  footerText: string;
  /** The proof PDF's author. */
  studioName: string;
};

/**
 * Signed PUTs (1 hour) for the renditions the owner's browser makes: a file still uploading, or an
 * image from before Phase 0 that still has no watermark. The keys are the ones `browserOutputs`
 * names, so `finishUpload` knows where to look.
 */
export async function renditionTargets(input: { orgId: string; fileId: string; variationId: string; format: ProofFormat }): Promise<RenditionTargets> {
  const file = await getFile(input.orgId, input.fileId);
  if (!file) throw new UploadError("That upload was not found. Start it again.");
  const target = await variationTarget(input.orgId, input.variationId);
  if (!target) throw new UploadError("That variation was not found.");
  if (target.kind === "video") throw new UploadError("Tamtree makes a video's previews.");
  if (!fits(target.kind, file.mime)) throw new UploadError(`This asset takes ${KIND[target.kind].one}.`);
  if (file.processing !== "uploading") {
    const [v] = await db.select({ id: schema.studioVersions.id }).from(schema.studioVersions).where(and(eq(schema.studioVersions.fileId, file.id), eq(schema.studioVersions.variationId, input.variationId))).limit(1);
    if (!v || !needsWatermark(file)) throw new UploadError("This file already has its previews.");
  }
  const used = await storageUsed(input.orgId);
  if (used.bytes >= used.capBytes) throw new UploadError("The studio's storage is full. Delete old versions or assets to make space.");

  const store = getBlobStore();
  const targets: RenditionTargets["targets"] = {};
  for (const o of browserOutputs(file.id, target.kind, input.format)) {
    const t = await store.uploadTarget(o.key, { contentType: o.contentType, maxBytes: o.maxBytes, validForS: 3600 });
    targets[o.name] = { method: t.method, url: t.url, headers: t.headers, key: o.key, contentType: o.contentType, maxBytes: o.maxBytes };
  }
  const [brand] = await db.select({ name: schema.studioBrand.studioName }).from(schema.studioBrand).where(eq(schema.studioBrand.orgId, input.orgId)).limit(1);
  return { kind: target.kind, targets, watermarkText: watermarkText(brand?.name), proofText: proofText(brand?.name, target.clientName), footerText: proofFooter(target.clientName, today()), studioName: brand?.name ?? "" };
}

/** Every rendition the browser should have made, checked in the store. Throws, naming what's missing. */
async function madeRenditions(fileId: string, kind: BrowserKind, format: ProofFormat): Promise<{ keys: Partial<FileRow>; derivedBytes: number }> {
  const store = getBlobStore();
  const keys: Partial<FileRow> = {};
  const missing: string[] = [];
  let derivedBytes = 0;
  for (const o of browserOutputs(fileId, kind, format)) {
    const h = await store.head(o.key);
    if (!h) {
      missing.push({ preview: "the clean proof", wm_preview: kind === "image" ? "the watermarked preview" : "the watermarked proof", thumb: "the thumbnail", poster: "the poster" }[o.name]);
      continue;
    }
    derivedBytes += h.size;
    keys[({ preview: "previewKey", wm_preview: "wmPreviewKey", thumb: "thumbKey", poster: "posterKey" } as const)[o.name]] = o.key;
  }
  if (missing.length) throw new UploadError(`${missing.join(" and ").replace(/^./, (c) => c.toUpperCase())} didn't arrive. Upload it again.`);
  return { keys, derivedBytes };
}

/**
 * Step 3: the bytes are in the store and the right size, so the file becomes a version. A video
 * waits for Tamtree (state `pending`). An image or a document is ready at once, with the facts the
 * browser measured and the renditions it made. Calling it twice for one file returns the same version.
 */
export async function finishUpload(input: {
  orgId: string;
  memberId: string;
  fileId: string;
  variationId: string;
  changeNote: string;
  facts?: FileFacts;
  /** The format the browser made its pictures in. */
  format?: ProofFormat;
}): Promise<{ fileId: string; versionId: string; number: number; alreadyDone: boolean; ready: boolean }> {
  const file = await getFile(input.orgId, input.fileId);
  if (!file) throw new UploadError("That upload was not found. Start it again.");
  if (file.processing !== "uploading") {
    const [v] = await db.select({ id: schema.studioVersions.id, number: schema.studioVersions.number }).from(schema.studioVersions).where(eq(schema.studioVersions.fileId, file.id)).limit(1);
    if (v) return { fileId: file.id, versionId: v.id, number: v.number, alreadyDone: true, ready: file.processing === "ready" };
    throw new UploadError("That upload was not found. Start it again.");
  }
  const target = await variationTarget(input.orgId, input.variationId);
  if (!target) throw new UploadError("That variation was not found.");
  if (!fits(target.kind, file.mime)) throw new UploadError(`This asset takes ${KIND[target.kind].one}.`);
  const kind = target.kind;
  if (kind !== "video" && !input.facts) throw new UploadError(`The ${kind === "image" ? "image's size" : "document's pages"} and fingerprint are missing. Upload it again.`);
  if (kind === "document" && !(input.facts?.pageCount && input.facts.pageCount >= 1 && input.facts.pageCount <= MAX_DOCUMENT_PAGES)) {
    throw new UploadError(`A document needs between 1 and ${MAX_DOCUMENT_PAGES} pages.`);
  }

  const head = await getBlobStore().head(file.originalKey!);
  if (!head) throw new UploadError("The file didn't arrive. Upload it again.");
  if (head.size !== file.bytes) throw new UploadError(`The file arrived incomplete (${head.size} of ${file.bytes} bytes). Upload it again.`);

  let state: Partial<FileRow> = { processing: "pending" };
  if (kind !== "video" && input.facts) {
    const made = await madeRenditions(file.id, kind, input.format ?? "webp");
    state = {
      processing: "ready",
      ...(kind === "image" ? { previewKey: file.originalKey } : {}),
      ...made.keys,
      derivedBytes: made.derivedBytes,
      sha256: input.facts.sha256.toLowerCase(),
      width: input.facts.width,
      height: input.facts.height,
      pageCount: kind === "document" ? input.facts.pageCount! : null,
    };
  }
  const created = await insertVersion(input, file.id, state);
  await logEvent({ orgId: input.orgId, projectId: target.projectId, actorLabel: "You", type: "version.uploaded", payload: { where: `${target.title} · ${target.label} v${created.number}`, versionId: created.id } });
  return { fileId: file.id, versionId: created.id, number: created.number, alreadyDone: false, ready: state.processing === "ready" };
}

/**
 * For an image from before Phase 0: the owner picked the original again, the browser checked its
 * fingerprint and made the watermark and thumbnail, and this points the file at them.
 */
export async function attachImageRenditions(input: { orgId: string; fileId: string; sha256: string; format: ProofFormat }): Promise<void> {
  const file = await getFile(input.orgId, input.fileId);
  if (!file || !needsWatermark(file)) throw new UploadError("This image already has its watermark.");
  if (file.sha256 && file.sha256 !== input.sha256.toLowerCase()) throw new UploadError("That isn't the same file as this version. Pick the exact file you uploaded.");
  const made = await madeRenditions(file.id, "image", input.format);
  await db
    .update(schema.studioFiles)
    .set({ ...made.keys, derivedBytes: made.derivedBytes })
    .where(and(eq(schema.studioFiles.id, file.id), eq(schema.studioFiles.wmPreviewKey, file.originalKey!)));
}

/** Sets the file's state and adds the next version number, together. Two uploads to one variation at once pick the same number; the unique index rejects the second, which tries again. */
async function insertVersion(input: { memberId: string; variationId: string; changeNote: string }, fileId: string, state: Partial<FileRow>) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        await tx.update(schema.studioFiles).set({ ...state, error: null }).where(eq(schema.studioFiles.id, fileId));
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
