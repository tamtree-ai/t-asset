/**
 * Shared setup for the service tests: real Postgres (the dev DB), the local blob store in a
 * throwaway dir, throwaway orgs. Call `vi.mock("server-only", …)` in the test file.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq, inArray, sql } from "drizzle-orm";

export type Ctx = Awaited<ReturnType<typeof setup>>;

export const TEST_DB = "postgres://tasset:tasset@localhost:5434/tasset";

export async function setup(label: string) {
  const dataDir = await mkdtemp(path.join(tmpdir(), `tasset-${label}-`));
  process.env.DATABASE_URL ??= TEST_DB;
  const { db, schema } = await import("@/db");
  const { setBlobStore } = await import("@/lib/blob");
  const { LocalBlobStore } = await import("@/lib/blob/local");
  const { secretKey } = await import("@/lib/studio/crypto");
  const store = new LocalBlobStore(dataDir, "http://localhost:3000", secretKey());
  setBlobStore(store);
  const orgIds: string[] = [];

  async function org(name: string) {
    const [o] = await db.insert(schema.orgs).values({ name: `studio-${label}-${name}` }).returning();
    orgIds.push(o!.id);
    const [member] = await db.insert(schema.members).values({ orgId: o!.id, email: `${label}-${name}-${randomUUID().slice(0, 8)}@example.com`, name: `Owner ${name}`, role: "owner" }).returning();
    await db.insert(schema.studioBrand).values({ orgId: o!.id, studioName: `Studio ${name}`, accentHex: "#ff6a3d" });
    return { orgId: o!.id, memberId: member!.id, email: member!.email };
  }

  async function tree(orgId: string, kind: "image" | "video" = "image", names: { client?: string; project?: string; asset?: string } = {}) {
    const [client] = await db.insert(schema.studioClients).values({ orgId, name: names.client ?? "Acme" }).returning();
    const [project] = await db.insert(schema.studioProjects).values({ orgId, clientId: client!.id, name: names.project ?? "Spring", roundsIncluded: 2 }).returning();
    const [asset] = await db.insert(schema.studioAssets).values({ projectId: project!.id, title: names.asset ?? "Banner", kind }).returning();
    const [variation] = await db.insert(schema.studioVariations).values({ assetId: asset!.id, label: "Main" }).returning();
    return { clientId: client!.id, projectId: project!.id, assetId: asset!.id, variationId: variation!.id };
  }

  const put = async (key: string, text: string, contentType = "application/octet-stream") => store.write(key, new Blob([text]).stream(), contentType);

  /** A ready file with distinguishable blobs, as Tamtree leaves it, and a version pointing at it. */
  async function version(orgId: string, variationId: string, opts: { mime?: string; note?: string; status?: "in_review" | "changes_requested" | "approved" } = {}) {
    const fileId = randomUUID();
    const mime = opts.mime ?? "image/png";
    const video = mime.startsWith("video/");
    const original = `o/${fileId}/${video ? "teaser.mp4" : "banner.png"}`;
    const d = `d/${fileId}`;
    const size = await put(original, "ORIGINAL", mime);
    await put(`${d}/preview`, "CLEAN-PREVIEW", video ? "video/mp4" : "image/webp");
    await put(`${d}/wm`, "MARKED-PREVIEW", video ? "video/mp4" : "image/webp");
    await put(`${d}/poster`, "POSTER", "image/jpeg");
    await put(`${d}/thumb`, "THUMB", "image/webp");
    const sha256 = createHash("sha256").update("ORIGINAL").digest("hex");
    await db.insert(schema.studioFiles).values({
      id: fileId,
      orgId,
      originalKey: original,
      originalName: video ? "teaser.mp4" : "banner.png",
      mime,
      bytes: size,
      derivedBytes: 40,
      sha256,
      width: 1600,
      height: 900,
      durationS: video ? 10 : null,
      fpsNum: video ? 30 : null,
      fpsDen: video ? 1 : null,
      previewKey: `${d}/preview`,
      wmPreviewKey: `${d}/wm`,
      posterKey: video ? `${d}/poster` : null,
      thumbKey: `${d}/thumb`,
      processing: "ready",
    });
    const [{ n }] = (await db.select({ n: sql<number>`coalesce(max(${schema.studioVersions.number}), 0) + 1` }).from(schema.studioVersions).where(eq(schema.studioVersions.variationId, variationId))) as [{ n: number }];
    const [v] = await db.insert(schema.studioVersions).values({ variationId, number: Number(n), fileId, changeNote: opts.note ?? "", status: opts.status ?? "in_review" }).returning();
    return { versionId: v!.id, fileId, number: v!.number, sha256 };
  }

  async function share(orgId: string, memberId: string, projectId: string, assetIds: string[], over: Record<string, unknown> = {}) {
    const shares = await import("@/services/studio/shares");
    return shares.createShare(orgId, memberId, projectId, { title: "Review", message: "", notes: [], expiresAt: null, downloadPolicy: "after_approval", watermark: true, commentsOpen: true, versionMode: "latest", assetIds, ...over } as never);
  }

  async function cleanup() {
    // Versions point at files with no cascade, so the trees go first; then the orgs take everything else.
    if (orgIds.length) {
      await db.delete(schema.studioClients).where(inArray(schema.studioClients.orgId, orgIds));
      for (const id of orgIds) await db.delete(schema.orgs).where(eq(schema.orgs.id, id));
    }
    setBlobStore(undefined);
    await rm(dataDir, { recursive: true, force: true });
  }

  return { db, schema, org, tree, version, share, cleanup, dataDir, store, put };
}
