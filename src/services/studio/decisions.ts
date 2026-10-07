/**
 * Approve / request changes (plan §4.3). A decision is an append-only sign-off: who, when, from
 * where, and the SHA-256 of the exact file. The version's status follows the latest decision.
 */
import "server-only";

import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { StudioError } from "@/lib/studio/errors";
import { statusAfter } from "@/lib/studio/rounds";

import { limitOrThrow, type ReviewerRow, type ShareRow } from "./access";
import { logEvent } from "./events";
import { findVersion, loadShareContent, whereLabel } from "./room";

const input = z.object({
  versionId: z.string().uuid("That version was not found."),
  decision: z.enum(["approved", "changes_requested"]),
  signedName: z.string().trim().max(100, "Keep the name under 100 characters.").default(""),
  confirm: z.boolean().default(false),
  note: z.string().trim().max(2000, "Keep the note under 2000 characters.").optional(),
});

export type DecideInput = z.input<typeof input>;

export async function decide(share: ShareRow, reviewer: ReviewerRow, raw: DecideInput, meta: { ip: string | null; ua: string | null }) {
  const data = input.parse(raw);
  await limitOrThrow("decide", reviewer.id, "deciding");
  const found = findVersion(await loadShareContent(share), data.versionId);
  if (!found) throw new StudioError("That version was not found.");
  if (!found.latest) throw new StudioError("A newer version has been shared. Review that one.");
  const sha256 = found.version.file.sha256;
  if (found.version.file.processing !== "ready" || !sha256) throw new StudioError("This version is still being prepared.");

  let signedName = data.signedName;
  if (data.decision === "approved") {
    if (signedName.length < 2) throw new StudioError("Type your full name to sign off.");
    if (!data.confirm) throw new StudioError("Tick the box to confirm you approve this version.");
  } else signedName ||= reviewer.name;

  const status = statusAfter(data.decision);
  const row = await db.transaction(async (tx) => {
    const [d] = await tx
      .insert(schema.studioDecisions)
      .values({ versionId: data.versionId, reviewerId: reviewer.id, decision: data.decision, signedName, email: reviewer.email, ip: meta.ip, ua: meta.ua?.slice(0, 300) ?? null, fileSha256: sha256, note: data.note || null })
      .returning();
    await tx.update(schema.studioVersions).set({ status }).where(eq(schema.studioVersions.id, data.versionId));
    await logEvent(
      { orgId: share.orgId, projectId: share.projectId, shareId: share.id, actorLabel: reviewer.name, type: data.decision === "approved" ? "decision.approved" : "decision.changes_requested", payload: { where: whereLabel(found), versionId: data.versionId, decisionId: d!.id, note: data.note ?? null } },
      tx,
    );
    return d!;
  });
  return { decision: row, status };
}

export async function listDecisions(versionId: string) {
  return db.select().from(schema.studioDecisions).where(eq(schema.studioDecisions.versionId, versionId)).orderBy(desc(schema.studioDecisions.createdAt));
}
