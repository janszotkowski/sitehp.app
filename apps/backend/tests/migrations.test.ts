import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from '@modules/scans/infrastructure/postgres/connect.ts';

/**
 * A deploy runs the new migration while the old workers still run (see "Deploying a new version" in apps/backend/README.md), so a
 * migration only adds: a new table, a nullable column or one with a default, an index. A statement that would break the old code
 * (drop, rename, a type change, NOT NULL on an existing column) is allowed only in a migration marked `-- contract: <why>`, released
 * after every process runs a version that no longer uses what it removes.
 */
const BREAKING = [/\bdrop\s+(table|column|index|type|schema|view|constraint)\b/i, /\brename\b/i, /\balter\s+column\b[^;]*\b(type|set\s+not\s+null)\b/i, /\btruncate\b/i];

describe('the database migrations', () => {
    const folder = migrationsFolder();
    const files = readdirSync(folder).filter((file) => file.endsWith('.sql'));

    it('exist', () => {
        expect(files.length).toBeGreaterThan(0);
    });

    it.each(files)('%s only adds, or is marked as a contract step', (file) => {
        const sql = readFileSync(join(folder, file), 'utf8');
        if (/^--\s*contract:\s*\S/m.test(sql)) return;
        const code = sql.replace(/--.*$/gm, '');
        for (const pattern of BREAKING) expect(code, `${file}: ${pattern}`).not.toMatch(pattern);
    });

    it('would catch a breaking statement', () => {
        const breaking = [
            'ALTER TABLE "scans" DROP COLUMN "score";',
            'ALTER TABLE "scans" RENAME COLUMN "a" TO "b";',
            'ALTER TABLE "scans" ALTER COLUMN "score" SET NOT NULL;',
            'ALTER TABLE "scans" ALTER COLUMN "score" TYPE text;',
        ];
        for (const sql of breaking)
            expect(
                BREAKING.some((pattern) => pattern.test(sql)),
                sql,
            ).toBe(true);
        expect(BREAKING.some((pattern) => pattern.test('ALTER TABLE "scans" ADD COLUMN "note" text;'))).toBe(false);
    });

    // drizzle-kit compares the schema with the snapshot of the last migration, offline: a change to schema.ts without its migration shows up as a new file.
    it('match the schema: generating finds nothing to migrate', { timeout: 30_000 }, () => {
        const root = resolve(import.meta.dirname, '..');
        const copy = mkdtempSync(join(tmpdir(), 'sitehp-migrations-'));
        try {
            cpSync(folder, copy, { recursive: true });
            // drizzle-kit takes `--out` relative to the working directory.
            const output = execFileSync(
                join(root, 'node_modules/.bin/drizzle-kit'),
                ['generate', '--dialect', 'postgresql', '--schema', './src/modules/scans/infrastructure/postgres/schema.ts', '--out', relative(root, copy)],
                {
                    cwd: root,
                    encoding: 'utf8',
                },
            );
            expect(readdirSync(copy).filter((file) => file.endsWith('.sql'))).toEqual(files);
            expect(output).toContain('No schema changes');
        } finally {
            rmSync(copy, { recursive: true, force: true });
        }
    });
});
