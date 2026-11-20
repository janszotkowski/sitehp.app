import { brotliCompressSync, constants as zlibConstants, gzipSync, zstdCompressSync } from 'node:zlib';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PeerCertificate } from 'node:tls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPublicIp } from '@platform/net/ip.ts';
import { certificateInfoOf, createSafeFetcher, textEncodingOf, type SafeFetchOptions } from '@platform/net/safe-fetch.ts';

/**
 * The fetcher against a real local HTTP server. Names ending in `.test` are mapped by a fake
 * resolver: `ok.test` to the loopback address where the test server listens (the policy lets
 * that one host use it), `private.test` and `metadata.test` to internal addresses that must be
 * refused. Everything else follows the real rule: public internet only.
 */

let server: Server;
let port: number;
const seen: IncomingMessage[] = [];

/** "Přihláška" in windows-1250: ř is 0xF8, á is 0xE1, š is 0x9A. */
const PRIHLASKA_1250 = Buffer.from([0x50, 0xf8, 0x69, 0x68, 0x6c, 0xe1, 0x9a, 0x6b, 0x61]);

const routes: Record<string, (request: IncomingMessage, response: ServerResponse) => void> = {
    '/ok': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-custom': 'yes' });
        response.end('<html><title>Hello</title></html>');
    },
    '/cookies': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': ['a=1; Secure; Expires=Wed, 21 Oct 2026 07:28:00 GMT', 'b=2; HttpOnly'] });
        response.end('x');
    },
    '/missing': (_request, response) => {
        response.writeHead(404, { 'content-type': 'text/html' });
        response.end('not here');
    },
    '/boom': (_request, response) => {
        response.writeHead(500);
        response.end('error');
    },
    '/to-blocked': (_request, response) => {
        response.writeHead(302, { location: `http://blocked.test:${port}/ok` });
        response.end();
    },
    '/a': (_request, response) => {
        response.writeHead(301, { location: '/b' });
        response.end();
    },
    '/b': (_request, response) => {
        response.writeHead(302, { location: `http://ok.test:${port}/c` });
        response.end();
    },
    '/c': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('arrived');
    },
    '/loop': (_request, response) => {
        response.writeHead(302, { location: '/loop' });
        response.end();
    },
    '/to-private-host': (_request, response) => {
        response.writeHead(302, { location: 'http://private.test/secret' });
        response.end();
    },
    '/to-metadata-literal': (_request, response) => {
        response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        response.end();
    },
    '/to-loopback-literal': (_request, response) => {
        response.writeHead(302, { location: 'http://127.0.0.1:8080/' });
        response.end();
    },
    '/to-file': (_request, response) => {
        response.writeHead(302, { location: 'file:///etc/passwd' });
        response.end();
    },
    '/to-ftp': (_request, response) => {
        response.writeHead(302, { location: 'ftp://example.com/' });
        response.end();
    },
    '/to-credentials': (_request, response) => {
        response.writeHead(302, { location: 'http://user:secret@ok.test/' });
        response.end();
    },
    '/redirect-without-location': (_request, response) => {
        response.writeHead(302);
        response.end();
    },
    '/slow': () => {
        // Never answers.
    },
    '/big': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('x'.repeat(5_000_000));
    },
    '/image': (_request, response) => {
        response.writeHead(200, { 'content-type': 'image/png' });
        response.end(Buffer.alloc(2000, 1));
    },
    '/gzip': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        response.end(Buffer.from([0x1f, 0x8b, 0x08, 0x00]));
    },
    // Some servers compress whatever the request says (the request asks for no compression).
    '/gzip-ok': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' });
        response.end(gzipSync('<html><title>Příliš žluťoučký kůň</title></html>'));
    },
    '/br': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'br' });
        response.end(brotliCompressSync('<html><title>Brotli</title></html>'));
    },
    '/zstd': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'zstd' });
        response.end(zstdCompressSync('<html><title>Zstd</title></html>'));
    },
    '/bomb': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        // About 50 MB of text in a few dozen kilobytes.
        response.end(gzipSync('x'.repeat(50_000_000)));
    },
    // Endless gzip members that hold nothing: the decompressor never produces a byte, only the count of compressed bytes can stop it.
    '/empty-members': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        const members = Buffer.concat(Array.from({ length: 500 }, () => gzipSync(Buffer.alloc(0))));
        const more = (): void => {
            if (!response.destroyed) response.write(members, () => setImmediate(more));
        };
        more();
    },
    // A Czech page in windows-1250, as many older sites still are: declared in the header, in a meta tag, or nowhere.
    '/cp1250-header': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=windows-1250' });
        response.end(PRIHLASKA_1250);
    },
    '/cp1250-meta': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end(Buffer.concat([Buffer.from('<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1250"></head><body>'), PRIHLASKA_1250]));
    },
    '/unknown-charset': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=klingon' });
        response.end('Přihláška');
    },
    '/to-other-site': (_request, response) => {
        response.writeHead(301, { location: `http://elsewhere.test:${port}/ok` });
        response.end();
    },
    '/stacked': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip, br' });
        response.end(brotliCompressSync(gzipSync('<html></html>')));
    },
    // A 16 MB frame that asks for a 128 MB window: refused as corrupt instead of allocated.
    '/zstd-huge-window': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'zstd' });
        response.end(zstdCompressSync(Buffer.alloc(16_000_000, 'x'), { params: { [zlibConstants.ZSTD_c_windowLog]: 27 } }));
    },
    // The connection drops in the middle of a plain body.
    '/reset-mid-body': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html', 'content-length': '1000' });
        response.write('x'.repeat(100), () => setTimeout(() => response.socket?.destroy(), 20));
    },
    '/truncated-gzip': (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        response.end(gzipSync('<html>'.repeat(1000)).subarray(0, 40));
    },
};

