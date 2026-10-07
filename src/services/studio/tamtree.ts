/**
 * Tamtree does the processing (plan §5.3). t-asset tells it a file arrived (`notifyTamtree`), and
 * Tamtree claims the job, reads the original from a signed URL, uploads the renditions to signed
 * targets and reports back. Nothing here is org-scoped: Tamtree acts for the whole app, with its
 * own bearer token checked by the routes.
 */
import "server-only";

import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { getBlobStore, type UploadTarget } from "@/lib/blob";
import { studioEnv } from "@/lib/studio/env";
import { watermarkText } from "@/lib/studio/watermark";
import { type OutputName, type OutputSpec, outputsFor, signWebhook, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/tamtree";

import { deleteBlobs } from "./files";
import { storageUsed } from "./storage";

/** A claim older than this is assumed dead, and the file can be claimed again. */
export const CLAIM_TTL_MS = 30 * 60_000;
/** Retryable failures go back in the queue until this many attempts. */
export const MAX_ATTEMPTS = 3;

type FileRow = typeof schema.studioFiles.$inferSelect;

export class TamtreeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const kindOf = (f: Pick<FileRow, "mime">) => (f.mime.startsWith("video/") ? "video" : "image") as "image" | "video";

const COLUMN: Record<OutputName, "previewKey" | "wmPreviewKey" | "posterKey" | "thumbKey"> = {
  preview: "previewKey",
  wm_preview: "wmPreviewKey",
  poster: "posterKey",
  thumb: "thumbKey",
};

async function fileById(fileId: string): Promise<FileRow> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw new TamtreeError("No such file.", 404);
  const [f] = await db.select().from(schema.studioFiles).where(eq(schema.studioFiles.id, fileId)).limit(1);
  if (!f) throw new TamtreeError("No such file.", 404);
  return f;
}

function jobUrl(fileId: string): string {
  return `${studioEnv().appUrl ?? "http://localhost:3000"}/api/tamtree/files/${fileId}`;
}

/**
 * Tells Tamtree a file is waiting. Never throws and never blocks an upload: a lost delivery is
 * picked up by Tamtree's schedule polling `/api/tamtree/pending`, or by the daily cleanup.
 */
