import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { getBlobStore } from "@/lib/blob";
import { renditionOf } from "@/services/studio/files";
import { logEvent } from "@/services/studio/events";
import { guestState } from "@/services/studio/guest";
import { canDownloadOriginal, findFile, SIGNED_URL_SECONDS, loadShareContent, sharePaid, watermarked, whereLabel } from "@/services/studio/room";

const PRIVATE = { "cache-control": "private, no-store", "x-robots-tag": "noindex" };


/**
 * Every file of a review is reached through here: a session for this share, a file that belongs to
 * a version the share shows, and the share's download rules. The browser never chooses between
 * the clean and the watermarked preview, and the original only leaves when the policy allows it.
 * The answer is a redirect to a signed URL in the store, so the bytes never pass through the app.
 *
 *   GET /review/<token>/file/<fileId>?r=preview|poster|thumb|original[&download=1]
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string; fileId: string }> }) {
  const { token, fileId } = await params;
  const g = await guestState(token);
  if (g.kind !== "room") return new Response("Sign in to the review first.", { status: 401, headers: PRIVATE });

  const found = findFile(await loadShareContent(g.share), fileId);
  if (!found) return new Response("Not found.", { status: 404, headers: PRIVATE });
  const [file] = await db.select().from(schema.studioFiles).where(eq(schema.studioFiles.id, fileId)).limit(1);
  if (!file || file.processing !== "ready") return new Response("Not found.", { status: 404, headers: PRIVATE });

  const url = new URL(req.url);
  const r = url.searchParams.get("r") ?? "preview";
  // An `after_payment` share reads its invoice on every request, so marking it paid unlocks the next one.
  const paid = g.share.downloadPolicy === "after_payment" && (await sharePaid(g.share));
  const marked = watermarked(g.share, found.version.status, paid);
  const video = file.mime.startsWith("video/");

  let rendition: { key: string; mime: string } | null = null;
  let download = false;
  if (r === "preview") {
    rendition = renditionOf(file, marked ? "wm" : "preview");
  } else if (r === "poster" || r === "thumb") {
    // A clean video frame would walk around the watermark, so a marked video has no poster.
    if (!(marked && video)) rendition = renditionOf(file, r);
  } else if (r === "original") {
    if (!canDownloadOriginal(g.share, found.version.status, paid)) return new Response("Downloads are turned off for this version.", { status: 403, headers: PRIVATE });
    rendition = renditionOf(file, "original");
    download = url.searchParams.get("download") === "1";
    if (rendition) await logEvent({ orgId: g.share.orgId, projectId: g.share.projectId, shareId: g.share.id, actorLabel: g.reviewer.name, type: "file.downloaded", payload: { file: file.originalName, where: whereLabel(found), versionId: found.version.id, reviewerId: g.reviewer.id } });
  }
  if (!rendition) return new Response("Not found.", { status: 404, headers: PRIVATE });
  const target = await getBlobStore().readUrl(rendition.key, { validForS: SIGNED_URL_SECONDS, download });
  return new Response(null, { status: 302, headers: { ...PRIVATE, location: target } });
}
