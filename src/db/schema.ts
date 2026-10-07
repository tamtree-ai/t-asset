/**
 * t-asset's database: one studio's clients, projects, assets and their review links. Files live in
 * Vercel Blob (or the local dev store); `studio_files` holds their keys. Tamtree fills in the
 * derived renditions and the metadata (plan §5.3).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  type AnyPgColumn,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ── tenancy ────────────────────────────────────────────────────────────────
export const orgs = pgTable("orgs", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const memberRole = pgEnum("member_role", ["owner", "editor"]);

export const members = pgTable(
  "members",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    role: memberRole("role").notNull().default("owner"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("members_org_email").on(t.orgId, t.email)],
);

export const sessions = pgTable("sessions", {
  id: id(),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

// ── Studio Review ───────────────────────────────────────────────────────────
// Client → Project → Asset → Variation → Version, shared by link + passcode.

export const studioRoomTheme = pgEnum("studio_room_theme", ["light", "dark", "auto"]);
export const studioProjectStatus = pgEnum("studio_project_status", ["active", "paused", "delivered"]);
export const studioAssetKind = pgEnum("studio_asset_kind", ["image", "video"]);
export const studioVersionStatus = pgEnum("studio_version_status", ["in_review", "changes_requested", "approved"]);
/** `uploading`: the browser is still sending the original. `pending`: Tamtree is making the renditions. */
export const studioProcessing = pgEnum("studio_processing", ["uploading", "pending", "ready", "failed"]);
export const studioDownloadPolicy = pgEnum("studio_download_policy", ["none", "after_approval", "always"]);
export const studioVersionMode = pgEnum("studio_version_mode", ["latest", "pinned"]);
export const studioDecisionKind = pgEnum("studio_decision", ["approved", "changes_requested"]);

/** One uploaded file and its derived renditions. Keys are BlobStore keys; renditions are null until Tamtree has made them. */
export const studioFiles = pgTable(
  "studio_files",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    /** Null once a video's original has been deleted to save space (plan §5.3); downloads then get the clean preview. */
    originalKey: text("original_key"),
    originalName: text("original_name").notNull(),
    mime: text("mime").notNull(),
    /** Size of the original as uploaded. */
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    /** Everything Tamtree stored for this file, for the storage meter. */
    derivedBytes: bigint("derived_bytes", { mode: "number" }).notNull().default(0),
    /** Hex SHA-256 of the original, computed by Tamtree from the stored file. A sign-off records it. */
    sha256: text("sha256"),
    width: integer("width"),
    height: integer("height"),
    durationS: real("duration_s"),
    /** Frame rate as ffprobe reports it (30000/1001 stays exact). */
    fpsNum: integer("fps_num"),
    fpsDen: integer("fps_den"),
    previewKey: text("preview_key"),
    thumbKey: text("thumb_key"),
    posterKey: text("poster_key"),
    wmPreviewKey: text("wm_preview_key"),
    processing: studioProcessing("processing").notNull().default("uploading"),
    /** When a Tamtree run took this file, so two runs don't make the same renditions. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    /** Plain English, shown to the owner when processing fails. */
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("studio_files_org").on(t.orgId), index("studio_files_processing").on(t.processing, t.createdAt)],
);

/** Blobs whose delete failed; the daily cleanup tries again. */
export const deletedBlobs = pgTable("deleted_blobs", {
  key: text("key").primaryKey(),
  failedAt: timestamp("failed_at", { withTimezone: true }).notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(1),
});

export const studioBrand = pgTable("studio_brand", {
  orgId: uuid("org_id").primaryKey().references(() => orgs.id, { onDelete: "cascade" }),
  studioName: text("studio_name").notNull(),
  accentHex: text("accent_hex").notNull().default("#1f6feb"),
  roomTheme: studioRoomTheme("room_theme").notNull().default("light"),
  website: text("website"),
  supportEmail: text("support_email"),
  updatedAt: updatedAt(),
});

export const studioClients = pgTable(
  "studio_clients",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    company: text("company"),
    contacts: jsonb("contacts").$type<{ name: string; email: string; role?: string }[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("studio_clients_org").on(t.orgId)],
);

export const studioProjects = pgTable(
  "studio_projects",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => studioClients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dueDate: text("due_date"),
    roundsIncluded: integer("rounds_included").notNull().default(2),
    status: studioProjectStatus("status").notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("studio_projects_org").on(t.orgId), index("studio_projects_client").on(t.clientId)],
);

export const studioAssets = pgTable(
  "studio_assets",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => studioProjects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: studioAssetKind("kind").notNull(),
    sort: integer("sort").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("studio_assets_project").on(t.projectId)],
);

/** A parallel design direction ("Option A"). Every asset has at least "Main". */
export const studioVariations = pgTable(
  "studio_variations",
  {
    id: id(),
    assetId: uuid("asset_id").notNull().references(() => studioAssets.id, { onDelete: "cascade" }),
    label: text("label").notNull().default("Main"),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("studio_variations_asset").on(t.assetId)],
);

