import { createApp } from '@composition/app.ts';
import { buildContainer, type Container } from '@composition/deps.ts';
import { loadConfig, type Config } from '@config/env.ts';
import type { CertificateInfo, FetchedPage } from '@sitehp.app/core';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { migrationsFolder, type Database } from '@modules/scans/infrastructure/postgres/connect.ts';
import * as schema from '@modules/scans/infrastructure/postgres/schema.ts';
import type { SiteFetcher, SiteFetchResult } from '@modules/scans/ports.ts';
import type { IdGenerator } from '@platform/ports.ts';
import { createLogger, type Logger } from '@platform/logger.ts';

export const FIXED_TIME = new Date('2026-10-09T12:00:00.000Z');

export const testConfig = (overrides: Record<string, string> = {}): Config => {
    const loaded = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', ...overrides });
    if (!loaded.ok) throw new Error(loaded.problems.join('; '));
    return loaded.config;
};

/** Predictable public ids that still match the real format: 22 URL-safe characters. */
export const sequentialIds = (): IdGenerator => {
    let n = 0;
    return {
        next: () => {
            n += 1;
            return `test-id-${String(n).padStart(14, '0')}`;
        },
    };
};

/** A page that passes every SEO check, so a test of the score starts from a perfect site. */
const GOOD_HTML =
    '<!doctype html><html lang="en"><head><title>A good page title that is long enough</title>' +
    `<meta name="description" content="${'d'.repeat(100)}"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    '<link rel="canonical" href="https://example.com/"><link rel="icon" href="/favicon.ico">' +
    '<meta property="og:title" content="T"><meta property="og:description" content="D"><meta property="og:image" content="https://example.com/i.png"><meta property="og:url" content="https://example.com/">' +
    '<meta property="og:type" content="website"><meta property="og:site_name" content="Example"><meta property="og:locale" content="en_US"><meta property="og:image:alt" content="A picture">' +
    '<meta name="twitter:card" content="summary"><script type="application/ld+json">{"@type":"WebSite"}</script></head><body><h1>Hello</h1><h2>Sub</h2><img src="/a.png" alt="A" width="10" height="10"><p>' +
    'A readable sentence about what this page offers to a visitor. '.repeat(8) +
    '</p></body></html>';

export const cannedPage = (overrides: Partial<FetchedPage> = {}): FetchedPage => ({
    finalUrl: 'https://example.com/',
    status: 200,
    redirects: [],
    headers: {
        'content-type': 'text/html',
        'content-encoding': 'gzip',
        'strict-transport-security': 'max-age=31536000',
        'content-security-policy': "default-src 'self'; base-uri 'none'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'permissions-policy': 'camera=()',
        'cross-origin-opener-policy': 'same-origin',
    },
    cookies: [],
    contentType: 'text/html',
    body: GOOD_HTML,
    bytes: GOOD_HTML.length,
    transferredBytes: GOOD_HTML.length,
    alpn: 'h2',
    truncated: false,
    ttfbMs: 12,
    totalMs: 20,
    ...overrides,
});

export const goodCertificate: CertificateInfo = { authorized: true, error: null, validTo: '2027-01-01T00:00:00.000Z', daysLeft: 90, issuer: 'Test CA' };

/**
 * A fetcher that never opens a socket: answers every fetch (the page and the http probe) with a canned page, or with the
 * given result, and shows a valid certificate unless told otherwise. Records the URLs it was asked for.
 */
export const fakeFetcher = (result: SiteFetchResult = { ok: true, page: cannedPage() }, certificate: CertificateInfo | null = goodCertificate): SiteFetcher & { requested: string[] } => {
    const requested: string[] = [];
    return {
        requested,
        fetchPage: (url, options) => {
            requested.push(url);
            if (!result.ok) return Promise.resolve(result);
            const { pathname, host } = new URL(url);
            const answer = (overrides: Partial<FetchedPage>): Promise<SiteFetchResult> => Promise.resolve({ ok: true, page: cannedPage({ finalUrl: url, ...overrides }) });
            // The files around the page answer like a healthy site's would, so a test of the score starts from a perfect one.
            if (pathname === '/robots.txt') return answer({ contentType: 'text/plain', body: 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n' });
            if (pathname === '/llms.txt') return answer({ contentType: 'text/markdown', body: '# Example\n\n> A test site.\n\n- [Home](https://example.com/): start\n' });
            // Asked for Markdown, the page answers in Markdown.
            if (/markdown/.test(options?.accept ?? '') && pathname === new URL(result.page.finalUrl).pathname)
                return answer({ contentType: 'text/markdown; charset=utf-8', headers: { vary: 'Accept' }, body: '# Example' });
            if (pathname === '/sitemap.xml') return answer({ contentType: 'application/xml', body: '<?xml version="1.0"?><urlset><url><loc>https://example.com/</loc></url></urlset>' });
            if (pathname.startsWith('/sitehp-check-')) return answer({ status: 404 });
            // The other host name (www added or removed) redirects to the scanned one.
            if (host !== new URL(result.page.finalUrl).host && pathname === '/') return answer({ finalUrl: result.page.finalUrl, redirects: [{ from: url, to: result.page.finalUrl, status: 301 }] });
            return Promise.resolve(result);
        },
        inspectCertificate: () => Promise.resolve(certificate),
        close: () => Promise.resolve(),
    };
};

/** A real PostgreSQL in the test process (PGlite), with the migrations applied: the same queries as production, no server to start. */
export const testDatabase = async (): Promise<Database> => {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationsFolder() });
    return { db, close: () => client.close() };
};

export const testContainer = (overrides: Record<string, string> = {}, fetcher: SiteFetcher = fakeFetcher(), database?: Database, logger?: Logger): Container =>
    buildContainer(testConfig(overrides), {
        clock: { now: () => FIXED_TIME },
        ids: sequentialIds(),
        fetcher,
        ...(database === undefined ? {} : { database }),
        ...(logger === undefined ? {} : { logger }),
    });

/** A logger that keeps every line (all the way down to trace), so a test can read what was logged. */
export const captureLogs = (): { logger: Logger; lines: () => Array<Record<string, unknown>>; text: () => string } => {
    const raw: string[] = [];
    const logger = createLogger({ LOG_LEVEL: 'trace' }, 'api', { write: (line: string) => void raw.push(line) });
    return { logger, lines: () => raw.map((line) => JSON.parse(line) as Record<string, unknown>), text: () => raw.join('') };
};

export const testApp = (overrides: Record<string, string> = {}) => createApp(testContainer(overrides));

/** Parses an SSE body into its messages (comments are returned separately). */
export const parseSse = (body: string): { messages: Array<{ id?: string; event?: string; data?: string }>; comments: string[] } => {
    const messages: Array<{ id?: string; event?: string; data?: string }> = [];
    const comments: string[] = [];
    for (const block of body.split('\n\n')) {
        if (block.trim() === '') continue;
        const message: { id?: string; event?: string; data?: string } = {};
        for (const line of block.split('\n')) {
            if (line.startsWith(':')) comments.push(line.slice(1).trim());
            else if (line.startsWith('id:')) message.id = line.slice(3).trim();
            else if (line.startsWith('event:')) message.event = line.slice(6).trim();
            else if (line.startsWith('data:')) message.data = line.slice(5).trim();
        }
        if (message.id !== undefined || message.event !== undefined || message.data !== undefined) messages.push(message);
    }
    return { messages, comments };
};
