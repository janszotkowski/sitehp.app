import type { CheckContext, CheckDefinition, CheckOutcome, Group } from '../check.ts';
import { blockedPage, wallPage } from '../gate.ts';
import { MAX_DEPTH, attribute, elementsOf, hasAttribute, rawTextOf, textOf, type HtmlElement } from '../html.ts';
import { DESCRIPTION_LENGTH, TITLE_LENGTH } from '../limits.ts';
import type { FetchedPage } from '../page.ts';
import { hideQueryValues } from '../url.ts';

const named = (elements: readonly HtmlElement[], tag: string): HtmlElement[] => elements.filter((element) => element.tagName === tag);

const metaContents = (elements: readonly HtmlElement[], keys: readonly string[]): string[] =>
    named(elements, 'meta')
        .filter((tag) => keys.includes(attribute(tag, 'name')?.toLowerCase() ?? ''))
        .map((tag) => attribute(tag, 'content'))
        .filter((content) => content !== undefined);

const metaContent = (elements: readonly HtmlElement[], key: string): string | undefined => metaContents(elements, [key])[0];

/** Where a `<meta http-equiv="refresh">` sends the browser within a second, or null. Browsers obey the first such tag only. */
const immediateRefresh = (page: FetchedPage, elements: readonly HtmlElement[]): string | null => {
    const tag = named(elements, 'meta').find((meta) => attribute(meta, 'http-equiv')?.toLowerCase() === 'refresh');
    const match = /^(\d+(?:\.\d+)?)\s*[;,]\s*(?:url\s*=\s*)?(.*)$/i.exec(tag === undefined ? '' : (attribute(tag, 'content') ?? ''));
    const target = (match?.[2] ?? '').trim().replace(/^['"]|['"]$/g, '');
    if (match === null || Number(match[1]) > 1 || target === '') return null;
    try {
        return new URL(target, page.finalUrl).href;
    } catch {
        return target;
    }
};

/** These checks read HTML. A page that is not HTML has nothing to measure, so they report themselves `skipped`. */
export const onHtml = (run: (page: FetchedPage, elements: readonly HtmlElement[]) => CheckOutcome): CheckDefinition['run'] => {
    return async ({ page, url }: CheckContext): Promise<CheckOutcome> => {
        if (page === undefined) throw new Error('this check needs the fetched page');
        const gate = blockedPage(page) ?? wallPage(page, url);
        if (gate !== null) return gate;
        if (!/html/i.test(page.contentType ?? '')) return { status: 'skipped', evidence: { contentType: page.contentType }, skippedReason: 'not_html' };
        // An error page (a block page, a 404) is not the page the owner built: judging its title or headings would only add noise to `http_status`.
        if (page.status >= 400) return { status: 'skipped', evidence: { status: page.status }, skippedReason: 'error_page' };
        const elements = await elementsOf(page);
        if (elements === null) return { status: 'skipped', evidence: { maxDepth: MAX_DEPTH }, skippedReason: 'too_deep' };
        // A stub that sends the visitor on at once (`content="0;url=/cs/"`) is not the page, and the scanner does not follow it.
        const target = immediateRefresh(page, elements);
        if (target !== null) return { status: 'skipped', evidence: { target: hideQueryValues(target).slice(0, 200) }, skippedReason: 'meta_refresh' };
        return run(page, elements);
    };
};

const seo = (id: string, group: Group, severity: CheckDefinition['severity'], run: CheckDefinition['run']): CheckDefinition => ({
    id,
    category: 'seo',
    group,
    layer: 'light',
    severity,
    effort: 'minutes',
    run,
});

/** SEO: one `<title>` of a sensible length. It is the headline in search results; a missing one is replaced by whatever the search engine guesses. */
const seoTitle = seo(
    'seo_title',
    'page',
    'high',
    onHtml((_page, elements) => {
        const titles = named(elements, 'title').map(textOf);
        const length = titles[0]?.length ?? 0;
        if (length === 0) return { status: 'fail', evidence: { count: titles.length, length } };
        const status = titles.length > 1 || length < TITLE_LENGTH.min || length > TITLE_LENGTH.max ? 'warn' : 'pass';
        return { status, evidence: { count: titles.length, length, title: (titles[0] ?? '').slice(0, 200) } };
    }),
);

/** SEO: a meta description of a sensible length. Search engines often show it under the title. */
const metaDescription = seo(
    'meta_description',
    'page',
    'medium',
    onHtml((_page, elements) => {
        const description = metaContent(elements, 'description') ?? '';
        const length = description.length;
        if (length === 0) return { status: 'fail', evidence: { length } };
        return { status: length < DESCRIPTION_LENGTH.min || length > DESCRIPTION_LENGTH.max ? 'warn' : 'pass', evidence: { length, description: description.slice(0, 200) } };
    }),
);

/** SEO: exactly one non-empty `<h1>`. It tells visitors and search engines what the page is about. */
export const h1 = seo(
    'h1',
    'page',
    'medium',
    onHtml((page, elements) => {
        const headings = named(elements, 'h1')
            .map(textOf)
            .filter((text) => text !== '');
        // The fetch keeps only the start of a big page, so a missing heading may simply lie past the cut.
        if (headings.length === 0 && page.truncated) return { status: 'skipped', evidence: { truncated: true }, skippedReason: 'truncated' };
        if (headings.length === 0) return { status: 'fail', evidence: { count: 0 } };
        return { status: headings.length === 1 ? 'pass' : 'warn', evidence: { count: headings.length, h1: (headings[0] ?? '').slice(0, 200) } };
    }),
);

// `user-scalable=no` or a `maximum-scale` under 2 stops people from zooming in, which those who need larger text rely on (WCAG 1.4.4).
const blocksZoom = (content: string): boolean => {
    const maximum = /maximum-scale\s*=\s*([\d.]+)/i.exec(content)?.[1];
    return /user-scalable\s*=\s*(?:no|0)\b/i.test(content) || (maximum !== undefined && Number(maximum) < 2);
};

/** SEO: a viewport meta tag that fits the device and lets people zoom. Without it phones render the page as a shrunken desktop site, and Google ranks mobile first. */
export const viewport = seo(
    'viewport',
    'page',
    'high',
    onHtml((_page, elements) => {
        const content = metaContent(elements, 'viewport');
        if (content === undefined) return { status: 'fail', evidence: { present: false } };
        const zoomBlocked = blocksZoom(content);
        return { status: /width\s*=\s*device-width/i.test(content) && !zoomBlocked ? 'pass' : 'warn', evidence: { present: true, content: content.slice(0, 200), zoomBlocked } };
    }),
);

/** SEO: a `lang` on `<html>`. It tells search engines and screen readers which language the page is in. */
const htmlLang = seo(
    'html_lang',
    'page',
    'low',
    onHtml((_page, elements) => {
        const root = named(elements, 'html')[0];
        const lang = (root === undefined ? undefined : attribute(root, 'lang')) ?? '';
        return { status: lang === '' ? 'fail' : 'pass', evidence: { lang } };
    }),
);

// Origin and path only: the query of the scanned address (`?utm_source=`) is what a canonical exists to drop, so it counts only when the link names one.
const sameAddress = (link: string, pageUrl: string): boolean => {
    try {
        const left = new URL(link);
        const right = new URL(pageUrl);
        const path = (url: URL): string => url.origin + url.pathname.replace(/\/$/, '');
        return path(left) === path(right) && (left.search === '' || left.search === right.search);
    } catch {
        return false;
    }
};

/** SEO: a canonical link that is an absolute address and names this page. Without it, copies of the page (tracking parameters, `www`) compete with each other. */
export const canonical = seo(
    'canonical',
    'indexing',
    'medium',
    onHtml((page, elements) => {
        const hrefs = named(elements, 'link')
            .filter((link) => relHas(link, 'canonical'))
            .map((link) => attribute(link, 'href') ?? '')
            .filter((href) => href !== '');
        const href = hrefs[0];
        if (href === undefined) return { status: 'warn', evidence: { present: false } };
        // Several different canonicals leave search engines to pick one, or ignore them all.
        if (new Set(hrefs).size > 1) return { status: 'warn', evidence: { present: true, conflicting: true, count: hrefs.length, href: href.slice(0, 200) } };
        if (!/^https?:\/\//i.test(href)) return { status: 'warn', evidence: { present: true, absolute: false, href: href.slice(0, 200) } };
        return { status: sameAddress(href, page.finalUrl) ? 'pass' : 'warn', evidence: { present: true, absolute: true, matches: sameAddress(href, page.finalUrl), href: href.slice(0, 200) } };
    }),
);

// Directives whose own value holds a colon, so `unavailable_after: ...` is not read as a crawler name.
const VALUED_DIRECTIVE = /^(?:unavailable_after|max-snippet|max-image-preview|max-video-preview)$/i;

/** `X-Robots-Tag` may name a crawler (`googlebot: noindex`); a directive applies to the last one named, or to all before any is named. Only Google's and the general ones count. */
const headerNoindex = (value: string): boolean => {
    let agent = '';
    return value.split(',').some((part) => {
        const prefixed = /^\s*([\w-]+)\s*:(.*)$/.exec(part);
        let directive = part;
        if (prefixed !== null && !VALUED_DIRECTIVE.test(prefixed[1] ?? '')) {
            agent = (prefixed[1] ?? '').toLowerCase();
            directive = prefixed[2] ?? '';
        }
        return (agent === '' || agent === 'googlebot') && /^(?:noindex|none)$/i.test(directive.trim());
    });
};

/** SEO: the page is not told to stay out of search results, by meta tag or by `X-Robots-Tag`. A forgotten `noindex` from staging removes a site from Google. */
export const noindex = seo(
    'noindex',
    'indexing',
    'critical',
    onHtml((page, elements) => {
        const meta = metaContents(elements, ['robots', 'googlebot']).some((content) => /(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/i.test(content));
        const header = headerNoindex(page.headers['x-robots-tag'] ?? '');
        return { status: meta || header ? 'fail' : 'pass', evidence: { meta, header } };
    }),
);

const relHas = (tag: HtmlElement, token: string): boolean => (attribute(tag, 'rel') ?? '').toLowerCase().split(/\s+/).includes(token);

const metaProperty = (elements: readonly HtmlElement[], key: string): string | undefined =>
    named(elements, 'meta')
        .filter((tag) => (attribute(tag, 'property') ?? attribute(tag, 'name'))?.toLowerCase() === key)
        .map((tag) => attribute(tag, 'content'))
        .find((content) => content !== undefined && content !== '');

const OPEN_GRAPH = ['og:title', 'og:description', 'og:image', 'og:url'];

/** SEO: the Open Graph tags that decide how a link looks when it is shared in a chat or on a social network. */
const openGraph = seo(
    'open_graph',
    'social',
    'medium',
    onHtml((_page, elements) => {
        const missing = OPEN_GRAPH.filter((key) => metaProperty(elements, key) === undefined);
        const status = missing.length === 0 ? 'pass' : missing.length === OPEN_GRAPH.length ? 'fail' : 'warn';
        return { status, evidence: { present: OPEN_GRAPH.length - missing.length, missing: missing.join(', ') } };
    }),
);

const OPEN_GRAPH_DETAIL = ['og:type', 'og:site_name', 'og:locale', 'og:image:alt'];

/**
 * SEO: the Open Graph details beyond the basics: the kind of page, the site's name, the language, a text for the image, and an image
 * address that a chat app can fetch (absolute, https). Skipped when the page has no Open Graph at all: `open_graph` reports that.
 */
const openGraphQuality = seo(
    'open_graph_quality',
    'social',
    'low',
    onHtml((_page, elements) => {
        if (OPEN_GRAPH.every((key) => metaProperty(elements, key) === undefined)) return { status: 'skipped', evidence: { present: 0 }, skippedReason: 'not_applicable' };
        const missing = OPEN_GRAPH_DETAIL.filter((key) => metaProperty(elements, key) === undefined);
        const image = metaProperty(elements, 'og:image');
        const imageAbsolute = image === undefined || /^https:\/\//i.test(image);
        return { status: missing.length === 0 && imageAbsolute ? 'pass' : 'warn', evidence: { missing: missing.join(', '), imageAbsolute } };
    }),
);

/** SEO: a Twitter/X card. Without it X falls back to Open Graph, so a gap is only a hint. */
const twitterCard = seo(
    'twitter_card',
    'social',
    'low',
    onHtml((_page, elements) => {
        const card = metaProperty(elements, 'twitter:card');
        return card === undefined ? { status: 'warn', evidence: { present: false } } : { status: 'pass', evidence: { present: true, card: card.slice(0, 50) } };
    }),
);

/** SEO: headings go down one level at a time (h2 then h4 skips a level). A broken outline blurs the structure for search engines and screen readers. */
const headingOrder = seo(
    'heading_order',
    'page',
    'low',
    onHtml((_page, elements) => {
        // Read like the `h1` check: an empty heading is no heading, an image's alt is its text.
        const levels = elements.filter((element) => /^h[1-6]$/.test(element.tagName) && textOf(element) !== '').map((element) => Number(element.tagName.slice(1)));
        if (levels.length === 0) return { status: 'skipped', evidence: { count: 0 }, skippedReason: 'no_headings' };
        const skips = levels.filter((level, index) => index > 0 && level > (levels[index - 1] ?? 0) + 1).length;
        return { status: skips === 0 ? 'pass' : 'warn', evidence: { count: levels.length, skips } };
    }),
);

// An ARIA label is a text alternative too, and `role="presentation"` or `aria-hidden` declares the image decorative.
const labelled = (tag: HtmlElement): boolean =>
    (attribute(tag, 'aria-label') ?? '') !== '' ||
    (attribute(tag, 'aria-labelledby') ?? '') !== '' ||
    /^(?:presentation|none)$/i.test(attribute(tag, 'role') ?? '') ||
    attribute(tag, 'aria-hidden')?.toLowerCase() === 'true';

/** SEO: every image has an `alt` attribute. An empty `alt=""` is right for decoration; a missing one hides the image from search and screen readers. */
const imgAlt = seo(
    'img_alt',
    'page',
    'medium',
    onHtml((_page, elements) => {
        const images = named(elements, 'img');
        const missing = images.filter((tag) => !hasAttribute(tag, 'alt') && !labelled(tag)).length;
        const status = missing === 0 ? 'pass' : missing * 2 > images.length ? 'fail' : 'warn';
        return { status, evidence: { images: images.length, missing } };
    }),
);

// A size in the attributes, or an inline style that sets one, lets the browser keep the space before the image loads.
const sized = (tag: HtmlElement): boolean => (hasAttribute(tag, 'width') && hasAttribute(tag, 'height')) || /(?:^|;)\s*(?:aspect-ratio|height)\s*:/i.test(attribute(tag, 'style') ?? '');

/**
 * SEO: images say how big they are (`width` and `height`), so the page does not jump when they load (layout shift, a Core Web Vital).
 * A stylesheet may size them too, which the scan cannot see, so a gap only warns. Skipped on a page without images.
 */
const imgDimensions = seo(
    'img_dimensions',
    'page',
    'low',
    onHtml((_page, elements) => {
        const images = named(elements, 'img').filter((tag) => !/^data:/i.test(attribute(tag, 'src') ?? ''));
        if (images.length === 0) return { status: 'skipped', evidence: { images: 0 }, skippedReason: 'not_applicable' };
        const missing = images.filter((tag) => !sized(tag)).length;
        return { status: missing === 0 ? 'pass' : 'warn', evidence: { images: images.length, missing } };
    }),
);

/** SEO: the page links an icon. Without one, browser tabs, bookmarks and search results show a blank placeholder. */
export const favicon = seo(
    'favicon',
    'page',
    'low',
    onHtml((_page, elements) => {
        const present = named(elements, 'link').some((tag) => relHas(tag, 'icon') && (attribute(tag, 'href') ?? '') !== '');
        return { status: present ? 'pass' : 'warn', evidence: { present } };
    }),
);

// Google no longer shows HowTo rich results (2023); FAQ ones only for government and health sites, so neither is judged.
const RETIRED_TYPES = new Set(['HowTo']);

/** The `@type`s of a JSON-LD value: its own, or those of the items of an array or an `@graph`. An item without one adds `''`. */
const typesOf = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.flatMap(typesOf);
    if (typeof value !== 'object' || value === null) return [''];
    const record = value as Record<string, unknown>;
    if (Array.isArray(record['@graph'])) return record['@graph'].flatMap(typesOf);
    const type = record['@type'];
    if (typeof type === 'string') return [type];
    return Array.isArray(type) && type.length > 0 ? type.map(String) : [''];
};

/** SEO: structured data in JSON-LD, valid JSON with a `@type` on every item. It lets search engines show rich results; a broken or untyped block is silently ignored. */
const jsonLd = seo(
    'json_ld',
    'page',
    'low',
    onHtml((_page, elements) => {
        const blocks = named(elements, 'script')
            .filter((element) => /ld\+json/i.test(attribute(element, 'type') ?? ''))
            .map(rawTextOf);
        let invalid = 0;
        const types: string[] = [];
        for (const block of blocks) {
            try {
                types.push(...typesOf(JSON.parse(block)));
            } catch {
                invalid += 1;
            }
        }
        const typeNames = Array.from(new Set(types.filter((type) => type !== '')));
        const untyped = types.filter((type) => type === '').length;
        const evidence = { blocks: blocks.length, invalid, types: typeNames.join(', ').slice(0, 200), untyped, retired: typeNames.filter((type) => RETIRED_TYPES.has(type)).join(', ') };
        if (invalid > 0) return { status: 'fail', evidence };
        return { status: blocks.length > 0 && untyped === 0 ? 'pass' : 'warn', evidence };
    }),
);

const LANGUAGE_TAG = /^(?:x-default|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/i;

/** SEO: for a site in several languages, `hreflang` links are valid, absolute and include the page itself. A site with none is not multilingual, so the check does not apply. */
export const hreflang = seo(
    'hreflang',
    'indexing',
    'low',
    onHtml((page, elements) => {
        const alternates = named(elements, 'link').filter((tag) => relHas(tag, 'alternate') && attribute(tag, 'hreflang') !== undefined);
        if (alternates.length === 0) return { status: 'skipped', evidence: { applicable: false }, skippedReason: 'not_applicable' };
        const entries = alternates.map((tag) => ({ lang: attribute(tag, 'hreflang') ?? '', href: attribute(tag, 'href') ?? '' }));
        const bad = entries.filter((entry) => !LANGUAGE_TAG.test(entry.lang) || !/^https?:\/\//i.test(entry.href)).length;
        const self = entries.some((entry) => sameAddress(entry.href, page.finalUrl));
        return { status: bad === 0 && self ? 'pass' : 'warn', evidence: { applicable: true, count: entries.length, invalid: bad, self } };
    }),
);

/**
 * What a page says about its own indexing: `noindex` (meta tag or header) and its canonical address, made absolute. Read for the
 * sitemap sample, where a listed page that is noindex or names another canonical tells search engines two different things.
 */
export const indexingOf = async (page: FetchedPage): Promise<{ noindex: boolean; canonical: string | null }> => {
    const header = headerNoindex(page.headers['x-robots-tag'] ?? '');
    const elements = /html/i.test(page.contentType ?? '') ? await elementsOf(page) : null;
    if (elements === null) return { noindex: header, canonical: null };
    const meta = metaContents(elements, ['robots', 'googlebot']).some((content) => /(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/i.test(content));
    const href = named(elements, 'link')
        .filter((link) => relHas(link, 'canonical'))
        .map((link) => attribute(link, 'href') ?? '')
        .find((value) => value !== '');
    let canonical: string | null = null;
    try {
        canonical = href === undefined ? null : new URL(href, page.finalUrl).href;
    } catch {
        // A canonical that is no address is the `canonical` check's finding.
    }
    return { noindex: meta || header, canonical };
};

export const seoHtmlChecks: readonly CheckDefinition[] = [
    seoTitle,
    metaDescription,
    h1,
    viewport,
    htmlLang,
    canonical,
    noindex,
    openGraph,
    openGraphQuality,
    twitterCard,
    headingOrder,
    imgAlt,
    imgDimensions,
    favicon,
    jsonLd,
    hreflang,
];
