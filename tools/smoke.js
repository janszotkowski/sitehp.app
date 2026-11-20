/**
 * Starts the built backend and frontend as production would run them, and checks that they
 * work together from a clean build: the part of "can this be started from zero" that unit
 * tests cannot show. Run by `pnpm smoke` (after `pnpm build`), by `pnpm verify` and by CI.
 *
 * It needs no internet and starts no scan of a real site (the scanner refuses internal
 * addresses on purpose, and a test must not depend on someone else's server).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const backendEntry = join(root, 'apps/backend/dist/main.api.mjs');
const frontendEntry = join(root, 'apps/frontend/.output/server/index.mjs');

// Not 4190 or 6000 and the like: `fetch` refuses the ports on the WHATWG "bad ports" list.
const BACKEND_PORT = process.env.SMOKE_BACKEND_PORT ?? '4150';
const FRONTEND_PORT = process.env.SMOKE_FRONTEND_PORT ?? '3150';
const backend = `http://127.0.0.1:${BACKEND_PORT}`;
const frontend = `http://127.0.0.1:${FRONTEND_PORT}`;

for (const entry of [backendEntry, frontendEntry]) {
    if (!existsSync(entry)) {
        process.stderr.write(`Smoke test needs a build first (${entry} is missing). Run \`pnpm build\`.\n`);
        process.exit(1);
    }
}

const children = [];
const start = (name, entry, env) => {
    const child = spawn(process.execPath, [entry], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    children.push({ name, child, output: () => output });
    return child;
};

const stopAll = () => {
    for (const { child } of children) child.kill('SIGTERM');
};

const waitFor = async (url, seconds = 30) => {
    const until = Date.now() + seconds * 1000;
    for (;;) {
        try {
            const response = await fetch(url, { redirect: 'manual' });
            if (response.status < 500) return;
        } catch {
            // Not listening yet.
        }
        if (Date.now() > until) throw new Error(`${url} did not come up within ${seconds}s`);
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
};

const failures = [];
const check = async (label, run) => {
    try {
        await run();
        process.stdout.write(`  ok    ${label}\n`);
    } catch (error) {
        failures.push(label);
        process.stdout.write(`  FAIL  ${label}: ${error.message}\n`);
    }
};
const expect = (condition, message) => {
    if (!condition) throw new Error(message);
};

try {
    start('backend', backendEntry, { PORT: BACKEND_PORT, HOST: '127.0.0.1', LOG_LEVEL: 'silent', CORS_ORIGINS: frontend });
    // The frontend server reaches the backend by its internal address; the browser address is baked in at build time.
    start('frontend', frontendEntry, { PORT: FRONTEND_PORT, HOST: '127.0.0.1', API_INTERNAL_URL: backend });
    await waitFor(`${backend}/v1/health`);
    await waitFor(`${frontend}/en`);
    process.stdout.write('Smoke test: backend and frontend are up\n');

    await check('backend: /v1/health answers ok', async () => {
        const response = await fetch(`${backend}/v1/health`);
        const body = await response.json();
        expect(response.status === 200 && body.status === 'ok', `got ${response.status} ${JSON.stringify(body)}`);
        expect(response.headers.get('x-request-id'), 'no X-Request-Id header');
    });

    await check('backend: an address that cannot be scanned is refused with VALIDATION_FAILED', async () => {
        for (const url of ['ftp://example.com', 'http://127.0.0.1/', 'http://localhost/', 'http://169.254.169.254/']) {
            const response = await fetch(`${backend}/v1/scans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
            const body = await response.json();
            expect(response.status === 400 && body.error?.code === 'VALIDATION_FAILED', `${url}: got ${response.status} ${JSON.stringify(body)}`);
        }
    });

    await check('backend: CORS allows the frontend origin without credentials', async () => {
        const response = await fetch(`${backend}/v1/health`, { headers: { origin: frontend } });
        expect(response.headers.get('access-control-allow-origin') === frontend, `allow-origin is ${response.headers.get('access-control-allow-origin')}`);
        expect(response.headers.get('access-control-allow-credentials') === null, 'credentials are allowed');
    });

    await check('backend: an unknown scan is NOT_FOUND', async () => {
        const response = await fetch(`${backend}/v1/scans/${'a'.repeat(22)}`);
        expect(response.status === 404, `got ${response.status}`);
    });

    await check('frontend: / redirects to the language root', async () => {
        const response = await fetch(`${frontend}/`, { redirect: 'manual', headers: { 'accept-language': 'en' } });
        expect(response.status === 302 && response.headers.get('location') === '/en', `got ${response.status} ${response.headers.get('location')}`);
    });

    await check('frontend: pages and static files cannot be framed and are not content-sniffed', async () => {
        for (const path of ['/en', '/robots.txt']) {
            const response = await fetch(`${frontend}${path}`);
            // The CSP is set per page (it carries the hashes of that page's scripts); a static file gets X-Frame-Options from the route rules.
            if (path === '/en') expect(response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"), `${path}: no frame-ancestors in the CSP`);
            expect(response.headers.get('x-frame-options') === 'DENY', `${path}: no X-Frame-Options: DENY`);
            expect(response.headers.get('x-content-type-options') === 'nosniff', `${path}: no X-Content-Type-Options: nosniff`);
        }
    });

    await check('frontend: the CSP limits scripts and connections to the site and the API', async () => {
        const csp = (await fetch(`${frontend}/en`)).headers.get('content-security-policy') ?? '';
        expect(csp.includes("default-src 'self'") && csp.includes("script-src 'self'") && csp.includes("object-src 'none'"), `CSP is ${csp}`);
        expect(/connect-src 'self' https?:\/\/\S+/.test(csp), `no API origin in connect-src: ${csp}`);
    });

    await check('frontend: a prerendered file name and a trailing slash redirect permanently to the canonical page', async () => {
        for (const path of ['/en/about/', '/en/about/index.html']) {
            const response = await fetch(`${frontend}${path}`, { redirect: 'manual' });
            expect(response.status === 301 && response.headers.get('location')?.endsWith('/en/about'), `${path}: got ${response.status} ${response.headers.get('location')}`);
        }
    });

    await check('frontend: the home page links its icons and its Markdown twin, and shows the demo score', async () => {
        const html = await (await fetch(`${frontend}/en`)).text();
        expect(/<link[^>]*rel="icon"[^>]*href="\/favicon\.svg"/.test(html), 'no SVG favicon link');
        expect(/<link[^>]*rel="apple-touch-icon"[^>]*href="\/apple-touch-icon\.png"/.test(html), 'no apple-touch-icon link');
        expect(/<link[^>]*type="text\/markdown"/.test(html), 'no Markdown alternate link');
        expect(html.includes('>84</span>'), 'the demo ring does not show its score in the server HTML');
        for (const path of ['/favicon.svg', '/apple-touch-icon.png']) {
            const response = await fetch(`${frontend}${path}`);
            expect(response.status === 200, `${path}: got ${response.status}`);
        }
    });

    await check('frontend: a public page has a Markdown twin, a report does not', async () => {
        const response = await fetch(`${frontend}/en/methodology.md`);
        const body = await response.text();
        expect(response.status === 200 && response.headers.get('content-type')?.startsWith('text/markdown'), `got ${response.status} ${response.headers.get('content-type')}`);
        expect(body.startsWith('# ') && body.includes('## '), 'the Markdown has no headings');
        expect((await fetch(`${frontend}/en/r/${'a'.repeat(22)}.md`)).status === 404, 'a report has a Markdown twin');
    });

    await check('frontend: the methodology headings can be linked to and the page says when it changed', async () => {
        const html = await (await fetch(`${frontend}/en/methodology`)).text();
        expect(/<h2[^>]*id="steps"/.test(html) && /<h3[^>]*id="step-1"/.test(html) && /<h4[^>]*id="method-security-/.test(html), 'headings without ids');
        expect(/"dateModified":"\d{4}-\d{2}-\d{2}"/.test(html) && /"version":\d+/.test(html), 'no dateModified or version in the JSON-LD');
    });

    await check('frontend: /en renders the landing page with the scan form', async () => {
        const response = await fetch(`${frontend}/en`);
        const html = await response.text();
        expect(response.status === 200, `got ${response.status}`);
        expect(/<title>[^<]*sitehp\.app/.test(html), 'no title');
        expect(html.includes('id="scan-url"'), 'no scan form');
        expect(html.includes('rel="canonical"'), 'no canonical link');
    });

    await check('frontend: the scan form does nothing when it is submitted before the page is live', async () => {
        const html = await (await fetch(`${frontend}/en`)).text();
        // A plain form would reload the page with the text in the address and start no scan; `dialog` outside a dialog does nothing.
        expect(/<form[^>]*method="dialog"/.test(html), 'the form does not have method="dialog"');
        expect(/<input[^>]*id="scan-url"[^>]*readonly/i.test(html) || /<input[^>]*readonly[^>]*id="scan-url"/i.test(html), 'the field is not read-only before hydration');
    });

    await check('frontend: a report page for an unknown id is a 404, private and not indexed', async () => {
        const response = await fetch(`${frontend}/en/r/${'a'.repeat(22)}`);
        expect(response.status === 404, `got ${response.status}`);
        expect(response.headers.get('x-robots-tag')?.includes('noindex'), 'no X-Robots-Tag: noindex');
        expect(response.headers.get('referrer-policy') === 'no-referrer', 'no Referrer-Policy: no-referrer');
    });

    await check('frontend: the status page reaches the backend through the server-side address', async () => {
        const html = await (await fetch(`${frontend}/en/status`)).text();
        expect(html.includes('Reachable'), 'the page does not show the backend as reachable');
    });

    await check('frontend: robots.txt, llms.txt and sitemap.xml are served, and the sitemap lists no report', async () => {
        for (const path of ['/robots.txt', '/llms.txt', '/sitemap.xml']) {
            const response = await fetch(`${frontend}${path}`);
            expect(response.status === 200, `${path}: got ${response.status}`);
            if (path === '/sitemap.xml') expect(!(await response.text()).includes('/r/'), 'the sitemap lists a report');
        }
    });
} catch (error) {
    failures.push(error.message);
    process.stderr.write(`Smoke test could not run: ${error.message}\n`);
    for (const { name, output } of children) process.stderr.write(`--- ${name} output ---\n${output()}\n`);
} finally {
    stopAll();
}

if (failures.length > 0) {
    process.stderr.write(`Smoke test failed: ${failures.length} problem(s)\n`);
    process.exit(1);
}
process.stdout.write('Smoke test passed\n');
process.exit(0);
