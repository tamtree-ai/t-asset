/**
 * A demo studio to look at locally: one client, a project with an image (two options) and a short
 * video, a review link with a message, and a few comments. Files go through the same path as an
 * upload, so `pnpm fake-tamtree` must be running to make the previews.
 *
 *   pnpm seed:demo        (prints the review link and passcode)
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq, inArray } from "drizzle-orm";
import sharp from "sharp";

import { db, schema } from "../src/db";
import { localBlobStore } from "../src/lib/blob";
import { studioEnv } from "../src/lib/studio/env";
import { ensureOwner } from "../src/services/owner";
import { addReply, addRoot, guestScope } from "../src/services/studio/comments";
import { originalKeyFor } from "../src/services/studio/files";
import { createShare, shareSecrets } from "../src/services/studio/shares";

const poster = (bg1: string, bg2: string, ink: string, title: string, sub: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>
    <rect width="1600" height="1000" fill="url(#g)"/>
    <circle cx="1240" cy="380" r="260" fill="${ink}" fill-opacity="0.08"/>
    <circle cx="1310" cy="460" r="150" fill="${ink}" fill-opacity="0.10"/>
    <text x="120" y="210" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="600" letter-spacing="8" fill="${ink}" fill-opacity="0.7">NORTHWIND COFFEE</text>
    <text x="112" y="560" font-family="Helvetica, Arial, sans-serif" font-size="200" font-weight="800" letter-spacing="-6" fill="${ink}">${title}</text>
    <text x="120" y="650" font-family="Helvetica, Arial, sans-serif" font-size="44" fill="${ink}" fill-opacity="0.75">${sub}</text>
    <rect x="120" y="760" width="300" height="84" rx="42" fill="${ink}"/>
    <text x="270" y="814" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="32" font-weight="700" fill="${bg2}">Order now</text>
  </svg>`;

async function main() {
  const store = localBlobStore();
  if (!store) throw new Error("The demo uses the local blob driver. Unset BLOB_DRIVER or set it to local.");
  const env = studioEnv();
  const member = await ensureOwner(env.owner.email ?? "owner@example.com", env.owner.studioName);
  const orgId = member.orgId;

  // Start clean: an earlier demo client goes, with its files.
  const old = await db.select({ id: schema.studioClients.id }).from(schema.studioClients).where(eq(schema.studioClients.name, "Northwind Coffee"));
  if (old.length) await db.delete(schema.studioClients).where(inArray(schema.studioClients.id, old.map((o) => o.id)));

  const [client] = await db.insert(schema.studioClients).values({ orgId, name: "Northwind Coffee", company: "Northwind", contacts: [{ name: "Sam Lee", email: "sam@northwind.example", role: "Marketing lead" }] }).returning();
  const [project] = await db.insert(schema.studioProjects).values({ orgId, clientId: client!.id, name: "Spring campaign", roundsIncluded: 2, dueDate: "2026-11-01" }).returning();
  const [banner] = await db.insert(schema.studioAssets).values({ projectId: project!.id, title: "Hero banner", kind: "image", sort: 0 }).returning();
  const [teaser] = await db.insert(schema.studioAssets).values({ projectId: project!.id, title: "Launch teaser", kind: "video", sort: 1 }).returning();
  const [optA] = await db.insert(schema.studioVariations).values({ assetId: banner!.id, label: "Option A: soft", sort: 0 }).returning();
  const [optB] = await db.insert(schema.studioVariations).values({ assetId: banner!.id, label: "Option B: bold", sort: 1 }).returning();
  const [main] = await db.insert(schema.studioVariations).values({ assetId: teaser!.id, label: "Main" }).returning();

  /** Stores an original and makes the version, exactly as finishing an upload does; Tamtree takes it from there. */
  async function addVersion(variationId: string, number: number, name: string, mime: string, bytes: Buffer, changeNote: string) {
    const fileId = randomUUID();
    const key = originalKeyFor(fileId, name);
    await store!.write(key, new Blob([new Uint8Array(bytes)]).stream(), mime);
    await db.insert(schema.studioFiles).values({ id: fileId, orgId, originalKey: key, originalName: name, mime, bytes: bytes.length, processing: "pending" });
    const [v] = await db.insert(schema.studioVersions).values({ variationId, number, fileId, changeNote, createdBy: member.id }).returning();
    return { versionId: v!.id, fileId };
  }

  const png = (svg: string) => sharp(Buffer.from(svg)).png().toBuffer();
  await addVersion(optA!.id, 1, "hero-soft-v1.png", "image/png", await png(poster("#f6e7d8", "#e9c9a8", "#3b2414", "Spring Blend", "Bright, floral, a little sweet.")), "First idea");
  const a2 = await addVersion(optA!.id, 2, "hero-soft-v2.png", "image/png", await png(poster("#fbeee2", "#efc7a0", "#2f1a0c", "Spring Blend", "Bright, floral, a little sweet.")), "Warmer background, logo larger");
  const b1 = await addVersion(optB!.id, 1, "hero-bold-v1.png", "image/png", await png(poster("#101828", "#1d2939", "#f9d34a", "Spring Blend", "Bold beans for long days.")), "A darker, louder direction");

  const dir = mkdtempSync(path.join(tmpdir(), "tasset-demo-"));
  const mp4 = path.join(dir, "teaser.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=8", "-f", "lavfi", "-i", "sine=frequency=330:duration=8", "-shortest", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-c:a", "aac", "-y", mp4]);
  const t1 = await addVersion(main!.id, 1, "launch-teaser-v1.mp4", "video/mp4", readFileSync(mp4), "Rough cut, temp music");

  const { share, token, passcode } = await createShare(orgId, member.id, project!.id, {
    title: "Spring campaign · round one",
    message: "Hi Sam,\n\nHere are two directions for the hero banner and a rough cut of the teaser. Pin a comment anywhere on the work, and approve when you're happy.",
    notes: ["Fonts are placeholders", "Music on the teaser is a temp track"],
    expiresAt: null,
    downloadPolicy: "after_approval",
    watermark: true,
    commentsOpen: true,
    versionMode: "latest",
    assetIds: [banner!.id, teaser!.id],
  } as never);

  console.log("Waiting for Tamtree (pnpm fake-tamtree) to make the previews…");
  const ids = [a2.fileId, b1.fileId, t1.fileId];
  for (let i = 0; i < 120; i++) {
    const rows = await db.select({ p: schema.studioFiles.processing }).from(schema.studioFiles).where(inArray(schema.studioFiles.id, ids));
    if (rows.every((r) => r.p === "ready")) break;
    if (i === 119) console.log("Still processing. Is `pnpm fake-tamtree` running? The comments are added anyway.");
    await new Promise((r) => setTimeout(r, 1000));
  }

  const [reviewer] = await db.insert(schema.studioReviewers).values({ shareId: share.id, name: "Sam Lee", email: "sam@northwind.example", lastSeenAt: new Date() }).returning();
  const sam = { kind: "reviewer" as const, reviewerId: reviewer!.id, label: "Sam Lee" };
  const studio = { kind: "member" as const, memberId: member.id, label: "Studio" };
  const scope = (await guestScope(share, a2.versionId))!;
  const t = await addRoot(scope, sam, { body: "Love the warmth. Can the logo breathe a bit more up here?", annotation: { v: 1, shape: "pin", x: 0.22, y: 0.2 } });
  await addRoot(scope, sam, { body: "This button feels a little heavy against the soft background.", annotation: { v: 1, shape: "rect", x: 0.07, y: 0.74, w: 0.21, h: 0.12 } });
  await addReply(scope, studio, { parentId: t.id, body: "Good call. I'll add more space above it in v3." });
  const vscope = (await guestScope(share, t1.versionId))!;
  await addRoot(vscope, sam, { body: "Can the title come in a beat later?", annotation: { v: 1, shape: "pin", x: 0.5, y: 0.45, t: 2.4, frame: 72 } });

  const { url } = shareSecrets(share, env.appUrl ?? "http://localhost:3000");
  console.log(`\nReview link: ${url}\nPasscode:    ${passcode}\nStudio:      ${(env.appUrl ?? "http://localhost:3000")}/studio  (sign in as ${env.owner.email})\n(token ${token.slice(0, 6)}…)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
