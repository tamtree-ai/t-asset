/** Shares: the review links (plan §4.1, §4.6). The owner side; the guest side is `access.ts`. */
import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { hashToken, newToken } from "@/lib/session-token";
import { decrypt, encrypt } from "@/lib/studio/crypto";
import { studioEnv } from "@/lib/studio/env";
import { StudioError } from "@/lib/studio/errors";
import { displayPasscode, newPasscode } from "@/lib/studio/passcode";

import { logEvent } from "./events";
import { getProject } from "./projects";

export type ShareRow = typeof schema.studioShares.$inferSelect;

export const shareInput = z.object({
  title: z.string().trim().min(1, "Give the review a title.").max(120, "Keep the title under 120 characters."),
  message: z.string().max(4000, "Keep the message under 4000 characters.").default(""),
  notes: z
    .array(z.string().trim().max(300, "Keep each note under 300 characters."))
    .max(20, "Twenty notes is the most a review shows.")
    .transform((a) => a.filter(Boolean))
    .default([]),
  expiresAt: z
    .string()
    .optional()
    .nullable()
    .transform((s) => (s ? new Date(s) : null))
    .refine((d) => d === null || !Number.isNaN(d.getTime()), "The expiry date doesn't look right."),
  downloadPolicy: z.enum(["none", "after_approval", "always"]),
  watermark: z.boolean(),
  commentsOpen: z.boolean(),
  versionMode: z.enum(["latest", "pinned"]),
  assetIds: z.array(z.string().uuid()).min(1, "Pick at least one asset to share.").max(50),
});

export type ShareInput = z.input<typeof shareInput>;

/** The public link for a share. `origin` is the request's, used only when APP_URL is not set. */
export function shareUrl(token: string, origin?: string | null): string {
  const base = studioEnv().appUrl ?? origin?.replace(/\/+$/, "") ?? "";
  return `${base}/review/${token}`;
}

async function assertAssets(orgId: string, projectId: string, assetIds: string[]) {
  const rows = await db
    .select({ id: schema.studioAssets.id })
    .from(schema.studioAssets)
    .innerJoin(schema.studioProjects, eq(schema.studioProjects.id, schema.studioAssets.projectId))
    .where(and(inArray(schema.studioAssets.id, assetIds), eq(schema.studioAssets.projectId, projectId), eq(schema.studioProjects.orgId, orgId)));
  if (rows.length !== new Set(assetIds).size) throw new StudioError("One of those assets isn't in this project.");
}

/** For `pinned` mode: each asset's newest version at the moment the share is made, one per variation. */
async function pinNow(assetIds: string[]): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ assetId: schema.studioVariations.assetId, versionId: schema.studioVersions.id, variationId: schema.studioVersions.variationId, number: schema.studioVersions.number })
    .from(schema.studioVersions)
    .innerJoin(schema.studioVariations, eq(schema.studioVariations.id, schema.studioVersions.variationId))
    .where(inArray(schema.studioVariations.assetId, assetIds))
    .orderBy(desc(schema.studioVersions.number));
  const seen = new Set<string>();
  const out = new Map<string, string[]>();
  for (const r of rows) {
    if (seen.has(r.variationId)) continue;
    seen.add(r.variationId);
    out.set(r.assetId, [...(out.get(r.assetId) ?? []), r.versionId]);
  }
  return out;
}

export async function createShare(orgId: string, memberId: string, projectId: string, raw: ShareInput) {
  const input = shareInput.parse(raw);
  if (!(await getProject(orgId, projectId))) throw new StudioError("That project was not found.");
  await assertAssets(orgId, projectId, input.assetIds);
  const token = newToken(24);
  const passcode = newPasscode();
  const pins = input.versionMode === "pinned" ? await pinNow(input.assetIds) : new Map<string, string[]>();
  const share = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.studioShares)
      .values({
        orgId,
        projectId,
        title: input.title,
        message: input.message,
        notes: input.notes,
        tokenHash: hashToken(token),
        tokenEnc: encrypt(token),
        passcodeEnc: encrypt(passcode),
        expiresAt: input.expiresAt,
        downloadPolicy: input.downloadPolicy,
        watermark: input.watermark,
        commentsOpen: input.commentsOpen,
        versionMode: input.versionMode,
        createdBy: memberId,
      })
      .returning();
    await tx.insert(schema.studioShareItems).values(input.assetIds.map((assetId, sort) => ({ shareId: row!.id, assetId, sort, pinnedVersionIds: pins.get(assetId) ?? [] })));
    return row!;
  });
  await logEvent({ orgId, projectId, shareId: share.id, actorLabel: "You", type: "share.created", payload: { title: share.title } });
  return { share, token, passcode };
}