beforeAll(async () => {
    server = createServer((request, response) => {
        seen.push(request);
        const handler = routes[request.url ?? ''];
        if (handler === undefined) {
            response.writeHead(404);
            response.end();
            return;
        }
        handler(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
});

const resolver = (hostname: string) => {
    const table: Record<string, string> = { 'ok.test': '127.0.0.1', 'private.test': '10.0.0.5', 'metadata.test': '169.254.169.254', 'mixed.test': '127.0.0.1,10.0.0.5' };
    const entry = table[hostname];
    if (hostname === 'gone.test') return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }));
    if (entry === undefined) return Promise.resolve([{ address: '93.184.216.34', family: 4 as const }]);
    return Promise.resolve(entry.split(',').map((address) => ({ address, family: 4 as const })));
};

const fetcher = (overrides: Partial<SafeFetchOptions> = {}) =>
    createSafeFetcher({
        timeoutMs: 3000,
        maxBytes: 1_000_000,
        maxRedirects: 5,
        userAgent: 'sitehp-test/1.0',
        resolve: resolver,
        // Only `ok.test` may use the loopback address of the test server; every other host follows the real rule.
        isAllowed: (address, hostname) => (hostname === 'ok.test' ? true : isPublicIp(address)),
        allowCustomPorts: true,
        ...overrides,
    });

const url = (path: string) => `http://ok.test:${port}${path}`;

describe('safe fetch: a normal page', () => {
    it('returns every Set-Cookie line as its own entry', async () => {
        const result = await fetcher().fetchPage(url('/cookies'));
        if (!result.ok) throw new Error('fetch failed');
        expect(result.page.cookies).toEqual(['a=1; Secure; Expires=Wed, 21 Oct 2026 07:28:00 GMT', 'b=2; HttpOnly']);
    });

    it('returns the status, the headers, the body and the timings', async () => {
        const result = await fetcher().fetchPage(url('/ok'));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.page).toMatchObject({ status: 200, finalUrl: url('/ok'), contentType: 'text/html; charset=utf-8', redirects: [], truncated: false });
        expect(result.page.body).toContain('<title>Hello</title>');
        expect(result.page.headers['x-custom']).toBe('yes');
        expect(result.page.bytes).toBe(Buffer.byteLength('<html><title>Hello</title></html>'));
        expect(result.page.ttfbMs).toBeGreaterThanOrEqual(0);
        expect(result.page.totalMs).toBeGreaterThanOrEqual(result.page.ttfbMs);
    });

    it('returns an error status as a page, not as a failure: a 404 is a finding', async () => {
        for (const [path, status] of [
            ['/missing', 404],
            ['/boom', 500],
        ] as const) {
            const result = await fetcher().fetchPage(url(path));
            expect(result.ok && result.page.status).toBe(status);
        }
    });

    it('identifies itself with the fixed User-Agent and sends no cookies or credentials', async () => {
        seen.length = 0;
        await fetcher().fetchPage(url('/ok'));
        const request = seen.at(-1);
        expect(request?.headers['user-agent']).toBe('sitehp-test/1.0');
        expect(request?.headers['cookie']).toBeUndefined();
        expect(request?.headers['authorization']).toBeUndefined();
        expect(request?.headers['accept-encoding']).toBe('gzip, deflate, br, zstd');
    });
});

