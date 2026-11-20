import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { z } from 'zod';
import type { CertificateInfo, FetchedPage } from '@sitehp.app/core';
import type { SiteFetcher, SiteFetchResult } from '@modules/scans/ports.ts';
import { registrableDomain } from '@platform/net/registrable-domain.ts';

/** Everything one scan of a site asked the network, and what it answered: the fetched addresses and the certificates looked at. */
export type Recording = {
    version: 1;
    /** The address the scan was started with. */
    site: string;
    recordedAt: string;
    pages: Record<string, SiteFetchResult>;
    certificates: Record<string, CertificateInfo | null>;
};

// The not-found probe asks for a fresh random path every scan (`site-probes.ts`), so it is matched by its shape and answered with the asked path.
/** Added to a demo site's address to say "as answered to `Accept: text/markdown`". */
const MARKDOWN_KEY = '#accept=markdown';

const PROBE_PATH = /\/sitehp-check-[0-9a-f-]{36}/;

/**
 * Answers from recordings instead of the network: the browser tests and `dev:demo` use it, so a scan is the same every run.
 * An address no recording holds does not answer, as an unreachable site would not.
 */
export const createReplayFetcher = (recordings: readonly Recording[]): SiteFetcher => {
    const pages = new Map<string, SiteFetchResult>();
    const certificates = new Map<string, CertificateInfo | null>();
    for (const recording of recordings) {
        for (const [url, result] of Object.entries(recording.pages)) pages.set(url.replace(PROBE_PATH, '/sitehp-check-*'), result);
        for (const [host, info] of Object.entries(recording.certificates)) certificates.set(host, info);
    }
    return {
        fetchPage: (url, options) => {
            // Asked as the real fetcher would send it: `https://host` is `https://host/`. A request for Markdown is answered by the `#accept=markdown` entry of the address when a demo site has one, else as for HTML (a site that ignores `Accept`).
            const key = URL.canParse(url) ? new URL(url).href.replace(PROBE_PATH, '/sitehp-check-*') : undefined;
            const result = key === undefined ? undefined : ((/markdown/i.test(options?.accept ?? '') ? pages.get(`${key}${MARKDOWN_KEY}`) : undefined) ?? pages.get(key));
            const asked = PROBE_PATH.exec(url)?.[0];
            if (result === undefined) return Promise.resolve({ ok: false, reason: 'unreachable' });
            // The real fetcher stops at the first hop that leaves the site; a recording only has the whole chain, so any hop off it counts.
            if (options?.stayOnSite === true && result.ok && result.page.redirects.some((hop) => registrableDomain(new URL(hop.to).hostname) !== registrableDomain(new URL(url).hostname)))
                return Promise.resolve({ ok: false, reason: 'unreachable' });
            if (asked === undefined) return Promise.resolve(result);
            return Promise.resolve(JSON.parse(JSON.stringify(result).replace(new RegExp(PROBE_PATH.source, 'g'), asked)) as SiteFetchResult);
        },
        inspectCertificate: (host) => Promise.resolve(certificates.get(host) ?? null),
        close: () => Promise.resolve(),
    };
};

/** One answer of a demo site: a file, or a redirect hop (`status` 301 unless given) to another answer. */
const demoResponseSchema = z.strictObject({
    status: z.number().int().min(100).max(599).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    file: z.string().min(1).optional(),
    redirect: z.string().min(1).optional(),
    cookies: z.array(z.string()).optional(),
});

/** `{ "daysLeft": 80 }` is enough: the rest defaults to a trusted certificate. */
const demoCertificateSchema = z.strictObject({
    authorized: z.boolean().optional(),
    error: z.string().nullable().optional(),
    validTo: z.string().optional(),
    daysLeft: z.number().int(),
    issuer: z.string().optional(),
});

const demoSiteSchema = z.strictObject({
    url: z.url(),
    note: z.string().min(1),
    /** Omitted: a trusted certificate with 90 days left. `null`: nothing answers TLS. */
    certificate: demoCertificateSchema.nullable().optional(),
    /** Keyed by absolute address; `/sitehp-check-*` stands for the random not-found probe. */
    responses: z.record(z.string(), demoResponseSchema),
    /** What the checks should say: `pass`, `warn`, `fail`, `skipped` or `skipped:<reason>`; `score` is the final score (or `null`). */
    expect: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
});