/** One iteration of a variation. Comments, decisions and compare all belong here. */
export const studioVersions = pgTable(
  "studio_versions",
  {
    id: id(),
    variationId: uuid("variation_id").notNull().references(() => studioVariations.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    fileId: uuid("file_id").notNull().references(() => studioFiles.id),
    changeNote: text("change_note").notNull().default(""),
    status: studioVersionStatus("status").notNull().default("in_review"),
    createdBy: uuid("created_by").references(() => members.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("studio_versions_variation_number").on(t.variationId, t.number)],
);

/**
 * A review link. The URL token is stored twice: hashed for lookup, and AES-GCM encrypted
 * (STUDIO_SECRET) so the owner can copy the link again. The passcode is encrypted, never hashed,
 * for the same reason.
 */
export const studioShares = pgTable(
  "studio_shares",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => studioProjects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    message: text("message").notNull().default(""),
    notes: jsonb("notes").$type<string[]>().notNull().default([]),
    tokenHash: text("token_hash").notNull().unique(),
    tokenEnc: text("token_enc").notNull(),
    passcodeEnc: text("passcode_enc").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    downloadPolicy: studioDownloadPolicy("download_policy").notNull().default("after_approval"),
    watermark: boolean("watermark").notNull().default(true),
    commentsOpen: boolean("comments_open").notNull().default(true),
    versionMode: studioVersionMode("version_mode").notNull().default("latest"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => members.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("studio_shares_project").on(t.projectId)],
);

export const studioShareItems = pgTable(
  "studio_share_items",
  {
    shareId: uuid("share_id").notNull().references(() => studioShares.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => studioAssets.id, { onDelete: "cascade" }),
    sort: integer("sort").notNull().default(0),
    /** Used when the share's version_mode is `pinned`. */
    pinnedVersionIds: jsonb("pinned_version_ids").$type<string[]>().notNull().default([]),
  },
  (t) => [primaryKey({ columns: [t.shareId, t.assetId] })],
);

/** A guest who opened a share and gave a name and email. Email is stored lower-case. */
export const studioReviewers = pgTable(
  "studio_reviewers",
  {
    id: id(),
    shareId: uuid("share_id").notNull().references(() => studioShares.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("studio_reviewers_share_email").on(t.shareId, t.email)],
);

export const studioShareSessions = pgTable(
  "studio_share_sessions",
  {
    id: id(),
    shareId: uuid("share_id").notNull().references(() => studioShares.id, { onDelete: "cascade" }),
    /** Null between the passcode gate and the identity step. */
    reviewerId: uuid("reviewer_id").references(() => studioReviewers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    ip: text("ip"),
    ua: text("ua"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("studio_share_sessions_share").on(t.shareId)],
);

/**
 * Two levels: a root (numbered per version, may carry an annotation) and replies to it.
 * `quoteId` points at another reply in the same thread ("replying to Sam: …").
 */
export const studioComments = pgTable(
  "studio_comments",
  {
    id: id(),
    versionId: uuid("version_id").notNull().references(() => studioVersions.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => studioComments.id, { onDelete: "cascade" }),
    quoteId: uuid("quote_id").references((): AnyPgColumn => studioComments.id, { onDelete: "set null" }),
    /** Roots only: #n on the canvas and in the rail. */
    number: integer("number"),
    authorMemberId: uuid("author_member_id").references(() => members.id, { onDelete: "set null" }),
    authorReviewerId: uuid("author_reviewer_id").references(() => studioReviewers.id, { onDelete: "set null" }),
    /** The name shown, kept so a deleted author still reads correctly. */
    authorLabel: text("author_label").notNull(),
    body: text("body").notNull(),
    /** `{v:1, shape, x, y, w?, h?, t?, tEnd?, frame?}`, normalised 0..1 (src/lib/studio/annotation.ts). */
    annotation: jsonb("annotation").$type<Record<string, unknown> | null>(),
    /** Owner and editor only; never sent to the review room. */
    internal: boolean("internal").notNull().default(false),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByLabel: text("resolved_by_label"),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("studio_comments_version").on(t.versionId, t.createdAt),
    index("studio_comments_parent").on(t.parentId),
    uniqueIndex("studio_comments_version_number").on(t.versionId, t.number).where(sql`${t.parentId} is null`),
    check("studio_comments_reply_shape", sql`${t.parentId} is null or (${t.number} is null and ${t.annotation} is null)`),
    check("studio_comments_root_numbered", sql`${t.parentId} is not null or ${t.number} is not null`),
    check("studio_comments_quote_needs_parent", sql`${t.quoteId} is null or ${t.parentId} is not null`),
  ],
);

/** Sign-off record. Append-only: a trigger in the initial migration refuses UPDATE (bar the reviewer unlink). */
export const studioDecisions = pgTable(
  "studio_decisions",
  {
    id: id(),
    versionId: uuid("version_id").notNull().references(() => studioVersions.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id").references(() => studioReviewers.id, { onDelete: "set null" }),
    decision: studioDecisionKind("decision").notNull(),
    signedName: text("signed_name").notNull(),
    email: text("email").notNull(),
    ip: text("ip"),
    ua: text("ua"),
    fileSha256: text("file_sha256").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("studio_decisions_version").on(t.versionId, t.createdAt)],
);

/** Activity log. A later Tamtree flow can send notifications from it. */
export const studioEvents = pgTable(
  "studio_events",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => studioProjects.id, { onDelete: "cascade" }),
    shareId: uuid("share_id").references(() => studioShares.id, { onDelete: "set null" }),
    actorLabel: text("actor_label").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("studio_events_project").on(t.projectId, t.createdAt), index("studio_events_share").on(t.shareId, t.createdAt)],
);

/** Fixed-window counters for the gate, sign-in, comment posting and identity creation. */
export const studioRateLimits = pgTable(
  "studio_rate_limits",
  {
    bucket: text("bucket").notNull(),
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.bucket, t.key, t.windowStart] })],
);
