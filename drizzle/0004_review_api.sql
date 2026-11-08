CREATE TABLE "studio_api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"scopes" text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studio_api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "studio_assets" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "studio_versions" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "studio_versions" ADD COLUMN "built_from_version_id" uuid;--> statement-breakpoint
ALTER TABLE "studio_api_tokens" ADD CONSTRAINT "studio_api_tokens_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_api_tokens_org" ON "studio_api_tokens" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "studio_versions" ADD CONSTRAINT "studio_versions_built_from_version_id_studio_versions_id_fk" FOREIGN KEY ("built_from_version_id") REFERENCES "public"."studio_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "studio_assets_project_external_ref" ON "studio_assets" USING btree ("project_id","external_ref") WHERE "studio_assets"."external_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "studio_versions_variation_external_ref" ON "studio_versions" USING btree ("variation_id","external_ref") WHERE "studio_versions"."external_ref" is not null;--> statement-breakpoint
CREATE INDEX "studio_versions_built_from" ON "studio_versions" USING btree ("built_from_version_id");