export type DemoSite = z.infer<typeof demoSiteSchema>;

/** The clock of every demo site: a certificate's `validTo` is counted from it. */
const DEMO_TIME = '2026-10-09T12:00:00.000Z';
const PROBE_ID = '00000000-0000-0000-0000-000000000000';
const MAX_HOPS = 10;
const CONTENT_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml',
    '.json': 'application/json',
    '.md': 'text/markdown; charset=utf-8',
};

export const readDemoSite = (dir: string): DemoSite => {
    const parsed = demoSiteSchema.safeParse(JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8')));
    if (!parsed.success) throw new Error(`${dir}/site.json: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
    return parsed.data;
};

/**
 * A demo site (`<dir>/site.json` and the files beside it) as a recording: every listed address is answered the way the real fetcher would,
 * with its redirect hops followed into `redirects` and `finalUrl`, the content type taken from the file's extension and the size from its length.
 */
export const loadDemoSite = (dir: string): Recording => {
    const site = readDemoSite(dir);
    const address = (url: string, base?: string): string => new URL(url.replace('/sitehp-check-*', `/sitehp-check-${PROBE_ID}`), base).href;
    const responses = new Map(Object.entries(site.responses).map(([url, response]) => [address(url), response]));

    const answer = (start: string): SiteFetchResult => {
        const redirects: FetchedPage['redirects'][number][] = [];
        let url = start;
        for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
            const response = responses.get(url);
            if (response === undefined) return { ok: false, reason: 'unreachable' };
            if (response.redirect !== undefined) {
                const to = address(response.redirect, url);
                redirects.push({ from: url.replace(/#.*$/, ''), to, status: response.status ?? 301 });
                url = to;
                continue;
            }
            const body = response.file === undefined ? '' : readFileSync(join(dir, response.file), 'utf8');
            const headers = Object.fromEntries(Object.entries(response.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
            const type = response.file === undefined ? undefined : CONTENT_TYPES[extname(response.file)];
            if (headers['content-type'] === undefined && type !== undefined) headers['content-type'] = type;
            // A demo site is served compressed, as nearly every real one is, unless its response says `"content-encoding": "identity"`.
            const compressible = response.file !== undefined && /^text\/|xml|json/.test(headers['content-type'] ?? '');
            if (compressible && headers['content-encoding'] === undefined) headers['content-encoding'] = 'gzip';
            const encoded = headers['content-encoding'] === 'gzip';
            const page: FetchedPage = {
                finalUrl: url.replace(/#.*$/, ''),
                status: response.status ?? 200,
                redirects,
                headers,
                cookies: response.cookies ?? [],
                contentType: headers['content-type'] ?? null,
                body,
                bytes: Buffer.byteLength(body),
                transferredBytes: encoded ? gzipSync(body).length : Buffer.byteLength(body),
                alpn: null,
                truncated: false,
                ttfbMs: 0,
                totalMs: 0,
            };
            return { ok: true, page };
        }
        return { ok: false, reason: 'too_many_redirects' };
    };

    const host = new URL(site.url).host;
    const days = site.certificate?.daysLeft ?? 90;
    const certificate: CertificateInfo | null =
        site.certificate === null
            ? null
            : {
                  authorized: site.certificate?.authorized ?? true,
                  error: site.certificate?.error ?? null,
                  validTo: site.certificate?.validTo ?? new Date(Date.parse(DEMO_TIME) + days * 86_400_000).toISOString(),
                  daysLeft: days,
                  issuer: site.certificate?.issuer ?? 'Demo Test CA',
              };
    return {
        version: 1,
        site: site.url,
        recordedAt: DEMO_TIME,
        pages: Object.fromEntries([...responses.keys()].map((url) => [url, answer(url)])),
        // The one certificate of the demo site stands for every host it answers on: a scan reads it on the host the page ends on.
        certificates: Object.fromEntries([host, ...[...responses.keys()].map((url) => new URL(url).host)].map((name) => [name, certificate])),
    };
};

/** Every demo site in a folder: each subfolder with a `site.json`. */
export const loadDemoSites = (dir: string): Recording[] =>
    readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'site.json')))
        .map((entry) => entry.name)
        .sort()
        .map((name) => loadDemoSite(join(dir, name)));
