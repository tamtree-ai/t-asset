/**
 * What a hook receives (hooks plan §4.1, review-loop design §3.3). Built when it is sent, from the
 * event row plus a few joins, so a subscriber can act without calling back. Versioned by `v`;
 * fields are only ever added. Built in batches: the pull feed makes up to 200 at once.
 */
import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/db";
import { ENVELOPE_VERSION } from "@/lib/hooks";
import { studioEnv } from "@/lib/studio/env";

export type EventRow = typeof schema.studioEvents.$inferSelect;

export type AssetRef = { id: string; title: string; kind: string; externalRef: string | null };
export type VersionRef = { id: string; number: number; externalRef: string | null; released: boolean };

export type Envelope = {
  id: string;
  type: string;
  v: number;
  occurredAt: string;
  studio: { name: string; ownerEmail: string | null };
  project: { id: string; name: string; studioUrl: string } | null;
  client: { name: string } | null;
  share: { id: string; title: string; studioUrl: string } | null;
  actor: { kind: "reviewer" | "studio" | "owner" | "api" | "system"; name: string; email: string | null };
  asset: AssetRef | null;
  version: VersionRef | null;
  comment: { id: string; number: number | null; parentId: string | null; body: string; annotation: Record<string, unknown> | null } | null;
  data: Record<string, unknown>;
};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];

export async function buildEnvelopes(events: EventRow[]): Promise<Envelope[]> {
  if (!events.length) return [];
  const base = studioEnv().appUrl ?? "http://localhost:3000";

  const commentIds = uniq(events.map((e) => str(e.payload.commentId)));
  const comments = commentIds.length ? await db.select().from(schema.studioComments).where(inArray(schema.studioComments.id, commentIds)) : [];
  const commentById = new Map(comments.map((c) => [c.id, c]));
  const parentIds = uniq(comments.map((c) => c.parentId));
  const parents = parentIds.length ? await db.select({ id: schema.studioComments.id, number: schema.studioComments.number }).from(schema.studioComments).where(inArray(schema.studioComments.id, parentIds)) : [];
  const parentNumber = new Map(parents.map((p) => [p.id, p.number]));

  const versionIds = uniq([...events.flatMap((e) => [str(e.payload.versionId), ...strs(e.payload.versionIds)]), ...comments.map((c) => c.versionId)]);
  const versions = versionIds.length
    ? await db
        .select({
          id: schema.studioVersions.id,
          number: schema.studioVersions.number,
          externalRef: schema.studioVersions.externalRef,
          releasedAt: schema.studioVersions.releasedAt,
          asset: { id: schema.studioAssets.id, title: schema.studioAssets.title, kind: schema.studioAssets.kind, externalRef: schema.studioAssets.externalRef },
        })
        .from(schema.studioVersions)
        .innerJoin(schema.studioVariations, eq(schema.studioVariations.id, schema.studioVersions.variationId))
        .innerJoin(schema.studioAssets, eq(schema.studioAssets.id, schema.studioVariations.assetId))
        .where(inArray(schema.studioVersions.id, versionIds))
    : [];
  const versionById = new Map(versions.map((v) => [v.id, v]));

  const reviewerIds = uniq([...events.map((e) => str(e.payload.reviewerId)), ...comments.map((c) => c.authorReviewerId)]);
  const reviewers = reviewerIds.length ? await db.select({ id: schema.studioReviewers.id, name: schema.studioReviewers.name, email: schema.studioReviewers.email }).from(schema.studioReviewers).where(inArray(schema.studioReviewers.id, reviewerIds)) : [];
  const reviewerById = new Map(reviewers.map((r) => [r.id, r]));

  const projectIds = uniq(events.map((e) => e.projectId));
  const projects = projectIds.length
    ? await db
        .select({ id: schema.studioProjects.id, name: schema.studioProjects.name, client: schema.studioClients.name })
        .from(schema.studioProjects)
        .innerJoin(schema.studioClients, eq(schema.studioClients.id, schema.studioProjects.clientId))
        .where(inArray(schema.studioProjects.id, projectIds))
    : [];
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const shareIds = uniq(events.map((e) => e.shareId));
  const shares = shareIds.length ? await db.select({ id: schema.studioShares.id, title: schema.studioShares.title }).from(schema.studioShares).where(inArray(schema.studioShares.id, shareIds)) : [];
  const shareById = new Map(shares.map((s) => [s.id, s]));

  const orgIds = uniq(events.map((e) => e.orgId));
  const brands = await db.select({ orgId: schema.studioBrand.orgId, name: schema.studioBrand.studioName }).from(schema.studioBrand).where(inArray(schema.studioBrand.orgId, orgIds));
  const owners = await db.select({ orgId: schema.members.orgId, email: schema.members.email }).from(schema.members).where(and(inArray(schema.members.orgId, orgIds), eq(schema.members.role, "owner")));
  const studioName = new Map(brands.map((b) => [b.orgId, b.name]));
  const ownerEmail = new Map(owners.map((o) => [o.orgId, o.email]));

  const versionRef = (id: string): VersionRef | null => {
    const v = versionById.get(id);
    return v ? { id: v.id, number: v.number, externalRef: v.externalRef, released: !!v.releasedAt } : null;
  };

  return events.map((e) => {
    const p = e.payload;
    const c = commentById.get(str(p.commentId) ?? "");
    const versionId = str(p.versionId) ?? c?.versionId ?? (strs(p.versionIds).length === 1 ? strs(p.versionIds)[0]! : null);
    const v = versionId ? versionById.get(versionId) : undefined;
    const project = e.projectId ? projectById.get(e.projectId) : undefined;
    const share = e.shareId ? shareById.get(e.shareId) : undefined;
    const reviewer = reviewerById.get(str(p.reviewerId) ?? c?.authorReviewerId ?? "");

    const actor: Envelope["actor"] = reviewer
      ? { kind: "reviewer", name: reviewer.name, email: reviewer.email }
      : e.type === "owner.signed_in"
        ? { kind: "owner", name: e.actorLabel, email: str(p.email) }
        : e.type.startsWith("file.")
          ? { kind: "system", name: e.actorLabel, email: null }
          : e.actorLabel === "API"
            ? { kind: "api", name: "API", email: null }
            : { kind: "studio", name: e.actorLabel, email: null };

    const data: Record<string, unknown> = { ...p };
    if (strs(p.versionIds).length) {
      data.versions = strs(p.versionIds).flatMap((id) => {
        const ref = versionRef(id);
        const asset = versionById.get(id)?.asset;
        return ref && asset ? [{ ...ref, asset }] : [];
      });
    }

    return {
      id: e.id,
      type: e.type,
      v: ENVELOPE_VERSION,
      occurredAt: e.createdAt.toISOString(),
      studio: { name: studioName.get(e.orgId) ?? "Studio", ownerEmail: ownerEmail.get(e.orgId) ?? null },
      project: project ? { id: project.id, name: project.name, studioUrl: `${base}/studio/projects/${project.id}` } : null,
      client: project ? { name: project.client } : null,
      share: share ? { id: share.id, title: share.title, studioUrl: `${base}/studio/shares/${share.id}` } : null,
      actor,
      asset: v ? v.asset : null,
      version: versionId ? versionRef(versionId) : null,
      comment:
        c && !c.internal && !c.deletedAt
          ? { id: c.id, number: c.number ?? (c.parentId ? (parentNumber.get(c.parentId) ?? null) : null), parentId: c.parentId, body: c.body, annotation: c.annotation }
          : null,
      data,
    };
  });
}
