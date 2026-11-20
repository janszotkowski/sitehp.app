import { describe, expect, it } from 'vitest';
import { TECHNOLOGIES, TECHNOLOGY_RULES, detectTechnologies } from '@src/scan/technology.ts';

const detect = (headers: Record<string, string>, body = '') => detectTechnologies({ headers, body });

describe('detectTechnologies', () => {
    it('has a rule for every technology, in the same order, each with at least one sign', () => {
        expect(TECHNOLOGY_RULES.map((rule) => rule.id)).toEqual([...TECHNOLOGIES]);
        for (const rule of TECHNOLOGY_RULES)
            expect(Object.keys(rule.headers ?? {}).length + (rule.body ?? []).length + Number(rule.generator !== undefined) + Number(rule.htmlTag !== undefined), rule.id).toBeGreaterThan(0);
    });

    it('recognises an app by its HTML and the server by its headers, apps first', () => {
        const body = '<link rel="stylesheet" href="/wp-content/themes/x/style.css">';
        expect(detect({ server: 'nginx/1.24', 'cf-ray': 'abc' }, body)).toEqual(['wordpress', 'cloudflare', 'nginx']);
    });

    it('recognises each app from its own sign', () => {
        expect(detect({}, '<script src="https://cdn.shopify.com/s/files/x.js">')).toEqual(['shopify']);
        expect(detect({}, '<script id="__NEXT_DATA__" type="application/json">')).toEqual(['nextjs']);
        expect(detect({ 'x-powered-by': 'Next.js' })).toEqual(['nextjs']);
        expect(detect({}, '<script src="/_nuxt/entry.js">')).toEqual(['nuxt']);
        expect(detect({ link: '<https://example.com/wp-json/>; rel="https://api.w.org/"' })).toEqual(['wordpress']);
        expect(detect({}, '<meta name="generator" content="Drupal 10 (https://www.drupal.org)">')).toEqual(['drupal']);
        expect(detect({}, '<meta charset="utf-8"><meta content="WordPress 6.6" name="generator">')).toEqual(['wordpress']);
        expect(detect({}, '<meta name=generator content="Joomla! - Open Source Content Management">')).toEqual(['joomla']);
        expect(detect({}, '<!doctype html><html lang="en" data-wf-page="64a1" data-wf-site="64a0"><head>')).toEqual(['webflow']);
        expect(detect({}, '<html lang="en"><body><p>data-wf-page= outside the html tag</p>')).toEqual([]);
        expect(detect({ server: 'Apache/2.4.57 (Debian)' })).toEqual(['apache']);
        expect(detect({ server: 'cloudflare' })).toEqual(['cloudflare']);
    });

    it('says nothing when nothing is recognised, and does not read past the start of a big page', () => {
        expect(detect({ server: 'custom' }, '<html><body>hello</body></html>')).toEqual([]);
        expect(detect({}, `${'x'.repeat(250_000)}/wp-content/`)).toEqual([]);
    });

    it('stays fast on a page crafted to make the patterns backtrack', () => {
        const startedAt = performance.now();
        detect({}, '<meta name="generator"'.repeat(10_000));
        detect({}, '<html'.repeat(50_000));
        detect({}, `<html>${'<meta name="generator" content="x">'.repeat(10_000)}`);
        // Linear work: well under 50 ms locally; the margin is for a loaded CI runner.
        expect(performance.now() - startedAt).toBeLessThan(1_000);
    });
});
