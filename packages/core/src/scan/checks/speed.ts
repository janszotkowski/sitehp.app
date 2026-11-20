import { MAX_DEPTH, attribute, elementsOf, hasAttribute, type HtmlElement } from '../html.ts';
import type { AssetSample } from '../page.ts';
import type { CheckDefinition } from '../check.ts';
import { blockedPage } from '../gate.ts';
import { HTML_BYTES, RESOURCES, TTFB_MS } from '../limits.ts';

/** Speed: how long the server takes to start answering. Measured from our server, so it includes the distance to it; a number to compare over time, not an absolute. */
export const ttfb: CheckDefinition = {
    id: 'ttfb',
    category: 'speed',
    group: 'speed_server',
    layer: 'light',
    severity: 'medium',
    effort: 'hours',
    run: ({ page }) => {
        if (page === undefined) throw new Error('this check needs the fetched page');
        // A firewall's answer says nothing about how fast the site is.
        const gate = blockedPage(page);
        if (gate !== null) return gate;
        const status = page.ttfbMs > TTFB_MS.fail ? 'fail' : page.ttfbMs > TTFB_MS.warn ? 'warn' : 'pass';
        return { status, evidence: { ttfbMs: page.ttfbMs } };
    },
};

// Below this a file is smaller than the headers around it, so compressing it gains nothing.
const COMPRESS_FROM_BYTES = 1024;

const compressed = (encoding: string | null | undefined): boolean => encoding !== null && encoding !== undefined && encoding !== '' && encoding !== 'identity';

/**
 * Speed: the server compresses text. An uncompressed page or script is several times larger on the wire than it needs to be.
 * The page is judged first (fail), then a few of its stylesheets and scripts (warn): a site that compresses its HTML but not its files is half done.
 */
export const compression: CheckDefinition = {
    id: 'compression',
    category: 'speed',
    group: 'speed_server',
    layer: 'light',
    severity: 'medium',
    effort: 'minutes',
    run: ({ page, assetSample }) => {
        if (page === undefined) throw new Error('this check needs the fetched page');
        const gate = blockedPage(page);
        if (gate !== null) return gate;
        // Only text answers compress; an error page or an image says nothing about the server's setup.
        if (page.status < 200 || page.status >= 300 || page.contentType === null || !/^text\/html|^application\/xhtml/i.test(page.contentType))
            return { status: 'skipped', evidence: {}, skippedReason: 'not_html' };
        const encoding = page.headers['content-encoding']?.trim().toLowerCase() ?? null;
        const files = (assetSample ?? []).filter((file) => file.status >= 200 && file.status < 300);
        const plain = files.filter((file) => !compressed(file.contentEncoding) && file.bytes > COMPRESS_FROM_BYTES);
        const evidence = { htmlEncoding: encoding ?? 'none', htmlBytes: page.bytes, htmlTransferredBytes: page.transferredBytes, filesSampled: files.length, filesUncompressed: plain.length };
        if (!compressed(encoding) && page.bytes > COMPRESS_FROM_BYTES) return { status: 'fail', evidence };
        return { status: plain.length > 0 ? 'warn' : 'pass', evidence };
    },
};

/** Whether a browser may keep a static file: it is not `no-store`/`max-age=0`, and it either has a lifetime or can at least be revalidated (`ETag`, `Last-Modified`). */
const cacheable = (file: AssetSample): boolean => {
    const control = file.cacheControl?.toLowerCase() ?? '';
    if (/\bno-store\b|\bmax-age=0\b/.test(control)) return false;
    return control !== '' || file.etag !== null || file.lastModified !== null;
};

/** Speed: stylesheets and scripts can be kept by the browser. A file that is sent again on every visit is the cheapest speed-up there is to give away. */
export const cacheHeaders: CheckDefinition = {
    id: 'cache_headers',
    category: 'speed',
    group: 'speed_server',
    layer: 'light',
    severity: 'low',
    effort: 'minutes',
    run: ({ assetSample }) => {
        if (assetSample === undefined) throw new Error('this check needs the asset sample');
        const files = assetSample.filter((file) => file.status >= 200 && file.status < 300);
        if (files.length === 0) return { status: 'skipped', evidence: {}, skippedReason: 'no_sample' };
        const uncached = files.filter((file) => !cacheable(file));
        return {
            status: uncached.length > 0 ? 'warn' : 'pass',
            evidence: { filesSampled: files.length, filesUncached: uncached.length, ...(uncached[0] === undefined ? {} : { example: uncached[0].url.slice(0, 200) }) },
        };
    },
};

