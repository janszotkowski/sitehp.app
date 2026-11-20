import { gzipSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '@config/env.ts';
import { createReplayFetcher, loadDemoSite, loadDemoSites, type Recording } from '@modules/scans/infrastructure/replay-fetcher.ts';
import { describe, expect, it } from 'vitest';
import { cannedPage, goodCertificate } from '@tests/helpers.ts';

const PROBE = 'https://example.com/sitehp-check-11111111-1111-4111-8111-111111111111';

const recording: Recording = {
    version: 1,
    site: 'example.com',
    recordedAt: '2026-10-09T12:00:00.000Z',
    pages: { 'https://example.com/': { ok: true, page: cannedPage() }, [PROBE]: { ok: true, page: cannedPage({ finalUrl: PROBE, status: 404 }) } },
    certificates: { 'example.com': goodCertificate },
};

describe('replay fetcher', () => {
    it('answers what was recorded, and an unknown address or host as an unreachable site would', async () => {
        const replay = createReplayFetcher([recording]);
        expect(await replay.fetchPage('https://example.com/')).toEqual({ ok: true, page: cannedPage() });
        expect(await replay.fetchPage('https://example.com/other')).toEqual({ ok: false, reason: 'unreachable' });
        expect(await replay.inspectCertificate('example.com')).toEqual(goodCertificate);
        expect(await replay.inspectCertificate('other.example')).toBeNull();
    });

    it('answers the not-found probe for any random path, with the path that was asked', async () => {
        const replay = createReplayFetcher([recording]);
        const asked = 'https://example.com/sitehp-check-22222222-2222-4222-8222-222222222222';
        expect(await replay.fetchPage(asked)).toMatchObject({ ok: true, page: { finalUrl: asked, status: 404 } });
    });
});

describe('replay fetcher: a probe that must stay on the site', () => {
    it('gets no answer when the recorded chain leaves the site, and the answer when it stays on it', async () => {
        const away = 'https://example.com/robots.txt';
        const stays = 'https://example.com/llms.txt';
        const replay = createReplayFetcher([
            {
                ...recording,
                pages: {
                    [away]: { ok: true, page: cannedPage({ finalUrl: 'https://other.example/robots.txt', redirects: [{ from: away, to: 'https://other.example/robots.txt', status: 301 }] }) },
                    [stays]: { ok: true, page: cannedPage({ finalUrl: 'https://www.example.com/llms.txt', redirects: [{ from: stays, to: 'https://www.example.com/llms.txt', status: 301 }] }) },
                },
            },
        ]);
        expect(await replay.fetchPage(away, { stayOnSite: true })).toEqual({ ok: false, reason: 'unreachable' });
        expect((await replay.fetchPage(away)).ok).toBe(true);
        expect((await replay.fetchPage(stays, { stayOnSite: true })).ok).toBe(true);
    });
});

describe('demo sites', () => {
    const demoSite = (): string => {
        const dir = mkdtempSync(join(tmpdir(), 'sitehp-demo-'));
        const site = join(dir, 'acme');
        mkdirSync(site);
        mkdirSync(join(dir, 'empty'));
        writeFileSync(join(site, 'index.html'), '<!doctype html><title>Acme</title>');
        writeFileSync(join(site, 'index.md'), '# Acme');
        writeFileSync(
            join(site, 'site.json'),
            JSON.stringify({
                url: 'https://acme.example/',
                note: 'test',
                certificate: { daysLeft: 10 },
                responses: {
                    'http://acme.example': { redirect: 'https://www.acme.example/' },
                    'https://www.acme.example/': { status: 302, redirect: 'https://acme.example/' },
                    'https://acme.example/': { file: 'index.html', headers: { 'X-Test': '1' }, cookies: ['a=1; Secure'] },
                    'https://acme.example/sitehp-check-*': { status: 302, redirect: 'https://acme.example/' },
                    'https://acme.example/#accept=markdown': { file: 'index.md', headers: { Vary: 'Accept' } },
                    'https://acme.example/loop': { redirect: '/loop' },
                },
            }),
        );
        return dir;
    };

    it('follows redirect hops into redirects and finalUrl, with the content type and size taken from the file', async () => {
        const replay = createReplayFetcher([loadDemoSite(join(demoSite(), 'acme'))]);
        expect(await replay.fetchPage('http://acme.example/')).toEqual({
            ok: true,
            page: {
                finalUrl: 'https://acme.example/',
                status: 200,
                redirects: [
                    { from: 'http://acme.example/', to: 'https://www.acme.example/', status: 301 },
                    { from: 'https://www.acme.example/', to: 'https://acme.example/', status: 302 },
                ],
                headers: { 'x-test': '1', 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' },
                cookies: ['a=1; Secure'],
                contentType: 'text/html; charset=utf-8',
                body: '<!doctype html><title>Acme</title>',
                bytes: 34,
                transferredBytes: gzipSync('<!doctype html><title>Acme</title>').length,
                alpn: null,
                truncated: false,
                ttfbMs: 0,
                totalMs: 0,
            },
        });
        expect(await replay.fetchPage('https://acme.example/loop')).toEqual({ ok: false, reason: 'too_many_redirects' });
        expect(await replay.inspectCertificate('acme.example')).toMatchObject({ authorized: true, daysLeft: 10, validTo: '2026-10-19T12:00:00.000Z' });
    });

    it('answers a request for Markdown from the #accept=markdown entry, and everything else from the plain one', async () => {
        const replay = createReplayFetcher([loadDemoSite(join(demoSite(), 'acme'))]);
        expect(await replay.fetchPage('https://acme.example/', { accept: 'text/markdown' })).toMatchObject({
            ok: true,
            page: { finalUrl: 'https://acme.example/', contentType: 'text/markdown; charset=utf-8', body: '# Acme', headers: { vary: 'Accept' } },
        });
        expect(await replay.fetchPage('https://acme.example/')).toMatchObject({ ok: true, page: { contentType: 'text/html; charset=utf-8' } });
        // A page with no Markdown entry answers a Markdown request as the site would that ignores `Accept`.
        expect(await replay.fetchPage('https://www.acme.example/', { accept: 'text/markdown' })).toMatchObject({ ok: true, page: { finalUrl: 'https://acme.example/' } });
    });

    it('answers the not-found probe written as /sitehp-check-*', async () => {
        const replay = createReplayFetcher([loadDemoSite(join(demoSite(), 'acme'))]);
        const asked = 'https://acme.example/sitehp-check-22222222-2222-4222-8222-222222222222';
        expect(await replay.fetchPage(asked)).toMatchObject({ ok: true, page: { finalUrl: 'https://acme.example/', redirects: [{ from: asked, status: 302 }] } });
    });

    it('loads every subfolder with a site.json and rejects a site.json with an unknown field', () => {
        const dir = demoSite();
        expect(loadDemoSites(dir).map((recording) => recording.site)).toEqual(['https://acme.example/']);
        writeFileSync(join(dir, 'acme', 'site.json'), JSON.stringify({ url: 'https://acme.example/', note: 'x', responses: {}, redirects: {} }));
        expect(() => loadDemoSites(dir)).toThrow(/site\.json/);
    });
});

describe('SITE_FETCHER_REPLAY_DIR', () => {
    it('is accepted in tests and refused in production', () => {
        expect(loadConfig({ NODE_ENV: 'test', SITE_FETCHER_REPLAY_DIR: '/fixtures' })).toMatchObject({ ok: true, config: { SITE_FETCHER_REPLAY_DIR: '/fixtures' } });
        expect(
            loadConfig({
                NODE_ENV: 'production',
                DATABASE_URL: 'postgres://localhost/sitehp',
                REDIS_URL: 'redis://localhost',
                CORS_ORIGINS: 'https://sitehp.app',
                SITE_FETCHER_REPLAY_DIR: '/fixtures',
            }),
        ).toMatchObject({
            ok: false,
            problems: [expect.stringContaining('SITE_FETCHER_REPLAY_DIR')],
        });
    });
});
