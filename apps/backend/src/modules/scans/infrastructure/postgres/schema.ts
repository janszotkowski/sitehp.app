import type { ScanEvent, ScanSnapshot } from '@sitehp.app/core';
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Every domain a visitor ever asked to scan, kept for good: which companies the product scores, how often, how they did. Only the host is
 * kept here, never the path, the query or who asked, so the table holds nothing that is private to a visitor. The reports themselves expire (`scans`).
 */
export const sites = pgTable('sites', {
    domain: text('domain').primaryKey(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    /** Every request that was not blocked: scans started, recent scans handed out again, requests over the rate limit. */
    requestCount: integer('request_count').notNull().default(0),
    /** Scans started. */
    scanCount: integer('scan_count').notNull().default(0),
    /** Requests refused because the domain is blocked. */
    blockedCount: integer('blocked_count').notNull().default(0),
    lastScore: integer('last_score'),
    /** When the scan behind `last_score` started: a scan that started earlier never overwrites it. */
    lastScanAt: timestamp('last_scan_at', { withTimezone: true }),
});

/** A scan. The snapshot is the whole state a client draws; the columns beside it are what is queried and what retention needs. */
export const scans = pgTable(
    'scans',
    {
        publicId: text('public_id').primaryKey(),
        domain: text('domain').notNull(),
        url: text('url').notNull(),
        status: text('status').notNull(),
        score: integer('score'),
        /** The score model the score was computed with; scores are only compared within one version. */
        engineVersion: integer('engine_version').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
        finishedAt: timestamp('finished_at', { withTimezone: true }),
        snapshot: jsonb('snapshot').$type<ScanSnapshot>().notNull(),
    },
    (table) => [
        index('scans_created_at_idx').on(table.createdAt),
        index('scans_domain_idx').on(table.domain),
        // A recent scan of the same address is handed out again (`findRecent`), looked up on every new scan.
        index('scans_url_created_at_idx').on(table.url, table.createdAt),
        // The reaper's query (`listRunningIdleSince`): only the few running scans, not the whole retention window.
        index('scans_running_created_at_idx')
            .on(table.createdAt)
            .where(sql`${table.status} = 'running'`),
    ],
);

/** The durable log of a scan. `id` is the event's position in that scan's log (1, 2, 3 ...), which is also the id a client resumes from. */
export const scanEvents = pgTable(
    'scan_events',
    {
        scanId: text('scan_id')
            .notNull()
            .references(() => scans.publicId, { onDelete: 'cascade' }),
        id: integer('id').notNull(),
        type: text('type').notNull(),
        ts: timestamp('ts', { withTimezone: true }).notNull(),
        event: jsonb('event').$type<ScanEvent>().notNull(),
    },
    (table) => [primaryKey({ columns: [table.scanId, table.id] })],
);
