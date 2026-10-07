/**
 * The storage meter (plan §5.6). Vercel Blob's free store is 1 GB and going over blocks it for 30
 * days, so the app counts what it has stored (originals still kept, plus everything Tamtree made,
 * plus uploads in flight) and refuses anything past `BLOB_SOFT_CAP_BYTES`.
 */
import "server-only";

import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { studioEnv } from "@/lib/studio/env";

export async function storageUsed(orgId: string): Promise<{ bytes: number; capBytes: number; files: number }> {
  const f = schema.studioFiles;
  const [row] = await db
    .select({
      bytes: sql<string>`coalesce(sum(case when ${f.originalKey} is not null then ${f.bytes} else 0 end + ${f.derivedBytes}), 0)`,
      files: sql<string>`count(*)`,
    })
    .from(f)
    .where(eq(f.orgId, orgId));
  return { bytes: Number(row?.bytes ?? 0), capBytes: studioEnv().softCapBytes, files: Number(row?.files ?? 0) };
}
