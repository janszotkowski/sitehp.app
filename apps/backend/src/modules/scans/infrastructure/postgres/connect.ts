import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '@modules/scans/infrastructure/postgres/schema.ts';
import type { Db } from '@modules/scans/infrastructure/postgres/stores.ts';

/**
 * The migrations folder of this package. Found by walking up from this file, because the code runs from `src/...` in tests
 * and from a single bundled file in `dist/` in production, and the folder sits beside both.
 */
export const migrationsFolder = (from: string = import.meta.url): string => {
    for (let directory = dirname(fileURLToPath(from)); ; directory = dirname(directory)) {
        const candidate = join(directory, 'drizzle');
        if (existsSync(join(candidate, 'meta', '_journal.json'))) return candidate;
        if (dirname(directory) === directory) throw new Error('the database migrations folder was not found');
    }
};

export type Database = { db: Db; close: () => Promise<void> };

/**
 * No call waits on the database for ever: a connection that cannot be made, a statement that runs too long and a transaction left open
 * all end in an error, which the caller handles (a scan fails, a request answers 500) instead of holding a worker slot or a pool connection.
 * `connect_timeout` is in seconds, the other two in milliseconds.
 */
const timeouts = (statementMs: number) => ({
    connect_timeout: 10,
    connection: { statement_timeout: statementMs, idle_in_transaction_session_timeout: 30_000 },
});

/** Any fixed number, the same in every process: the advisory lock under which migrations run. */
const MIGRATION_LOCK = 73_140_001;

/**
 * Applies the pending migrations under a database-wide lock, on a connection of its own: the API and the workers start at the same
 * time, and drizzle's migrator takes no lock, so two of them would run the same DDL and one would crash. The others wait, then find
 * nothing left to do. Closing the connection releases the lock, also when a migration fails.
 */
const migrateUnderLock = async (url: string): Promise<void> => {
    // Generous: this one waits for the lock while another process migrates, and a migration may rewrite a table.
    const client = postgres(url, { max: 1, onnotice: () => undefined, ...timeouts(300_000) });
    try {
        await client`select pg_advisory_lock(${MIGRATION_LOCK})`;
        await migrate(drizzle(client), { migrationsFolder: migrationsFolder() });
    } finally {
        await client.end({ timeout: 5 });
    }
};

/** Opens the pool on the schema as it is: for a tool that only reads, which must not change the database it looks at. */
export const openDatabase = (url: string): Database => {
    const client = postgres(url, { max: 10, onnotice: () => undefined, ...timeouts(15_000) });
    return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
};

/** Brings the schema up to date, then opens the pool, so a deploy and its migration cannot drift apart. */
export const connectDatabase = async (url: string): Promise<Database> => {
    await migrateUnderLock(url);
    return openDatabase(url);
};
