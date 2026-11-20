import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScansService } from '@modules/scans/application/scans-service.ts';
import { createReplayFetcher, loadDemoSite, readDemoSite } from '@modules/scans/infrastructure/replay-fetcher.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testContainer } from '@tests/helpers.ts';

const DEMO_SITES = fileURLToPath(new URL('../demo-sites', import.meta.url));
const slugs = readdirSync(DEMO_SITES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

/** A whole scan normally settles in milliseconds; 10 s leaves room for a loaded CI machine without hiding a hung scan. */
const SETTLE_WITHIN_MS = 10_000;

const settled = async (scans: ScansService, publicId: string) => {
    for (const deadline = Date.now() + SETTLE_WITHIN_MS; Date.now() < deadline;) {
        const snapshot = await scans.get(publicId);
        if (snapshot.status !== 'running') return snapshot;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('the scan never finished');
};

/** Every demo site through the production scan pipeline, offline: the `expect` of its site.json holds, and the whole result matches its snapshot. */
// Vitest's own 5 s per test would cut the wait above short.
describe('demo sites', { timeout: SETTLE_WITHIN_MS + 5000 }, () => {
    // The not-found probe's random path ends up in the evidence; a fixed one keeps the snapshots stable.
    beforeEach(() => void vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111'));
    afterEach(() => void vi.restoreAllMocks());

    it.each(slugs)('%s', async (slug) => {
        const dir = join(DEMO_SITES, slug);
        const site = readDemoSite(dir);
        const fetcher = createReplayFetcher([loadDemoSite(dir)]);
        const { scans } = testContainer({}, fetcher);
        const done = await settled(scans, (await scans.create(site.url)).publicId);
        const fetched = await fetcher.fetchPage(site.url);

        const checks = done.checks
            .map((check) => ({ id: check.checkId, status: check.status, ...(check.skippedReason === undefined ? {} : { skippedReason: check.skippedReason }), evidence: check.evidence }))
            .sort((left, right) => left.id.localeCompare(right.id));
        const actual: Record<string, unknown> = Object.fromEntries(checks.map((check) => [check.id, check.skippedReason === undefined ? check.status : `${check.status}:${check.skippedReason}`]));
        actual['score'] = done.score;
        // `skipped` alone accepts any reason; `skipped:<reason>` names it.
        const wanted = Object.fromEntries(
            Object.entries(site.expect ?? {}).map(([id, status]) => [id, status === 'skipped' && typeof actual[id] === 'string' && actual[id].startsWith('skipped') ? actual[id] : status]),
        );
        expect.soft(Object.fromEntries(Object.keys(wanted).map((id) => [id, actual[id]]))).toEqual(wanted);

        const result = { url: done.url, finalUrl: fetched.ok ? fetched.page.finalUrl : null, scanStatus: done.status, score: done.score, checks };
        await expect(`${JSON.stringify(result, null, 4)}\n`).toMatchFileSnapshot(`__snapshots__/demo-sites/${slug}.json`);
    });
});
