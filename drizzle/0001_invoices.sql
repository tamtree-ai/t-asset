CREATE TYPE "public"."studio_invoice_status" AS ENUM('draft', 'issued', 'paid', 'void');--> statement-breakpoint
CREATE TABLE "studio_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid,
	"number" text,
	"status" "studio_invoice_status" DEFAULT 'draft' NOT NULL,
	"issue_date" text NOT NULL,
	"due_date" text NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"discount" jsonb,
	"notes" text DEFAULT '' NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"snapshot" jsonb,
	"issued_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studio_invoices_number_when_issued" CHECK ("studio_invoices"."status" = 'draft' or ("studio_invoices"."number" is not null and "studio_invoices"."snapshot" is not null))
);
--> statement-breakpoint
ALTER TABLE "studio_brand" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "studio_brand" ADD COLUMN "abn" text;--> statement-breakpoint
ALTER TABLE "studio_brand" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "studio_brand" ADD COLUMN "gst_registered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_brand" ADD COLUMN "payment_terms_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_brand" ADD COLUMN "invoice_terms" text;--> statement-breakpoint
ALTER TABLE "studio_brand" ADD COLUMN "bank_account_name" text;--> statement-breakpoint
ALTER TABLE "studio_brand" ADD COLUMN "bank_bsb" text;--> statement-breakpoint
ALTER TABLE "studio_brand" ADD COLUMN "bank_account_no" text;--> statement-breakpoint
ALTER TABLE "studio_brand" ADD COLUMN "pay_by_post" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_brand" ADD COLUMN "invoice_prefix" text DEFAULT 'PD' NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_brand" ADD COLUMN "next_invoice_no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_brand" ADD COLUMN "invoice_logo" text;--> statement-breakpoint
ALTER TABLE "studio_clients" ADD COLUMN "billing_address" text;--> statement-breakpoint
ALTER TABLE "studio_invoices" ADD CONSTRAINT "studio_invoices_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_invoices" ADD CONSTRAINT "studio_invoices_client_id_studio_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."studio_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_invoices" ADD CONSTRAINT "studio_invoices_project_id_studio_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."studio_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_invoices_org" ON "studio_invoices" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "studio_invoices_client" ON "studio_invoices" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_invoices_org_number" ON "studio_invoices" USING btree ("org_id","number");