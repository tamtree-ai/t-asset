ALTER TYPE "public"."studio_asset_kind" ADD VALUE 'document';--> statement-breakpoint
ALTER TYPE "public"."studio_download_policy" ADD VALUE 'after_payment';--> statement-breakpoint
CREATE TABLE "studio_version_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio_files" ADD COLUMN "page_count" integer;--> statement-breakpoint
ALTER TABLE "studio_shares" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "studio_version_files" ADD CONSTRAINT "studio_version_files_version_id_studio_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."studio_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_version_files" ADD CONSTRAINT "studio_version_files_file_id_studio_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."studio_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "studio_version_files_version_file" ON "studio_version_files" USING btree ("version_id","file_id");--> statement-breakpoint
CREATE INDEX "studio_version_files_file" ON "studio_version_files" USING btree ("file_id");--> statement-breakpoint
ALTER TABLE "studio_shares" ADD CONSTRAINT "studio_shares_invoice_id_studio_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."studio_invoices"("id") ON DELETE set null ON UPDATE no action;