export async function notifyTamtree(fileId: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const { tamtree } = studioEnv();
  if (!tamtree.webhookUrl || !tamtree.webhookSecret) return false;
  try {
    const f = await fileById(fileId);
    const body = JSON.stringify({ event: "file.uploaded", fileId, kind: kindOf(f), jobUrl: jobUrl(fileId) });
    const ts = Math.floor(Date.now() / 1000);
    const res = await fetcher(tamtree.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", [TIMESTAMP_HEADER]: String(ts), [SIGNATURE_HEADER]: signWebhook(tamtree.webhookSecret, ts, body) },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error("[tamtree webhook]", fileId, res.status);
    return res.ok;
  } catch (e) {
    console.error("[tamtree webhook]", fileId, e);
    return false;
  }
}

/** Files waiting for Tamtree: pending, and not claimed (or claimed so long ago the run must have died). Oldest first. */
export async function pendingFiles(limit = 10, now = new Date()) {
  const stale = new Date(now.getTime() - CLAIM_TTL_MS);
  const rows = await db
    .select({ id: schema.studioFiles.id, mime: schema.studioFiles.mime, attempts: schema.studioFiles.attempts, createdAt: schema.studioFiles.createdAt })
    .from(schema.studioFiles)
    .where(and(eq(schema.studioFiles.processing, "pending"), or(isNull(schema.studioFiles.claimedAt), lt(schema.studioFiles.claimedAt, stale))))
    .orderBy(asc(schema.studioFiles.createdAt))
    .limit(Math.min(Math.max(limit, 1), 50));
  return rows.map((r) => ({ fileId: r.id, kind: kindOf(r), attempts: r.attempts, jobUrl: jobUrl(r.id), waitingSince: r.createdAt.toISOString() }));
}

/** Takes a file for one run. A second claim while the first is fresh gets 409, so two runs never do the same work. */
export async function claim(fileId: string, now = new Date()) {
  const stale = new Date(now.getTime() - CLAIM_TTL_MS);
  const [row] = await db
    .update(schema.studioFiles)
    .set({ claimedAt: now, attempts: sql`${schema.studioFiles.attempts} + 1` })
    .where(and(eq(schema.studioFiles.id, fileId), eq(schema.studioFiles.processing, "pending"), or(isNull(schema.studioFiles.claimedAt), lt(schema.studioFiles.claimedAt, stale))))
    .returning({ attempts: schema.studioFiles.attempts });
  if (row) return { fileId, attempts: row.attempts, claimedUntil: new Date(now.getTime() + CLAIM_TTL_MS).toISOString() };
  const f = await fileById(fileId);
  if (f.processing === "pending") throw new TamtreeError("Another run has this file.", 409);
  throw new TamtreeError(`This file is ${f.processing === "uploading" ? "still uploading" : f.processing}, not waiting for processing.`, 409);
}

/** Everything a run needs: the original (as a signed URL, 1 hour), what to make, and the watermark text. */
export async function job(fileId: string) {
  const f = await fileById(fileId);
  const kind = kindOf(f);
  const store = getBlobStore();
  const [brand] = await db.select({ name: schema.studioBrand.studioName }).from(schema.studioBrand).where(eq(schema.studioBrand.orgId, f.orgId)).limit(1);
  return {
    fileId,
    state: f.processing,
    kind,
    mime: f.mime,
    bytes: f.bytes,
    originalName: f.originalName,
    attempts: f.attempts,
    source: f.originalKey ? { url: await store.readUrl(f.originalKey, { validForS: 3600 }), expiresAt: new Date(Date.now() + 3600_000).toISOString() } : null,
    outputs: outputsFor(fileId, kind),
    watermarkText: watermarkText(brand?.name),
  };
}

/** Signed uploads (1 hour) for every output. Refused when the store is already at its cap. */
export async function targets(fileId: string): Promise<{ targets: Record<string, UploadTarget & Pick<OutputSpec, "key" | "contentType" | "maxBytes">> }> {
  const f = await fileById(fileId);
  if (f.processing !== "pending") throw new TamtreeError(`This file is ${f.processing}, not waiting for processing.`, 409);
  const used = await storageUsed(f.orgId);
  if (used.bytes >= used.capBytes) throw new TamtreeError("The studio's storage is full. The owner must delete something first.", 507);
  const store = getBlobStore();
  const out: Record<string, UploadTarget & Pick<OutputSpec, "key" | "contentType" | "maxBytes">> = {};
  for (const o of outputsFor(fileId, kindOf(f))) {
    const t = await store.uploadTarget(o.key, { contentType: o.contentType, maxBytes: o.maxBytes, validForS: 3600 });
    out[o.name] = { ...t, key: o.key, contentType: o.contentType, maxBytes: o.maxBytes };
  }
  return { targets: out };
}

const positiveInt = z.number().int().positive().max(100_000);

export const completeInput = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/i, "sha256 must be 64 hex characters."),
  width: positiveInt,
  height: positiveInt,
  durationS: z.number().positive().max(86_400).nullable().optional(),
  fpsNum: positiveInt.nullable().optional(),
  fpsDen: positiveInt.nullable().optional(),
  outputs: z.record(z.string(), z.object({ key: z.string().min(1).max(300) })),
});

/**
 * The run finished: every output is checked in the store, the metadata saved, and the file made
 * ready. A video's original is then deleted unless KEEP_VIDEO_ORIGINALS=1 (plan §5.3). Calling it
 * again after success changes nothing.
 */
