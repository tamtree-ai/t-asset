/**
 * The shorts pipeline's way into t-asset (StickStage `packages/shorts`). Two commands:
 *
 *   pnpm shorts ingest <work dir> --videos <dir> --client "<name>" --project "<name>" [--suffix -draft] [--note "what changed"]
 *       Each short in <work dir>/shorts.json becomes a video asset (found by title, made if new)
 *       and its render <videos>/<id><suffix>.mp4 its next version: **internal**, with the short's
 *       `why`, hook and closing line. Run it again after a re-cut and every short gets v2, v3…
 *       Writes <work dir>/tasset.json (short id → asset) for `comments`.
 *
 *   pnpm shorts comments <work dir> [--all]
 *       Every open comment on each short's newest version as JSON, with its time range on the
 *       short's clock: what Claude (skill `shorts-editor`) turns into the next re-cut.
 *
 * Like `seed:demo`, files go through the upload path, so `pnpm fake-tamtree` (or the real Tamtree
 * flow) makes the previews.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { and, asc, desc, eq, inArray, isNull, max } from "drizzle-orm";

import { db, schema } from "../src/db";
import { localBlobStore } from "../src/lib/blob";
import { studioEnv } from "../src/lib/studio/env";
import { ensureOwner } from "../src/services/owner";
import { originalKeyFor } from "../src/services/studio/files";

type Short = { id: string; title: string; hook?: string; closing?: string; why?: string; duration?: number };
type Mapping = { clientId: string; projectId: string; shorts: Record<string, { assetId: string; variationId: string }> };

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const [cmd, workDir] = args;

async function ingest() {
  const store = localBlobStore();
  if (!store) throw new Error("ingest writes through the local blob driver. Unset BLOB_DRIVER or set it to local.");
  const videos = flag("--videos");
  const clientName = flag("--client");
  const projectName = flag("--project");
  if (!workDir || !videos || !clientName || !projectName) throw new Error('usage: pnpm shorts ingest <work dir> --videos <dir> --client "<name>" --project "<name>"');
  const suffix = flag("--suffix") ?? "-draft";
  const note = flag("--note") ?? "";
  const { shorts, brand } = JSON.parse(readFileSync(path.join(workDir, "shorts.json"), "utf8")) as { shorts: Short[]; brand?: { name?: string } };

  const env = studioEnv();
  const member = await ensureOwner(env.owner.email ?? "owner@example.com", env.owner.studioName);
  const orgId = member.orgId;

  let [client] = await db.select().from(schema.studioClients).where(and(eq(schema.studioClients.orgId, orgId), eq(schema.studioClients.name, clientName)));
  client ??= (await db.insert(schema.studioClients).values({ orgId, name: clientName, company: brand?.name ?? clientName, contacts: [] }).returning())[0]!;
  let [project] = await db.select().from(schema.studioProjects).where(and(eq(schema.studioProjects.clientId, client.id), eq(schema.studioProjects.name, projectName)));
  project ??= (await db.insert(schema.studioProjects).values({ orgId, clientId: client.id, name: projectName, roundsIncluded: 2 }).returning())[0]!;

  const mapping: Mapping = { clientId: client.id, projectId: project.id, shorts: {} };
  const fileIds: string[] = [];
  for (const [i, sh] of shorts.entries()) {
    const file = path.join(videos, `${sh.id}${suffix}.mp4`);
    if (!existsSync(file)) {
      console.log(`skip ${sh.id}: no ${file}`);
      continue;
    }
    let [asset] = await db.select().from(schema.studioAssets).where(and(eq(schema.studioAssets.projectId, project.id), eq(schema.studioAssets.title, sh.title), isNull(schema.studioAssets.archivedAt)));
    asset ??= (await db.insert(schema.studioAssets).values({ projectId: project.id, title: sh.title, kind: "video", sort: i }).returning())[0]!;
    let [variation] = await db.select().from(schema.studioVariations).where(eq(schema.studioVariations.assetId, asset.id)).orderBy(asc(schema.studioVariations.sort)).limit(1);
    variation ??= (await db.insert(schema.studioVariations).values({ assetId: asset.id, label: "Main" }).returning())[0]!;
    const [{ n }] = (await db.select({ n: max(schema.studioVersions.number) }).from(schema.studioVersions).where(eq(schema.studioVersions.variationId, variation.id))) as [{ n: number | null }];
    const number = (n ?? 0) + 1;

    const fileId = randomUUID();
    const name = `${sh.id}-v${number}.mp4`;
    const key = originalKeyFor(fileId, name);
    const bytes = statSync(file).size;
    await store.write(key, Readable.toWeb(Readable.from(readFileSync(file))) as ReadableStream<Uint8Array>, "video/mp4");
    await db.insert(schema.studioFiles).values({ id: fileId, orgId, originalKey: key, originalName: name, mime: "video/mp4", bytes, processing: "pending" });
    await db.insert(schema.studioVersions).values({
      variationId: variation.id,
      number,
      fileId,
      changeNote: number === 1 ? "First cut" : note,
      createdBy: member.id,
      releasedAt: null,
      meta: { source: "shorts", shortId: sh.id, why: sh.why, hook: sh.hook, closing: sh.closing, durationS: sh.duration },
    });
    fileIds.push(fileId);
    mapping.shorts[sh.id] = { assetId: asset.id, variationId: variation.id };
    console.log(`${sh.id}  ${sh.title}  v${number}  (internal)`);
  }
  writeFileSync(path.join(workDir, "tasset.json"), JSON.stringify(mapping, null, 2));

  console.log("Waiting for Tamtree (pnpm fake-tamtree) to make the previews…");
  for (let i = 0; i < 300 && fileIds.length; i++) {
    const rows = await db.select({ p: schema.studioFiles.processing }).from(schema.studioFiles).where(inArray(schema.studioFiles.id, fileIds));
    if (rows.every((r) => r.p === "ready" || r.p === "failed")) break;
    if (i === 299) console.log("Still processing. Is `pnpm fake-tamtree` running?");
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`\nReview them: ${env.appUrl ?? "http://localhost:3000"}/studio/queue`);
}

async function comments() {
  if (!workDir) throw new Error("usage: pnpm shorts comments <work dir> [--all]");
  const mapping = JSON.parse(readFileSync(path.join(workDir, "tasset.json"), "utf8")) as Mapping;
  const out: unknown[] = [];
  for (const [shortId, { variationId }] of Object.entries(mapping.shorts)) {
    const [version] = await db.select().from(schema.studioVersions).where(eq(schema.studioVersions.variationId, variationId)).orderBy(desc(schema.studioVersions.number)).limit(1);
    if (!version) continue;
    const rows = await db
      .select()
      .from(schema.studioComments)
      .where(and(eq(schema.studioComments.versionId, version.id), isNull(schema.studioComments.deletedAt), ...(args.includes("--all") ? [] : [isNull(schema.studioComments.resolvedAt)])))
      .orderBy(asc(schema.studioComments.createdAt));
    const roots = rows.filter((r) => !r.parentId);
    for (const c of roots) {
      const a = (c.annotation ?? {}) as { t?: number; tEnd?: number; x?: number; y?: number; shape?: string };
      out.push({
        short: shortId,
        version: version.number,
        commentId: c.id,
        number: c.number,
        author: c.authorLabel,
        internal: c.internal,
        at: a.t ?? null,
        until: a.tEnd ?? null,
        where: a.x !== undefined ? { shape: a.shape, x: a.x, y: a.y } : null,
        body: c.body,
        replies: rows.filter((r) => r.parentId === c.id).map((r) => ({ author: r.authorLabel, body: r.body })),
      });
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

(cmd === "ingest" ? ingest() : cmd === "comments" ? comments() : Promise.reject(new Error("usage: pnpm shorts ingest|comments <work dir> …")))
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
