import { createHash } from 'node:crypto';
import { THEME_BOOT_SCRIPT } from './theme.ts';

/**
 * Headers for every response of the site, pages and static files alike. Free of app imports
 * so the server entry and the Nitro route rules (`vite/routeRules.ts`) build the same set.
 *
 * - The page may not be framed by another site (`X-Frame-Options` here, `frame-ancestors` in the policy):
 *   the scan form cannot be overlaid by a stranger's page (clickjacking).
 * - Content types are taken as sent, never guessed from the content.
 * - HTTPS only, for two years and on every subdomain, once a browser has seen the site over HTTPS (ignored over
 *   plain http). `preload` only makes the domain eligible: it still has to be submitted to the preload list.
 * - Following a link to another site sends only our origin as the referrer, never the page address.
 *
 * The Content-Security-Policy is not here: it allows the inline scripts of each page by their hashes, so it is built
 * per response from the HTML (`documentPolicy`), in `src/server.ts`.
 */
export const securityHeaders = (): Readonly<Record<string, string>> => ({
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
});

const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/** Script blocks that hold data, not code: the browser never runs them, so the policy need not allow them. */
const DATA_BLOCK = /\btype\s*=\s*["']?application\/(?:ld\+json|json|speculationrules\+json)/i;

/** The text of a script as the browser hashes it: the HTML parser turns CRLF and CR into LF and NUL into U+FFFD. */
const parsedScriptText = (content: string): string => content.replace(/\r\n?/g, '\n').replace(/\0/g, '�');

/**
 * The inline scripts the page is known to carry, by their shape: our theme boot script, and what TanStack Router writes, which
 * are the scroll restoration (`tsr-scroll-restoration-…`), the hydration and stream data (`$R`, `$_TSR`) and the stream
 * boundary, each of which removes itself. Anything else is not hashed, so a script that got into the HTML some other way
 * (an injection the escaping missed) is blocked by the policy instead of being allowed with the rest.
 */
const KNOWN_SCRIPTS: readonly RegExp[] = [
    /^\(function\([\s\S]*\)\("tsr-scroll-restoration-v[\w.-]+"\);document\.currentScript\.remove\(\)$/,
    /^(?:\(self\.\$R=self\.\$R\|\|\{\}\)|self\.\$_TSR|\$_TSR\.|\$R\[)[\s\S]*(?:document\.currentScript\.remove\(\)|s\.remove\(\)\})(?:;?\/\*\$tsr-stream-boundary\*\/)?$/,
    /^document\.currentScript\.remove\(\);\/\*\$tsr-stream-boundary\*\/$/,
];

const isKnownScript = (content: string): boolean => content === THEME_BOOT_SCRIPT || KNOWN_SCRIPTS.some((shape) => shape.test(content));

/**
 * CSP source expressions (`'sha256-…'`) for the inline scripts of a page that are known (`KNOWN_SCRIPTS`): the theme boot
 * script and what the framework writes. External scripts (`src=`), data blocks and unknown scripts are skipped.
 */
export const inlineScriptHashes = (html: string): string[] => {
    const hashes = new Set<string>();
    for (const [, attributes = '', content = ''] of html.matchAll(INLINE_SCRIPT)) {
        if (content === '' || /\bsrc\s*=/i.test(attributes) || DATA_BLOCK.test(attributes) || !isKnownScript(content)) continue;
        hashes.add(`'sha256-${createHash('sha256').update(parsedScriptText(content)).digest('base64')}'`);
    }
    return [...hashes];
};

/**
 * The Content-Security-Policy of one response. Scripts run only from this site or when their exact text is in the page
 * (by hash, never 'unsafe-inline'; prerendered pages cannot carry a per-request nonce). Styles come from this site; only
 * `style` attributes may be inline (React sets them, the page has no `<style>` blocks). Everything else loads from this
 * site only, except the API calls (`connect-src`). No plugins, no `<base>`, forms only to this site, no framing.
 */
export const contentSecurityPolicy = (apiUrl: string, html = ''): string =>
    [
        "default-src 'self'",
        ["script-src 'self'", ...inlineScriptHashes(html)].join(' '),
        "style-src 'self'",
        "style-src-attr 'unsafe-inline'",
        "img-src 'self' data:",
        `connect-src 'self' ${new URL(apiUrl).origin}`,
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ].join('; ');

/**
 * The policy a response of the server gets. None from the dev server: Vite injects inline modules and talks to the page
 * over a websocket for hot reload, which a strict policy would block.
 */
export const documentPolicy = (apiUrl: string, html: string, production: boolean): string | undefined => (production ? contentSecurityPolicy(apiUrl, html) : undefined);
