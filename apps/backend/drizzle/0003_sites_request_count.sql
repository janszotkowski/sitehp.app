ALTER TABLE "sites" ADD COLUMN "request_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Before this column every request that was not blocked started a scan, so the scans so far are the requests so far.
UPDATE "sites" SET "request_count" = "scan_count";