/** Speed: the page is served over HTTP/2 or HTTP/3, which load many files over one connection. HTTP/1.1 makes the browser queue or open several. */
export const httpVersion: CheckDefinition = {
    id: 'http_version',
    category: 'speed',
    group: 'speed_server',
    layer: 'light',
    severity: 'low',
    effort: 'minutes',
    run: ({ page }) => {
        if (page === undefined) throw new Error('this check needs the fetched page');
        const gate = blockedPage(page);
        if (gate !== null) return gate;
        // Our own connection speaks h2 or http/1.1 only; HTTP/3 shows as the `h3` the server advertises in `Alt-Svc`.
        const altSvc = page.headers['alt-svc'] ?? null;
        const h3 = altSvc !== null && /\bh3(-\d+)?=/.test(altSvc);
        const evidence = { protocol: page.alpn ?? 'unknown', h3Advertised: h3 };
        if (page.alpn === 'h2' || h3) return { status: 'pass', evidence };
        if (page.alpn === 'http/1.1') return { status: 'warn', evidence };
        // Plain http or a recording: no handshake told us the protocol.
        return { status: 'skipped', evidence, skippedReason: 'protocol_unknown' };
    },
};

// Over these the page is heavy for a phone (see `limits.ts`). A page cut at the fetcher's cap (1 MB) is over the second line by definition. A typical page loads about 70 files and one in ten over 170.

/** Speed: how much the page asks a visitor to download, read from the HTML alone: its own size and how many scripts, styles, images and fonts it points to. */
export const pageWeight: CheckDefinition = {
    id: 'page_weight',
    category: 'speed',
    group: 'speed_page',
    layer: 'light',
    severity: 'low',
    effort: 'hours',
    run: async ({ page }) => {
        if (page === undefined) throw new Error('this check needs the fetched page');
        const gate = blockedPage(page);
        if (gate !== null) return gate;
        if (!/html/i.test(page.contentType ?? '')) return { status: 'skipped', evidence: { contentType: page.contentType }, skippedReason: 'not_html' };
        if (page.status >= 400) return { status: 'skipped', evidence: { status: page.status }, skippedReason: 'error_page' };
        const elements = await elementsOf(page);
        if (elements === null) return { status: 'skipped', evidence: { maxDepth: MAX_DEPTH }, skippedReason: 'too_deep' };
        const rel = (element: HtmlElement) => attribute(element, 'rel')?.toLowerCase().split(/\s+/) ?? [];
        const scripts = elements.filter((element) => element.tagName === 'script' && (attribute(element, 'src') ?? '') !== '').length;
        const styles = elements.filter((element) => element.tagName === 'link' && rel(element).includes('stylesheet')).length;
        const images = elements.filter((element) => element.tagName === 'img').length;
        const fonts = elements.filter((element) => element.tagName === 'link' && rel(element).includes('preload') && attribute(element, 'as')?.toLowerCase() === 'font').length;
        const resources = scripts + styles + images + fonts;
        const evidence = { htmlBytes: page.bytes, htmlTransferredBytes: page.transferredBytes, scripts, styles, images, fonts, truncated: page.truncated };
        if (page.truncated || page.bytes > HTML_BYTES.fail || resources > RESOURCES.fail) return { status: 'fail', evidence };
        return { status: page.bytes > HTML_BYTES.warn || resources > RESOURCES.warn ? 'warn' : 'pass', evidence };
    },
};

const inHead = (element: HtmlElement): boolean => (element.parentNode as { tagName?: string } | null)?.tagName === 'head';

/**
 * Speed: what in `<head>` stops the browser from showing anything until it is downloaded. A script with a `src` and neither `async`, `defer` nor
 * `type=module` always does; a stylesheet does too, but one or two are normal, so only many of them count.
 */
export const renderBlocking: CheckDefinition = {
    id: 'render_blocking',
    category: 'speed',
    group: 'speed_page',
    layer: 'light',
    severity: 'low',
    effort: 'hours',
    run: async ({ page }) => {
        if (page === undefined) throw new Error('this check needs the fetched page');
        const gate = blockedPage(page);
        if (gate !== null) return gate;
        if (!/html/i.test(page.contentType ?? '')) return { status: 'skipped', evidence: { contentType: page.contentType }, skippedReason: 'not_html' };
        if (page.status >= 400) return { status: 'skipped', evidence: { status: page.status }, skippedReason: 'error_page' };
        const elements = await elementsOf(page);
        if (elements === null) return { status: 'skipped', evidence: { maxDepth: MAX_DEPTH }, skippedReason: 'too_deep' };
        const scripts = elements.filter(
            (element) =>
                element.tagName === 'script' &&
                inHead(element) &&
                (attribute(element, 'src') ?? '') !== '' &&
                !hasAttribute(element, 'async') &&
                !hasAttribute(element, 'defer') &&
                attribute(element, 'type')?.toLowerCase() !== 'module',
        ).length;
        // A stylesheet for another medium (print) does not hold back the first paint.
        const styles = elements.filter(
            (element) =>
                element.tagName === 'link' &&
                inHead(element) &&
                attribute(element, 'rel')?.toLowerCase().split(/\s+/).includes('stylesheet') === true &&
                (attribute(element, 'href') ?? '') !== '' &&
                !['print', 'speech'].includes(attribute(element, 'media')?.toLowerCase() ?? ''),
        ).length;
        const evidence = { blockingScripts: scripts, blockingStyles: styles };
        if (scripts >= 4) return { status: 'fail', evidence };
        return { status: scripts > 0 || styles > 4 ? 'warn' : 'pass', evidence };
    },
};