describe('safe fetch: asking for another format', () => {
    it('sends the Accept header it is given, and HTML by default', async () => {
        seen.length = 0;
        await fetcher().fetchPage(url('/ok'));
        expect(seen.at(-1)?.headers['accept']).toContain('text/html');
        await fetcher().fetchPage(url('/ok'), undefined, 'text/markdown');
        expect(seen.at(-1)?.headers['accept']).toBe('text/markdown');
    });
});

describe('safe fetch: logging', () => {
    const logged = () => {
        const lines: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
        const at = (level: string) => (fields: Record<string, unknown>, msg: string) => void lines.push({ level, fields, msg });
        return { lines, logger: { debug: at('debug'), warn: at('warn') } as never };
    };

    it('logs each fetch with where it went and what came back, and never the query', async () => {
        const { lines, logger } = logged();
        await fetcher({ logger }).fetchPage(url('/ok'));
        await fetcher({ logger }).fetchPage(url('/ok?token=SECRET123'));
        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatchObject({ level: 'debug', msg: 'fetch', fields: { host: 'ok.test', pathLength: 3, status: 200, redirects: 0, accept: 'html', durationMs: expect.any(Number) } });
        // The test server answers the address with a query by exact match, so this one is a 404: the log still shows the path only.
        expect(lines[1]?.fields).toMatchObject({ pathLength: 3 });
        expect(JSON.stringify(lines)).not.toContain('SECRET123');
    });

    it('logs a failed fetch with its reason, and a refusal as a warning with the rule that refused', async () => {
        const { lines, logger } = logged();
        await fetcher({ logger, isHostBlocked: (host) => host === 'blocked.test' }).fetchPage(`http://blocked.test:${port}/ok`);
        expect(lines.map((line) => [line.level, line.msg])).toEqual([
            ['warn', 'fetch refused'],
            ['debug', 'fetch failed'],
        ]);
        expect(lines[0]?.fields).toMatchObject({ host: 'blocked.test', rule: 'block_list' });
        expect(lines[1]?.fields).toMatchObject({ reason: 'blocked_address' });
    });

    it('warns when a name resolves to an internal address', async () => {
        const { lines, logger } = logged();
        await fetcher({ logger, resolve: () => Promise.resolve([{ address: '10.0.0.5', family: 4 }]) }).fetchPage('http://private.test/');
        expect(lines.find((line) => line.level === 'warn')?.fields).toMatchObject({ host: 'private.test', rule: 'resolves_to_internal_address' });
    });
});

describe('safe fetch: the block list', () => {
    const blocking = (overrides: Partial<SafeFetchOptions> = {}) => fetcher({ isHostBlocked: (host) => host === 'blocked.test', ...overrides });

    it('refuses a blocked host as the first address', async () => {
        expect(await blocking().fetchPage(`http://blocked.test:${port}/ok`)).toEqual({ ok: false, reason: 'blocked_address' });
    });

    it('refuses a redirect to a blocked host, so a site cannot send the scanner there', async () => {
        expect(await blocking().fetchPage(url('/to-blocked'))).toEqual({ ok: false, reason: 'blocked_address' });
        // Without the rule the same redirect would be followed.
        expect((await fetcher().fetchPage(url('/ok'))).ok).toBe(true);
    });
});