export async function complete(fileId: string, raw: unknown) {
  const input = completeInput.parse(raw);
  const f = await fileById(fileId);
  const kind = kindOf(f);
  const wanted = outputsFor(fileId, kind);
  if (f.processing === "ready") {
    const same = wanted.every((o) => input.outputs[o.name]?.key === f[COLUMN[o.name]]);
    if (same) return { fileId, state: "ready" as const, alreadyDone: true };
    throw new TamtreeError("This file is already ready with other outputs.", 409);
  }
  if (f.processing !== "pending") throw new TamtreeError(`This file is ${f.processing}, not waiting for processing.`, 409);
  if (kind === "video" && (input.durationS == null || input.fpsNum == null || input.fpsDen == null)) throw new TamtreeError("A video needs durationS, fpsNum and fpsDen.", 422);

  const store = getBlobStore();
  const problems: string[] = [];
  let derivedBytes = 0;
  for (const o of wanted) {
    const key = input.outputs[o.name]?.key;
    if (!key) {
      problems.push(`${o.name} is missing`);
      continue;
    }
    if (key !== o.key) {
      problems.push(`${o.name} must be at ${o.key}`);
      continue;
    }
    const h = await store.head(key);
    if (!h) problems.push(`${o.name} was not uploaded`);
    else derivedBytes += h.size;
  }
  if (problems.length) throw new TamtreeError(`Can't finish: ${problems.join("; ")}.`, 422);

  const dropOriginal = kind === "video" && !studioEnv().keepVideoOriginals && !!f.originalKey;
  const keys = Object.fromEntries(wanted.map((o) => [COLUMN[o.name], o.key]));
  const updated = await db
    .update(schema.studioFiles)
    .set({
      ...keys,
      sha256: input.sha256.toLowerCase(),
      width: input.width,
      height: input.height,
      durationS: kind === "video" ? input.durationS! : null,
      fpsNum: kind === "video" ? input.fpsNum! : null,
      fpsDen: kind === "video" ? input.fpsDen! : null,
      derivedBytes,
      processing: "ready",
      error: null,
      claimedAt: null,
      ...(dropOriginal ? { originalKey: null } : {}),
    })
    .where(and(eq(schema.studioFiles.id, fileId), eq(schema.studioFiles.processing, "pending")))
    .returning({ id: schema.studioFiles.id });
  if (updated.length === 0) return complete(fileId, raw); // raced with another completion: answer as that one did
  if (dropOriginal) await deleteBlobs([f.originalKey!]);
  return { fileId, state: "ready" as const, alreadyDone: false };
}

export const failInput = z.object({ message: z.string().trim().min(1).max(500), retryable: z.boolean().default(false) });

/**
 * The run couldn't finish. A retryable failure goes back in the queue until MAX_ATTEMPTS; anything
 * else marks the file failed with the message, which the owner reads next to a Retry button.
 */
export async function fail(fileId: string, raw: unknown) {
  const input = failInput.parse(raw);
  const f = await fileById(fileId);
  if (f.processing !== "pending") throw new TamtreeError(`This file is ${f.processing}, not waiting for processing.`, 409);
  const requeue = input.retryable && f.attempts < MAX_ATTEMPTS;
  await db
    .update(schema.studioFiles)
    .set({ processing: requeue ? "pending" : "failed", error: input.message, claimedAt: null })
    .where(eq(schema.studioFiles.id, fileId));
  return { fileId, state: requeue ? ("pending" as const) : ("failed" as const) };
}

/** The owner's Retry: a failed file goes back to Tamtree with a fresh count. */
export async function retryFile(orgId: string, fileId: string): Promise<void> {
  const rows = await db
    .update(schema.studioFiles)
    .set({ processing: "pending", error: null, claimedAt: null, attempts: 0 })
    .where(and(eq(schema.studioFiles.id, fileId), eq(schema.studioFiles.orgId, orgId), or(eq(schema.studioFiles.processing, "failed"), eq(schema.studioFiles.processing, "pending"))))
    .returning({ id: schema.studioFiles.id });
  if (rows.length === 0) throw new TamtreeError("That file can't be retried.", 409);
}
