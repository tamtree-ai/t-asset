CREATE TYPE "public"."hook_delivery_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."hook_mode" AS ENUM('push', 'pull');--> statement-breakpoint
CREATE TABLE "hook_deliveries" (
	"event_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"status" "hook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_http_status" integer,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hook_deliveries_event_id_subscription_id_pk" PRIMARY KEY("event_id","subscription_id")
);
--> statement-breakpoint
CREATE TABLE "hook_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mode" "hook_mode" NOT NULL,
	"events" text[] NOT NULL,
	"url" text,
	"secret_enc" text,
	"feed_token_hash" text,
	"credential_hint" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"last_polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hook_subscriptions_feed_token_hash_unique" UNIQUE("feed_token_hash"),
	CONSTRAINT "hook_subscriptions_events_nonempty" CHECK (cardinality("hook_subscriptions"."events") > 0),
	CONSTRAINT "hook_subscriptions_push_url" CHECK ("hook_subscriptions"."mode" <> 'push' or ("hook_subscriptions"."url" is not null and "hook_subscriptions"."secret_enc" is not null)),
	CONSTRAINT "hook_subscriptions_pull_token" CHECK ("hook_subscriptions"."mode" <> 'pull' or "hook_subscriptions"."feed_token_hash" is not null)
);
--> statement-breakpoint
ALTER TABLE "hook_deliveries" ADD CONSTRAINT "hook_deliveries_event_id_studio_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."studio_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hook_deliveries" ADD CONSTRAINT "hook_deliveries_subscription_id_hook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."hook_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hook_subscriptions" ADD CONSTRAINT "hook_subscriptions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hook_deliveries_due" ON "hook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "hook_deliveries_subscription" ON "hook_deliveries" USING btree ("subscription_id","created_at");--> statement-breakpoint
CREATE INDEX "hook_subscriptions_org" ON "hook_subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "studio_events_org" ON "studio_events" USING btree ("org_id","created_at");