describe('safe fetch: redirects', () => {
    it('follows a chain hop by hop and records every hop', async () => {
        const result = await fetcher().fetchPage(url('/a'));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.page.finalUrl).toBe(url('/c'));
        expect(result.page.body).toBe('arrived');
        expect(result.page.redirects).toEqual([
            { from: url('/a'), to: url('/b'), status: 301 },
            { from: url('/b'), to: url('/c'), status: 302 },
        ]);
    });

    it('gives up on a redirect loop', async () => {
        expect(await fetcher().fetchPage(url('/loop'))).toEqual({ ok: false, reason: 'too_many_redirects' });
    });

    it('honours the redirect limit', async () => {
        expect(await fetcher({ maxRedirects: 1 }).fetchPage(url('/a'))).toEqual({ ok: false, reason: 'too_many_redirects' });
    });

    it('returns a redirect status without a Location as a page', async () => {
        const result = await fetcher().fetchPage(url('/redirect-without-location'));
        expect(result.ok && result.page.status).toBe(302);
    });
});

describe('safe fetch: SSRF protection', () => {
    it.each([
        ['a redirect to a host that resolves to a private address', '/to-private-host'],
        ['a redirect to the cloud metadata address', '/to-metadata-literal'],
        ['a redirect to a loopback IP literal', '/to-loopback-literal'],
        ['a redirect to a file: URL', '/to-file'],
        ['a redirect to an ftp: URL', '/to-ftp'],
        ['a redirect to a URL with credentials', '/to-credentials'],
    ])('refuses %s', async (_label, path) => {
        expect(await fetcher().fetchPage(url(path))).toEqual({ ok: false, reason: 'blocked_address' });
    });

    it.each(['http://private.test/', 'http://metadata.test/latest/meta-data/', 'http://mixed.test/'])('refuses to connect to %s, which resolves to an internal address', async (address) => {
        expect(await fetcher({ allowCustomPorts: false }).fetchPage(address)).toEqual({ ok: false, reason: 'blocked_address' });
    });

    it.each([
        'http://127.0.0.1/',
        'http://[::1]/',
        'http://10.0.0.1/',
        'http://localhost/',
        'http://2130706433/',
        'ftp://example.com/',
        'file:///etc/passwd',
        'javascript:alert(1)',
        'http://user:pw@example.com/',
    ])('refuses %s before any lookup happens', async (address) => {
        let lookups = 0;
        const result = await fetcher({
            allowCustomPorts: false,
            resolve: (hostname) => {
                lookups += 1;
                return resolver(hostname);
            },
        }).fetchPage(address);
        expect(result).toEqual({ ok: false, reason: 'blocked_address' });
        expect(lookups).toBe(0);
    });

    it('refuses a custom port in production mode', async () => {
        expect(await fetcher({ allowCustomPorts: false }).fetchPage(`http://ok.test:${port}/ok`)).toEqual({ ok: false, reason: 'blocked_address' });
    });

    it('treats a name that does not exist as unreachable, not as blocked', async () => {
        expect(await fetcher({ allowCustomPorts: false }).fetchPage('http://gone.test/')).toEqual({ ok: false, reason: 'unreachable' });
    });

    it('uses the real rule for every host the policy does not name: a loopback answer for other.test is refused', async () => {
        const result = await fetcher({ resolve: () => Promise.resolve([{ address: '127.0.0.1', family: 4 as const }]) }).fetchPage('http://other.test:81/');
        expect(result).toEqual({ ok: false, reason: 'blocked_address' });
    });
});

