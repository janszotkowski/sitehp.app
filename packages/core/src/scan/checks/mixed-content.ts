import type { CheckDefinition } from '../check.ts';
import { blockedPage, wallPage } from '../gate.ts';
import { MAX_DEPTH, attribute, elementsOf } from '../html.ts';
import { cspPolicies } from './security-headers.ts';

const LOADS = new Set(['script', 'iframe', 'embed', 'object', 'link', 'img', 'audio', 'video', 'source', 'track']);
const ACTIVE = new Set(['script', 'iframe', 'embed', 'object', 'link']);
// Only the attributes the browser loads: `data-src` (lazy loading) is not one of them.
const URL_ATTRIBUTES = ['src', 'data', 'href'];

/**
 * Security: an https page that loads something over http. A script, frame or stylesheet
 * (active) lets anyone on the network rewrite the page: fail. An image, audio or video
 * (passive) only leaks and can be swapped: warn. Reads the beginning of the page only
 * (the fetch caps the body), and links (`<a href>`) are not resources, so they are ignored.
 * A CSP with `upgrade-insecure-requests` passes: the browser upgrades every such load.
 */
export const mixedContent: CheckDefinition = {
    id: 'mixed_content',
    category: 'security',
    group: 'content',
    layer: 'light',
    severity: 'high',
    effort: 'hours',
    run: async ({ page, url }) => {
        if (page === undefined) throw new Error('this check needs the fetched page');
        const gate = blockedPage(page) ?? wallPage(page, url);
        if (gate !== null) return gate;
        // On an http page there is no https to mix with: https_scheme reports that.
        if (!page.finalUrl.startsWith('https://')) return { status: 'skipped', evidence: { applicable: false }, skippedReason: 'not_applicable' };
        const elements = await elementsOf(page);
        if (elements === null) return { status: 'skipped', evidence: { maxDepth: MAX_DEPTH }, skippedReason: 'too_deep' };
        // With `upgrade-insecure-requests` (in any policy, header or `<meta>`) the browser loads every http resource over https, so nothing is mixed.
        if (cspPolicies(page, elements).some((policy) => policy.has('upgrade-insecure-requests'))) return { status: 'pass', evidence: { applicable: true, upgraded: true } };
        let active = 0;
        let passive = 0;
        let example = '';
        for (const element of elements) {
            const name = element.tagName;
            if (!LOADS.has(name)) continue;
            if (name === 'link' && !(attribute(element, 'rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet')) continue;
            const url = URL_ATTRIBUTES.map((key) => attribute(element, key)).find((value) => value !== undefined && /^http:\/\//i.test(value));
            if (url === undefined) continue;
            if (ACTIVE.has(name)) active += 1;
            else passive += 1;
            if (example === '' || (ACTIVE.has(name) && active === 1)) example = url.slice(0, 200);
        }
        const status = active > 0 ? 'fail' : passive > 0 ? 'warn' : 'pass';
        return { status, evidence: { applicable: true, active, passive, example } };
    },
};