export async function updateShare(orgId: string, shareId: string, raw: ShareInput) {
  const input = shareInput.parse(raw);
  const existing = await getShare(orgId, shareId);
  if (!existing) throw new StudioError("That review link was not found.");
  await assertAssets(orgId, existing.share.projectId, input.assetIds);
  const keepPins = new Map(existing.items.map((i) => [i.assetId, i.pinnedVersionIds]));
  const fresh = input.versionMode === "pinned" ? await pinNow(input.assetIds.filter((a) => !keepPins.get(a)?.length)) : new Map<string, string[]>();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.studioShares)
      .set({
        title: input.title,
        message: input.message,
        notes: input.notes,
        expiresAt: input.expiresAt,
        downloadPolicy: input.downloadPolicy,
        watermark: input.watermark,
        commentsOpen: input.commentsOpen,
        versionMode: input.versionMode,
        updatedAt: new Date(),
      })
      .where(eq(schema.studioShares.id, shareId));
    await tx.delete(schema.studioShareItems).where(eq(schema.studioShareItems.shareId, shareId));
    await tx.insert(schema.studioShareItems).values(input.assetIds.map((assetId, sort) => ({ shareId, assetId, sort, pinnedVersionIds: keepPins.get(assetId)?.length ? keepPins.get(assetId)! : (fresh.get(assetId) ?? []) })));
  });
}

/** A new passcode; everyone who unlocked the link has to type it again. */
export async function regeneratePasscode(orgId: string, shareId: string): Promise<string> {
  const existing = await getShare(orgId, shareId);
  if (!existing) throw new StudioError("That review link was not found.");
  const passcode = newPasscode();
  await db.transaction(async (tx) => {
    await tx.update(schema.studioShares).set({ passcodeEnc: encrypt(passcode), updatedAt: new Date() }).where(eq(schema.studioShares.id, shareId));
    await tx.delete(schema.studioShareSessions).where(eq(schema.studioShareSessions.shareId, shareId));
  });
  return passcode;
}

/** Ends the link now: it shows "this link has ended", and every session on it is removed. */
export async function revokeShare(orgId: string, shareId: string): Promise<void> {
  const existing = await getShare(orgId, shareId);
  if (!existing) throw new StudioError("That review link was not found.");
  await db.transaction(async (tx) => {
    await tx.update(schema.studioShares).set({ revokedAt: new Date(), updatedAt: new Date() }).where(eq(schema.studioShares.id, shareId));
    await tx.delete(schema.studioShareSessions).where(eq(schema.studioShareSessions.shareId, shareId));
  });
  await logEvent({ orgId, projectId: existing.share.projectId, shareId, actorLabel: "You", type: "share.revoked" });
}

export async function restoreShare(orgId: string, shareId: string): Promise<void> {
  const existing = await getShare(orgId, shareId);
  if (!existing) throw new StudioError("That review link was not found.");
  await db.update(schema.studioShares).set({ revokedAt: null, updatedAt: new Date() }).where(eq(schema.studioShares.id, shareId));
}

export async function getShare(orgId: string, shareId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(shareId)) return null;
  const [share] = await db.select().from(schema.studioShares).where(and(eq(schema.studioShares.id, shareId), eq(schema.studioShares.orgId, orgId))).limit(1);
  if (!share) return null;
  const items = await db.select().from(schema.studioShareItems).where(eq(schema.studioShareItems.shareId, shareId)).orderBy(asc(schema.studioShareItems.sort));
  return { share, items };
}

/** What the owner sees to copy: the token and passcode decrypted. */
export function shareSecrets(share: Pick<ShareRow, "tokenEnc" | "passcodeEnc">, origin?: string | null) {
  const token = decrypt(share.tokenEnc);
  const passcode = decrypt(share.passcodeEnc);
  return { token, url: shareUrl(token, origin), passcode, passcodeDisplay: displayPasscode(passcode) };
}

export function shareState(share: Pick<ShareRow, "revokedAt" | "expiresAt">, now = new Date()): "live" | "expired" | "revoked" {
  if (share.revokedAt) return "revoked";
  if (share.expiresAt && share.expiresAt <= now) return "expired";
  return "live";
}

export async function listShares(orgId: string, projectId: string) {
  const shares = await db.select().from(schema.studioShares).where(and(eq(schema.studioShares.orgId, orgId), eq(schema.studioShares.projectId, projectId))).orderBy(desc(schema.studioShares.createdAt));
  if (shares.length === 0) return [];
  const [items, reviewers] = await Promise.all([
    db.select().from(schema.studioShareItems).where(inArray(schema.studioShareItems.shareId, shares.map((s) => s.id))),
    db.select().from(schema.studioReviewers).where(inArray(schema.studioReviewers.shareId, shares.map((s) => s.id))),
  ]);
  return shares.map((s) => ({ ...s, state: shareState(s), assetCount: items.filter((i) => i.shareId === s.id).length, reviewers: reviewers.filter((r) => r.shareId === s.id) }));
}

export async function listReviewers(orgId: string, shareId: string) {
  if (!(await getShare(orgId, shareId))) return [];
  return db.select().from(schema.studioReviewers).where(eq(schema.studioReviewers.shareId, shareId)).orderBy(desc(schema.studioReviewers.lastSeenAt));
}

/** The pre-written message the owner pastes into email or WhatsApp. */
export function shareMessage(opts: { studioName: string; clientName: string; title: string; url: string; passcodeDisplay: string; expiresAt?: Date | null }): string {
  const lines = [
    `Hi ${opts.clientName},`,
    "",
    `“${opts.title}” is ready for your review. You can leave comments straight on the work, and approve it when you're happy.`,
    "",
    `Link: ${opts.url}`,
    `Passcode: ${opts.passcodeDisplay}`,
  ];
  if (opts.expiresAt) lines.push(`Open until: ${opts.expiresAt.toISOString().slice(0, 10)}`);
  lines.push("", `Thanks,`, opts.studioName);
  return lines.join("\n");
}