describe('safe fetch: limits', () => {
    it('times out a server that never answers', async () => {
        const startedAt = Date.now();
        const result = await fetcher({ timeoutMs: 300 }).fetchPage(url('/slow'));
        expect(result).toEqual({ ok: false, reason: 'timeout' });
        expect(Date.now() - startedAt).toBeLessThan(2000);
    });

    it('stops reading at the byte cap and says the body was cut', async () => {
        const result = await fetcher({ maxBytes: 1000 }).fetchPage(url('/big'));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.page.truncated).toBe(true);
        expect(result.page.bytes).toBe(1000);
        expect(result.page.body).toHaveLength(1000);
    });

    it('does not keep a body that is not text', async () => {
        const result = await fetcher().fetchPage(url('/image'));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.page).toMatchObject({ contentType: 'image/png', body: '', bytes: 2000 });
    });

    it('keeps the page, without a body, when the compressed data is corrupt or cut short', async () => {
        for (const path of ['/gzip', '/truncated-gzip']) {
            const result = await fetcher().fetchPage(url(path));
            expect(result.ok, path).toBe(true);
            if (result.ok) expect(result.page.body, path).toBe('');
        }
    });

    it('refuses a zstd frame that asks for a window above 8 MB, like corrupt data', async () => {
        const result = await fetcher().fetchPage(url('/zstd-huge-window'));
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.page).toMatchObject({ body: '', bytes: 0, truncated: false });
    });

    it('reads a compressed body: gzip, brotli and zstd', async () => {
        const gzip = await fetcher().fetchPage(url('/gzip-ok'));
        const brotli = await fetcher().fetchPage(url('/br'));
        const zstd = await fetcher().fetchPage(url('/zstd'));
        expect(gzip.ok && gzip.page.body).toBe('<html><title>Příliš žluťoučký kůň</title></html>');
        expect(gzip.ok && gzip.page.headers['content-encoding']).toBe('gzip');
        expect(brotli.ok && brotli.page.body).toBe('<html><title>Brotli</title></html>');
        expect(zstd.ok && zstd.page.body).toBe('<html><title>Zstd</title></html>');
    });

    it('records the bytes on the wire next to the decompressed size', async () => {
        const text = '<html><title>Příliš žluťoučký kůň</title></html>';
        const gzip = await fetcher().fetchPage(url('/gzip-ok'));
        expect(gzip.ok && gzip.page.transferredBytes).toBe(gzipSync(text).length);
        expect(gzip.ok && gzip.page.bytes).toBe(Buffer.byteLength(text));
        const plain = await fetcher().fetchPage(url('/'));
        expect(plain.ok && plain.page.transferredBytes).toBe(plain.ok && plain.page.bytes);
        expect(plain.ok && plain.page.alpn).toBeNull(); // the test server speaks plain http
    });

    it('applies the byte cap to what the decompressor produces, so a zip bomb is cut like a big page', async () => {
        const startedAt = Date.now();
        const result = await fetcher({ maxBytes: 5000 }).fetchPage(url('/bomb'));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.page).toMatchObject({ truncated: true, bytes: 5000 });
        expect(result.page.body).toHaveLength(5000);
        expect(Date.now() - startedAt).toBeLessThan(2000);
    });

    it('stops reading a compressed body once four times the byte cap has come off the wire, even when it inflates to nothing', async () => {
        const startedAt = Date.now();
        const result = await fetcher({ maxBytes: 5000 }).fetchPage(url('/empty-members'));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.page).toMatchObject({ truncated: true, bytes: 0 });
        expect(Date.now() - startedAt).toBeLessThan(2000);
    });

    it('does not read a body with several encodings stacked', async () => {
        const result = await fetcher().fetchPage(url('/stacked'));
        expect(result.ok && result.page.body).toBe('');
    });

    it('stops at once when the caller aborts', async () => {
        const controller = new AbortController();
        const pending = fetcher({ timeoutMs: 5000 }).fetchPage(url('/slow'), controller.signal);
        setTimeout(() => controller.abort(), 50);
        const result = await pending;
        expect(result.ok).toBe(false);
    });
});

