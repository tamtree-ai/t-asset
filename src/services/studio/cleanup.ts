/**
 * The daily cleanup (plan §5.7), run by Vercel cron. Hobby allows one run a day, so each step is
 * safe to skip a day: uploads abandoned for 24 hours go (with a Review API version made for one), failed blob deletes are tried again, and
 * files Tamtree hasn't picked up in 2 hours get a fresh webhook, and hook deliveries due a retry are sent.
 */
import "server-only";

import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";

import { db, schema } from "@/db";
import { getBlobStore } from "@/lib/blob";

import { deleteBlobs, keysOf } from "./files";
import { sweepDeliveries } from "../hooks/deliver";
import { CLAIM_TTL_MS, notifyTamtree } from "./tamtree";

export async function cleanup(now = new Date(), notify: (fileId: string) => Promise<boolean> = notifyTamtree, sweepHooks: (now: Date) => Promise<{ sent: number; delivered: number; pruned: number }> = sweepDeliveries) {
  const f = schema.studioFiles;

  const abandoned = await db
    .select()
    .from(f)
    .where(and(eq(f.processing, "uploading"), lt(f.createdAt, new Date(now.getTime() - 24 * 3600_000))))
    .limit(200);
  for (const row of abandoned) {
    // A Review API version is made before its bytes arrive; one never completed goes with its file.
    await db.delete(schema.studioVersions).where(eq(schema.studioVersions.fileId, row.id));
    await db.delete(f).where(eq(f.id, row.id));
    await deleteBlobs(keysOf(row));
  }

  const failed = await db.select({ key: schema.deletedBlobs.key }).from(schema.deletedBlobs).limit(100);
  let retried = 0;
  if (failed.length) {
    try {
      await getBlobStore().delete(failed.map((r) => r.key));
      await db.delete(schema.deletedBlobs).where(inArray(schema.deletedBlobs.key, failed.map((r) => r.key)));
      retried = failed.length;
    } catch (e) {
      console.error("[cleanup] blob delete still failing", e);
    }
  }

  const stale = new Date(now.getTime() - CLAIM_TTL_MS);
  const waiting = await db
    .select({ id: f.id })
    .from(f)
    .where(and(eq(f.processing, "pending"), lt(f.createdAt, new Date(now.getTime() - 2 * 3600_000)), or(isNull(f.claimedAt), lt(f.claimedAt, stale))))
    .limit(20);
  let renotified = 0;
  for (const w of waiting) if (await notify(w.id)) renotified++;

  // Hook deliveries that are due a retry (1 h, 6 h, 24 h after a failure): on Vercel Hobby, at most a day late.
  let hooks = { sent: 0, delivered: 0, pruned: 0 };
  try {
    hooks = await sweepHooks(now);
  } catch (e) {
    console.error("[cleanup] hook sweep failed", e);
  }

  return { abandonedUploads: abandoned.length, blobDeletesRetried: retried, renotified, stillWaiting: waiting.length, hooks };
}
