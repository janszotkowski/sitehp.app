import { loadConfig } from '@config/env.ts';
import { openDatabase } from '@modules/scans/infrastructure/postgres/connect.ts';
import { createPostgresSiteLog } from '@modules/scans/infrastructure/postgres/stores.ts';

/** Prints the domains that were ever asked to scan (`pnpm --filter @sitehp.app/backend sites`): who is scored, how often, how they did, what was refused. */
const loaded = loadConfig();
if (!loaded.ok || loaded.config.DATABASE_URL === undefined) {
    process.stderr.write(`${loaded.ok ? 'DATABASE_URL is not set.' : `Invalid configuration:\n${loaded.problems.join('\n')}`}\n`);
    process.exit(1);
}

// Read-only: no migrations here. A database the API or a worker has not migrated yet fails the query below with a clear error.
const database = openDatabase(loaded.config.DATABASE_URL);
const sites = await createPostgresSiteLog(database.db).list();
const day = (date: Date | null): string => (date === null ? '-' : date.toISOString().slice(0, 10));
process.stdout.write(`${'domain'.padEnd(40)} ${'requests'.padStart(8)} ${'scans'.padStart(5)} ${'blocked'.padStart(7)} ${'score'.padStart(5)}  first seen  last seen\n`);
for (const site of sites) {
    process.stdout.write(
        `${site.domain.padEnd(40)} ${String(site.requestCount).padStart(8)} ${String(site.scanCount).padStart(5)} ${String(site.blockedCount).padStart(7)} ${String(site.lastScore ?? '-').padStart(5)}  ${day(site.firstSeenAt)}  ${day(site.lastSeenAt)}\n`,
    );
}
process.stdout.write(`${sites.length} domains\n`);
await database.close();