describe('safe fetch: text encodings', () => {
    it('decodes a body in the charset of its Content-Type, else of its meta tag, else as UTF-8', async () => {
        for (const path of ['/cp1250-header', '/cp1250-meta']) {
            const result = await fetcher().fetchPage(url(path));
            expect(result.ok && result.page.body, path).toContain('Přihláška');
        }
        const unknown = await fetcher().fetchPage(url('/unknown-charset'));
        expect(unknown.ok && unknown.page.body).toBe('Přihláška');
    });

    it('reads the charset from the forms a page declares it in', () => {
        expect(textEncodingOf('text/html; charset="ISO-8859-2"', new Uint8Array())).toBe('iso-8859-2');
        expect(textEncodingOf(null, Buffer.from('<meta charset=windows-1250>'))).toBe('windows-1250');
        expect(textEncodingOf('text/html', Buffer.from(`${' '.repeat(1100)}<meta charset="windows-1250">`))).toBe('utf-8');
        expect(textEncodingOf(null, new Uint8Array())).toBe('utf-8');
    });
});

describe('safe fetch: redirects off the site', () => {
    it('are followed for the page, and answered as unreachable for a probe that must stay on the site', async () => {
        // Here `elsewhere.test` is another site on the test server.
        const anywhere = fetcher({ resolve: () => Promise.resolve([{ address: '127.0.0.1', family: 4 as const }]), isAllowed: () => true });
        const free = await anywhere.fetchPage(url('/to-other-site'));
        expect(free.ok && free.page.finalUrl).toBe(`http://elsewhere.test:${port}/ok`);
        seen.length = 0;
        expect(await anywhere.fetchPage(url('/to-other-site'), undefined, undefined, true)).toEqual({ ok: false, reason: 'unreachable' });
        expect(seen.map((request) => request.url)).toEqual(['/to-other-site']);
        // `ok.test` to `ok.test` is the same site.
        expect((await fetcher().fetchPage(url('/a'), undefined, undefined, true)).ok).toBe(true);
    });
});

describe('safe fetch: connection failures', () => {
    it('reports a refused connection as unreachable', async () => {
        const result = await fetcher({ resolve: () => Promise.resolve([{ address: '127.0.0.1', family: 4 as const }]), isAllowed: () => true }).fetchPage('http://ok.test:1/');
        expect(result).toEqual({ ok: false, reason: 'unreachable' });
    });
});

describe('safe fetch: connection failures mid-body', () => {
    it('fails a plain body whose connection drops, instead of keeping the page with an empty body', async () => {
        const result = await fetcher().fetchPage(url('/reset-mid-body'));
        expect(result.ok).toBe(false);
    });
});

describe('certificateInfoOf', () => {
    it('treats a certificate with an unreadable expiry as no certificate info, instead of throwing', () => {
        expect(certificateInfoOf({ valid_to: 'not a date' }, true, undefined, 0)).toBeNull();
        expect(certificateInfoOf({}, true, undefined, 0)).toBeNull();
    });

    it('reads the expiry, the days left and the issuer', () => {
        const info = certificateInfoOf(
            { valid_to: 'Jan 11 00:00:00 2027 GMT', issuer: { O: 'Test CA' } as PeerCertificate['issuer'] },
            false,
            new Error('self-signed'),
            Date.parse('2027-01-01T00:00:00Z'),
        );
        expect(info).toEqual({ authorized: false, error: 'Error: self-signed', validTo: '2027-01-11T00:00:00.000Z', daysLeft: 10, issuer: 'Test CA' });
    });
});

describe('safe fetch: certificate inspection', () => {
    it('resolves through the guarded lookup and refuses an internal address', async () => {
        const asked: string[] = [];
        const inspect = fetcher({ isAllowed: (address) => (asked.push(address), isPublicIp(address)) }).inspectCertificate('private.test');
        expect(await inspect).toBeNull();
        expect(asked).toEqual(['10.0.0.5']);
    });

    it('refuses an IP literal without any lookup', async () => {
        let lookups = 0;
        const result = await fetcher({ resolve: (hostname) => ((lookups += 1), resolver(hostname)) }).inspectCertificate('127.0.0.1');
        expect(result).toBeNull();
        expect(lookups).toBe(0);
    });

    it('gives up at the deadline even when nothing ever answers', async () => {
        const started = performance.now();
        const result = await fetcher({ timeoutMs: 100, resolve: () => new Promise(() => undefined) }).inspectCertificate('slow.test');
        expect(result).toBeNull();
        expect(performance.now() - started).toBeLessThan(1000);
    });
});
