import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { getBlobStore } from "@/lib/blob";
import { deliverableIn } from "@/services/studio/deliverables";
import { logEvent } from "@/services/studio/events";
import { guestState } from "@/services/studio/guest";
import { canDownloadOriginal, findVersion, loadShareContent, sharePaid, SIGNED_URL_SECONDS, whereLabel } from "@/services/studio/room";

const PRIVATE = { "cache-control": "private, no-store", "x-robots-tag": "noindex" };

/**
 * A deliverable leaves through here: a named reviewer on this share, a file attached to a version
 * the share shows, and the share's download policy (`after_payment` reads the invoice on every
 * request). Always a download, so an SVG is never opened inline from the store.
 *
 *   GET /review/<token>/deliverable/<fileId>
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; fileId: string }> }) {
  const { token, fileId } = await params;
  const g = await guestState(token);
  if (g.kind !== "room") return new Response("Sign in to the review first.", { status: 401, headers: PRIVATE });

  const content = await loadShareContent(g.share);
  const versionIds = content.flatMap((a) => a.variations.flatMap((v) => v.versions.map((x) => x.id)));
  const attached = await deliverableIn(versionIds, fileId);
  const found = attached && findVersion(content, attached.versionId);
  if (!attached || !found) return new Response("Not found.", { status: 404, headers: PRIVATE });
  const [file] = await db.select().from(schema.studioFiles).where(eq(schema.studioFiles.id, fileId)).limit(1);
  if (!file?.originalKey || file.processing !== "ready") return new Response("Not found.", { status: 404, headers: PRIVATE });

  const paid = g.share.downloadPolicy === "after_payment" && (await sharePaid(g.share));
  if (!canDownloadOriginal(g.share, found.version.status, paid)) return new Response("This file isn't unlocked yet.", { status: 403, headers: PRIVATE });

  await logEvent({ orgId: g.share.orgId, projectId: g.share.projectId, shareId: g.share.id, actorLabel: g.reviewer.name, type: "file.downloaded", payload: { file: file.originalName, label: attached.label, where: whereLabel(found), versionId: found.version.id, reviewerId: g.reviewer.id } });
  const target = await getBlobStore().readUrl(file.originalKey, { validForS: SIGNED_URL_SECONDS, download: true });
  return new Response(null, { status: 302, headers: { ...PRIVATE, location: target } });
}