const MODERN_FORMAT = /\.(?:webp|avif)$/i;
const LEGACY_FORMAT = /\.(?:jpe?g|png|gif)$/i;
const MODERN_TYPE = /^image\/(?:webp|avif)$/i;

/** The file extension of an image address, without the query or fragment. */
const pathOf = (reference: string): string => reference.replace(/[?#].*$/, '');

/** The address an `<img>` loads first: `src`, else the first candidate of `srcset`. A `data:` image has none worth judging. */
const imageSource = (image: HtmlElement): string | undefined => {
    const source = attribute(image, 'src') || attribute(image, 'srcset')?.split(',')[0]?.trim().split(/\s+/)[0];
    return source === undefined || source === '' || /^data:/i.test(source) ? undefined : source;
};

/** True when the image sits in a `<picture>` that offers a WebP or AVIF `<source>`: the browser takes that one. */
const hasModernSource = (image: HtmlElement): boolean => {
    const parent = image.parentNode as { tagName?: string; childNodes?: readonly unknown[] } | null;
    if (parent?.tagName !== 'picture') return false;
    return (parent.childNodes ?? []).some(
        (node) => typeof node === 'object' && node !== null && (node as { tagName?: string }).tagName === 'source' && MODERN_TYPE.test(attribute(node as HtmlElement, 'type') ?? ''),
    );
};

/**
 * Speed: pictures come in a modern format (WebP, AVIF), which is a fraction of the size of the same JPEG or PNG. Read from the address of each
 * `<img>`; SVG, `data:` URIs and addresses without a known extension are not judged. One or two old-format images (a logo) are not a finding.
 */
export const imageFormats: CheckDefinition = {
    id: 'image_formats',
    category: 'speed',
    group: 'speed_page',
    layer: 'light',
    severity: 'low',
    effort: 'hours',
    run: async ({ page }) => {
        if (page === undefined) throw new Error('this check needs the fetched page');
        const gate = blockedPage(page);
        if (gate !== null) return gate;
        if (!/html/i.test(page.contentType ?? '')) return { status: 'skipped', evidence: { contentType: page.contentType }, skippedReason: 'not_html' };
        if (page.status >= 400) return { status: 'skipped', evidence: { status: page.status }, skippedReason: 'error_page' };
        const elements = await elementsOf(page);
        if (elements === null) return { status: 'skipped', evidence: { maxDepth: MAX_DEPTH }, skippedReason: 'too_deep' };
        let modern = 0;
        let legacy = 0;
        for (const image of elements.filter((element) => element.tagName === 'img')) {
            const source = imageSource(image);
            if (source === undefined) continue;
            const path = pathOf(source);
            if (MODERN_FORMAT.test(path) || hasModernSource(image)) modern += 1;
            else if (LEGACY_FORMAT.test(path)) legacy += 1;
        }
        const judged = modern + legacy;
        if (judged === 0) return { status: 'skipped', evidence: { images: 0 }, skippedReason: 'no_images' };
        const evidence = { images: judged, modern, legacy, modernPercent: Math.round((modern / judged) * 100) };
        return { status: legacy >= 3 && modern / judged < 0.5 ? 'warn' : 'pass', evidence };
    },
};

// The first images are taken to be on the first screen, where lazy loading would delay them. Without a rendered page this is a guess from document order.
const ABOVE_THE_FOLD_IMAGES = 3;

/**
 * Speed: images far down the page are loaded only when the visitor gets near them (`loading="lazy"`). The first few images in the HTML count as the
 * first screen and are left out; the rest are judged. Estimated from the HTML order, not from a rendered layout.
 */
export const lazyLoading: CheckDefinition = {
    id: 'lazy_loading',
    category: 'speed',
    group: 'speed_page',
    layer: 'light',
    severity: 'low',
    effort: 'minutes',
    run: async ({ page }) => {
        if (page === undefined) throw new Error('this check needs the fetched page');
        const gate = blockedPage(page);
        if (gate !== null) return gate;
        if (!/html/i.test(page.contentType ?? '')) return { status: 'skipped', evidence: { contentType: page.contentType }, skippedReason: 'not_html' };
        if (page.status >= 400) return { status: 'skipped', evidence: { status: page.status }, skippedReason: 'error_page' };
        const elements = await elementsOf(page);
        if (elements === null) return { status: 'skipped', evidence: { maxDepth: MAX_DEPTH }, skippedReason: 'too_deep' };
        const images = elements.filter((element) => element.tagName === 'img' && imageSource(element) !== undefined);
        const below = images.slice(ABOVE_THE_FOLD_IMAGES);
        if (below.length < 3) return { status: 'skipped', evidence: { images: images.length }, skippedReason: 'few_images' };
        const lazy = below.filter((image) => attribute(image, 'loading')?.toLowerCase() === 'lazy').length;
        const evidence = { images: images.length, belowFirstScreen: below.length, lazy, notLazy: below.length - lazy };
        return { status: lazy * 2 < below.length ? 'warn' : 'pass', evidence };
    },
};

export const speedChecks: readonly CheckDefinition[] = [ttfb, compression, cacheHeaders, httpVersion, pageWeight, renderBlocking, imageFormats, lazyLoading];
