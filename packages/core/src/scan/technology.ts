/**
 * What a site is built with or served by, read from the response headers and the start of the HTML. Plain strings and regexes (no parser),
 * so the contract and a browser can import the ids. Apps come first, then the layer that serves them; unsure means an empty list, never a guess.
 */
export const TECHNOLOGIES = ['wordpress', 'shopify', 'nextjs', 'nuxt', 'wix', 'squarespace', 'webflow', 'drupal', 'joomla', 'cloudflare', 'vercel', 'netlify', 'nginx', 'apache'] as const;

export type Technology = (typeof TECHNOLOGIES)[number];

/** A technology is found by any one of its signs: a header present (or matching), a pattern in the HTML, its `<meta name="generator">` or its `<html>` tag. */
export type TechnologyRule = {
    id: Technology;
    /** Lower-case header name to a pattern for its value; `null` means the header only has to be there. */
    headers?: Readonly<Record<string, RegExp | null>>;
    /** Plain strings only: a pattern with a `[^>]+` run around a literal backtracks for minutes on a crafted page. Tags go in `generator` and `htmlTag`. */
    body?: readonly RegExp[];
    /** Matched against the content of `<meta name="generator">`. */
    generator?: RegExp;
    /** Matched against the page's `<html …>` tag. */
    htmlTag?: RegExp;
};

export const TECHNOLOGY_RULES: readonly TechnologyRule[] = [
    { id: 'wordpress', headers: { link: /api\.w\.org/i }, body: [/\/wp-(?:content|includes)\//i], generator: /^WordPress/i },
    { id: 'shopify', headers: { 'x-shopid': null, 'x-shopify-stage': null }, body: [/cdn\.shopify\.com/i, /Shopify\.theme/] },
    { id: 'nextjs', headers: { 'x-powered-by': /next\.js/i }, body: [/\/_next\//, /__NEXT_DATA__/] },
    { id: 'nuxt', body: [/\/_nuxt\//, /window\.__NUXT__/] },
    { id: 'wix', headers: { 'x-wix-request-id': null }, body: [/static\.parastorage\.com/i, /static\.wixstatic\.com/i] },
    { id: 'squarespace', body: [/static1\.squarespace\.com/i, /<!-- This is Squarespace\. -->/i] },
    { id: 'webflow', htmlTag: /\bdata-wf-(?:page|site)=/i },
    { id: 'drupal', headers: { 'x-generator': /drupal/i }, body: [/\/sites\/default\/files\//i], generator: /^Drupal/i },
    { id: 'joomla', generator: /^Joomla/i },
    { id: 'cloudflare', headers: { 'cf-ray': null, server: /^cloudflare$/i } },
    { id: 'vercel', headers: { 'x-vercel-id': null, server: /^vercel$/i } },
    { id: 'netlify', headers: { 'x-nf-request-id': null, server: /^netlify$/i } },
    { id: 'nginx', headers: { server: /nginx/i } },
    { id: 'apache', headers: { server: /apache/i } },
];

// A technology shows in the head or the first scripts, so the rest of a big page is not read.
const READ_BYTES = 200_000;
// The tags read: the generator is in the head, among the first few. Each is cut short, so a crafted page costs a fixed amount.
const MAX_TAGS = 200;
const MAX_TAG_LENGTH = 2_000;

/** The `<html>` tag and the generator's content, found in one linear pass: no pattern ever runs over more than one short tag. */
const tagsOf = (body: string): { htmlTag: string | undefined; generator: string | undefined } => {
    let htmlTag: string | undefined;
    let generator: string | undefined;
    const opening = /<(html|meta)\b/gi;
    for (let count = 0; count < MAX_TAGS && (htmlTag === undefined || generator === undefined); count++) {
        const match = opening.exec(body);
        if (match === null) break;
        const end = body.indexOf('>', match.index);
        // No `>` after this one means none after any later one either.
        if (end === -1) break;
        const tag = body.slice(match.index, Math.min(end, match.index + MAX_TAG_LENGTH));
        if (match[1]?.toLowerCase() === 'html') htmlTag ??= tag;
        else if (generator === undefined && /\bname=["']?generator\b/i.test(tag)) generator = /\bcontent=["']([^"']{0,200})/i.exec(tag)?.[1];
    }
    return { htmlTag, generator };
};

/** The technologies a response shows, in the order of `TECHNOLOGIES`. Needs only what the fetch already has. */
export const detectTechnologies = (page: { headers: Readonly<Record<string, string>>; body: string }): Technology[] => {
    const body = page.body.slice(0, READ_BYTES);
    const tags = tagsOf(body);
    return TECHNOLOGY_RULES.filter(
        (rule) =>
            Object.entries(rule.headers ?? {}).some(([name, pattern]) => {
                const value = page.headers[name];
                return value !== undefined && (pattern === null || pattern.test(value));
            }) ||
            (rule.body ?? []).some((pattern) => pattern.test(body)) ||
            (rule.generator !== undefined && tags.generator !== undefined && rule.generator.test(tags.generator)) ||
            (rule.htmlTag !== undefined && tags.htmlTag !== undefined && rule.htmlTag.test(tags.htmlTag)),
    ).map((rule) => rule.id);
};
