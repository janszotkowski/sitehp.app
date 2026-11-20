CREATE TABLE "scan_events" (
	"scan_id" text NOT NULL,
	"id" integer NOT NULL,
	"type" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"event" jsonb NOT NULL,
	CONSTRAINT "scan_events_scan_id_id_pk" PRIMARY KEY("scan_id","id")
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"public_id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"url" text NOT NULL,
	"status" text NOT NULL,
	"score" integer,
	"engine_version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"snapshot" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"domain" text PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"scan_count" integer DEFAULT 0 NOT NULL,
	"blocked_count" integer DEFAULT 0 NOT NULL,
	"last_score" integer,
	"last_scan_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_scan_id_scans_public_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("public_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scans_created_at_idx" ON "scans" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "scans_domain_idx" ON "scans" USING btree ("domain");