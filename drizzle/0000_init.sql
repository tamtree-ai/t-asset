CREATE TYPE "public"."member_role" AS ENUM('owner', 'editor');--> statement-breakpoint
CREATE TYPE "public"."studio_asset_kind" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TYPE "public"."studio_decision" AS ENUM('approved', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."studio_download_policy" AS ENUM('none', 'after_approval', 'always');--> statement-breakpoint
CREATE TYPE "public"."studio_processing" AS ENUM('uploading', 'pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."studio_project_status" AS ENUM('active', 'paused', 'delivered');--> statement-breakpoint
CREATE TYPE "public"."studio_room_theme" AS ENUM('light', 'dark', 'auto');--> statement-breakpoint
CREATE TYPE "public"."studio_version_mode" AS ENUM('latest', 'pinned');--> statement-breakpoint
CREATE TYPE "public"."studio_version_status" AS ENUM('in_review', 'changes_requested', 'approved');--> statement-breakpoint
CREATE TABLE "deleted_blobs" (
	"key" text PRIMARY KEY NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" "member_role" DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "studio_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" "studio_asset_kind" NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_brand" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"studio_name" text NOT NULL,
	"accent_hex" text DEFAULT '#1f6feb' NOT NULL,
	"room_theme" "studio_room_theme" DEFAULT 'light' NOT NULL,
	"website" text,
	"support_email" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"parent_id" uuid,
	"quote_id" uuid,
	"number" integer,
	"author_member_id" uuid,
	"author_reviewer_id" uuid,
	"author_label" text NOT NULL,
	"body" text NOT NULL,
	"annotation" jsonb,
	"internal" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_label" text,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studio_comments_reply_shape" CHECK ("studio_comments"."parent_id" is null or ("studio_comments"."number" is null and "studio_comments"."annotation" is null)),
	CONSTRAINT "studio_comments_root_numbered" CHECK ("studio_comments"."parent_id" is not null or "studio_comments"."number" is not null),
	CONSTRAINT "studio_comments_quote_needs_parent" CHECK ("studio_comments"."quote_id" is null or "studio_comments"."parent_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "studio_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"decision" "studio_decision" NOT NULL,
	"signed_name" text NOT NULL,
	"email" text NOT NULL,
	"ip" text,
	"ua" text,
	"file_sha256" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"share_id" uuid,
	"actor_label" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"original_key" text,
	"original_name" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint NOT NULL,
	"derived_bytes" bigint DEFAULT 0 NOT NULL,
	"sha256" text,
	"width" integer,
	"height" integer,
	"duration_s" real,
	"fps_num" integer,
	"fps_den" integer,
	"preview_key" text,
	"thumb_key" text,
	"poster_key" text,
	"wm_preview_key" text,
	"processing" "studio_processing" DEFAULT 'uploading' NOT NULL,
	"claimed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"due_date" text,
	"rounds_included" integer DEFAULT 2 NOT NULL,
	"status" "studio_project_status" DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_rate_limits" (
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "studio_rate_limits_bucket_key_window_start_pk" PRIMARY KEY("bucket","key","window_start")
);
--> statement-breakpoint
CREATE TABLE "studio_reviewers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_share_items" (
	"share_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"pinned_version_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "studio_share_items_share_id_asset_id_pk" PRIMARY KEY("share_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "studio_share_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"token_hash" text NOT NULL,
	"ip" text,
	"ua" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studio_share_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "studio_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"token_enc" text NOT NULL,
	"passcode_enc" text NOT NULL,
	"expires_at" timestamp with time zone,
	"download_policy" "studio_download_policy" DEFAULT 'after_approval' NOT NULL,
	"watermark" boolean DEFAULT true NOT NULL,
	"comments_open" boolean DEFAULT true NOT NULL,
	"version_mode" "studio_version_mode" DEFAULT 'latest' NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studio_shares_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "studio_variations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"label" text DEFAULT 'Main' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variation_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"file_id" uuid NOT NULL,
	"change_note" text DEFAULT '' NOT NULL,
	"status" "studio_version_status" DEFAULT 'in_review' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_assets" ADD CONSTRAINT "studio_assets_project_id_studio_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."studio_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_brand" ADD CONSTRAINT "studio_brand_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_clients" ADD CONSTRAINT "studio_clients_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_comments" ADD CONSTRAINT "studio_comments_version_id_studio_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."studio_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_comments" ADD CONSTRAINT "studio_comments_parent_id_studio_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."studio_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_comments" ADD CONSTRAINT "studio_comments_quote_id_studio_comments_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."studio_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_comments" ADD CONSTRAINT "studio_comments_author_member_id_members_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_comments" ADD CONSTRAINT "studio_comments_author_reviewer_id_studio_reviewers_id_fk" FOREIGN KEY ("author_reviewer_id") REFERENCES "public"."studio_reviewers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_decisions" ADD CONSTRAINT "studio_decisions_version_id_studio_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."studio_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_decisions" ADD CONSTRAINT "studio_decisions_reviewer_id_studio_reviewers_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."studio_reviewers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_events" ADD CONSTRAINT "studio_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_events" ADD CONSTRAINT "studio_events_project_id_studio_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."studio_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_events" ADD CONSTRAINT "studio_events_share_id_studio_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."studio_shares"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_files" ADD CONSTRAINT "studio_files_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_projects" ADD CONSTRAINT "studio_projects_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_projects" ADD CONSTRAINT "studio_projects_client_id_studio_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."studio_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_reviewers" ADD CONSTRAINT "studio_reviewers_share_id_studio_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."studio_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_share_items" ADD CONSTRAINT "studio_share_items_share_id_studio_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."studio_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_share_items" ADD CONSTRAINT "studio_share_items_asset_id_studio_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."studio_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_share_sessions" ADD CONSTRAINT "studio_share_sessions_share_id_studio_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."studio_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_share_sessions" ADD CONSTRAINT "studio_share_sessions_reviewer_id_studio_reviewers_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."studio_reviewers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_shares" ADD CONSTRAINT "studio_shares_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_shares" ADD CONSTRAINT "studio_shares_project_id_studio_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."studio_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_shares" ADD CONSTRAINT "studio_shares_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_variations" ADD CONSTRAINT "studio_variations_asset_id_studio_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."studio_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_versions" ADD CONSTRAINT "studio_versions_variation_id_studio_variations_id_fk" FOREIGN KEY ("variation_id") REFERENCES "public"."studio_variations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_versions" ADD CONSTRAINT "studio_versions_file_id_studio_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."studio_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_versions" ADD CONSTRAINT "studio_versions_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "members_org_email" ON "members" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "studio_assets_project" ON "studio_assets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "studio_clients_org" ON "studio_clients" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "studio_comments_version" ON "studio_comments" USING btree ("version_id","created_at");--> statement-breakpoint
CREATE INDEX "studio_comments_parent" ON "studio_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_comments_version_number" ON "studio_comments" USING btree ("version_id","number") WHERE "studio_comments"."parent_id" is null;--> statement-breakpoint
CREATE INDEX "studio_decisions_version" ON "studio_decisions" USING btree ("version_id","created_at");--> statement-breakpoint
CREATE INDEX "studio_events_project" ON "studio_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "studio_events_share" ON "studio_events" USING btree ("share_id","created_at");--> statement-breakpoint
CREATE INDEX "studio_files_org" ON "studio_files" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "studio_files_processing" ON "studio_files" USING btree ("processing","created_at");--> statement-breakpoint
CREATE INDEX "studio_projects_org" ON "studio_projects" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "studio_projects_client" ON "studio_projects" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_reviewers_share_email" ON "studio_reviewers" USING btree ("share_id","email");--> statement-breakpoint
CREATE INDEX "studio_share_sessions_share" ON "studio_share_sessions" USING btree ("share_id");--> statement-breakpoint
CREATE INDEX "studio_shares_project" ON "studio_shares" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "studio_variations_asset" ON "studio_variations" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_versions_variation_number" ON "studio_versions" USING btree ("variation_id","number");--> statement-breakpoint
-- A sign-off is never edited, with one exception the database itself makes: when a reviewer row is
-- deleted (their share, client or project was), the foreign key's ON DELETE SET NULL clears
-- reviewer_id. That one change is allowed, with every other column untouched; the signed name,
-- email, time, address and file fingerprint stay on the record.
CREATE FUNCTION "studio_decisions_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.reviewer_id IS NOT NULL
     AND NEW.reviewer_id IS NULL
     AND (to_jsonb(NEW) - 'reviewer_id') = (to_jsonb(OLD) - 'reviewer_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'studio_decisions is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "studio_decisions_no_update" BEFORE UPDATE ON "studio_decisions" FOR EACH ROW EXECUTE FUNCTION "studio_decisions_append_only"();
