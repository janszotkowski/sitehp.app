import { decode } from './entities.ts';

export type RobotsInfo = {
    /** The rules Googlebot follows (its own group, else `User-agent: *`) forbid the whole site and allow nothing back. */
    blocksAll: boolean;
    /** Every `Sitemap:` address the file names. */
    sitemaps: string[];
};

type RobotsRule = { allow: boolean; path: string };

type RobotsGroup = { agents: string[]; disallowAll: boolean; allowsAll: boolean; rules: RobotsRule[]; signals: string[] };

// Google matches the product token only, up to the first character outside `[A-Za-z_-]`, so `Googlebot/2.1` names Googlebot.
const productToken = (agent: string): string => (/^[a-z_-]+/i.exec(agent)?.[0] ?? agent).toLowerCase();

const readRobots = (text: string): { groups: RobotsGroup[]; sitemaps: string[] } => {
    const groups: RobotsGroup[] = [];
    const sitemaps: string[] = [];
    let openGroup = false;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/#.*$/, '').trim();
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const field = line.slice(0, colon).trim().toLowerCase();
        const value = line.slice(colon + 1).trim();
        if (field === 'sitemap') {
            if (value !== '') sitemaps.push(value);
        } else if (field === 'user-agent') {
            // Consecutive `User-agent` lines share the rules that follow them.
            if (!openGroup) groups.push({ agents: [], disallowAll: false, allowsAll: false, rules: [], signals: [] });
            groups.at(-1)?.agents.push(productToken(value));
            openGroup = true;
        } else if (field === 'disallow' || field === 'allow' || field === 'content-signal') {
            openGroup = false;
            const group = groups.at(-1);
            if (group === undefined) continue;
            if (field === 'content-signal') {
                group.signals.push(value.toLowerCase());
                continue;
            }
            if (field === 'disallow' && (value === '/' || value === '/*')) group.disallowAll = true;
            // Only an `Allow` as wide as the block lifts it; `Allow: /wp-admin/admin-ajax.php` leaves the rest blocked, and `Allow: /$` only the home page.
            if (field === 'allow' && (value === '/' || value === '/*')) group.allowsAll = true;
            // An empty `Disallow:` allows everything: it is no rule.
            if (value !== '') group.rules.push({ allow: field === 'allow', path: value });
        }
    }
    return { groups, sitemaps };
};

/** The groups a crawler obeys: those naming it, else the `*` ones. */
const groupsFor = (groups: readonly RobotsGroup[], agent: string): RobotsGroup[] => {
    const token = productToken(agent);
    const own = groups.filter((group) => group.agents.includes(token));
    return own.length > 0 ? own : groups.filter((group) => group.agents.includes('*'));
};

const forbidsAll = (judged: readonly RobotsGroup[]): boolean => judged.some((group) => group.disallowAll) && !judged.some((group) => group.allowsAll);

/** Reads `robots.txt`: only what the checks need, not a full matcher. Judged for Googlebot, as Google does: its own groups, else the `*` ones. */
export const parseRobots = (text: string): RobotsInfo => {
    const { groups, sitemaps } = readRobots(text);
    return { blocksAll: forbidsAll(groupsFor(groups, 'googlebot')), sitemaps };
};

// Google reads at most 500 KiB of robots.txt and caps a rule at the length of a URL; what is past either is ignored.
const MAX_ROBOTS_CHARS = 512_000;
const MAX_RULE_CHARS = 2083;

/**
 * A rule path as Google reads it: `*` is any run of characters, a final `$` anchors the end, the rest matches from the start.
 * Without a regular expression: each piece between the stars is found in order, leftmost first, which is exact for `*`-only
 * patterns and linear in practice. A regular expression of `.*` runs backtracks exponentially, and the rule is the scanned site's to write.
 */
const ruleMatches = (rule: string, path: string): boolean => {
    const anchored = rule.endsWith('$');
    const pieces = (anchored ? rule.slice(0, -1) : rule).split('*');
    const first = pieces[0] ?? '';
    if (!path.startsWith(first)) return false;
    if (pieces.length === 1) return !anchored || path === first;
    // Anchored, the last piece must end the path, and the pieces between must fit before it.
    const last = pieces.at(-1) ?? '';
    const end = anchored ? path.length - last.length : path.length;
    if (anchored && (end < first.length || !path.endsWith(last))) return false;
    let at = first.length;
    for (const piece of anchored ? pieces.slice(1, -1) : pieces.slice(1)) {
        const found = path.indexOf(piece, at);
        if (found === -1 || found + piece.length > end) return false;
        at = found + piece.length;
    }
    return true;
};

/**
 * A rule or path in one percent-encoded form, as Google compares them: `/kontakt-ů` is `/kontakt-%C5%AF`. An escape already there
 * is kept (upper-cased, never encoded twice); `*` and `$` stay, since `encodeURI` keeps them.
 */
const encodePath = (path: string): string =>
    path.replace(/(%[\da-f]{2})|%|[^%]+/gi, (part, escape: string | undefined) => {
        if (escape !== undefined) return escape.toUpperCase();
        if (part === '%') return '%25';
        try {
            return encodeURI(part);
        } catch {
            // A lone surrogate cannot be encoded; left as it is, it matches only itself.
            return part;
        }
    });

export type RobotsVerdict = {
    allowed: boolean;
    /** The rule that decided, as written (`Disallow: /private`), or null when none matched. */
    rule: string | null;
};

/**
 * Whether Googlebot may fetch `path` (path and query): its own groups, else the `*` ones, and among their rules the longest
 * match wins, `Allow` on a tie, as Google decides. No matching rule allows.
 */
export const robotsVerdict = (text: string, path: string): RobotsVerdict => {
    const rules = groupsFor(readRobots(text.slice(0, MAX_ROBOTS_CHARS)).groups, 'googlebot')
        .flatMap((group) => group.rules)
        .filter((rule) => rule.path.length <= MAX_RULE_CHARS);
    const target = encodePath(path);
    let best: { rule: RobotsRule; pattern: string } | undefined;
    for (const rule of rules) {
        const pattern = encodePath(rule.path);
        if (!ruleMatches(pattern, target)) continue;
        if (best === undefined || pattern.length > best.pattern.length || (pattern.length === best.pattern.length && rule.allow)) best = { rule, pattern };
    }
    if (best === undefined) return { allowed: true, rule: null };
    return { allowed: best.rule.allow, rule: `${best.rule.allow ? 'Allow' : 'Disallow'}: ${best.rule.path}` };
};

/** AI crawlers that fetch a page for a person asking an assistant, or to answer from live results. Blocking them keeps the site out of those answers. */
export const AI_RETRIEVAL_AGENTS: readonly string[] = ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User'];

/** AI crawlers that collect pages to train models. Blocking them is a choice about the content, not a fault. */
export const AI_TRAINING_AGENTS: readonly string[] = [
    'GPTBot',
    'ClaudeBot',
    'anthropic-ai',
    'Google-Extended',
    'Applebot-Extended',
    'CCBot',
    'Bytespider',
    'Amazonbot',
    'Meta-ExternalAgent',
    'cohere-ai',
    'Diffbot',
];

/**
 * The retrieval crawlers whose `Content-Signal` refuses search or AI answers (`search=no`, `ai-input=no`). A named group replaces `*`,
 * so each crawler is read from its own groups, else the `*` ones.
 */
export const robotsRefusingSignals = (text: string, agents: readonly string[]): string[] => {
    const { groups } = readRobots(text);
    return agents.filter((agent) => groupsFor(groups, agent.toLowerCase()).some((group) => group.signals.some((signal) => /(?:^|[\s,])(?:search|ai-input)\s*=\s*no\b/.test(signal))));
};

/** The crawlers (by their robots.txt product token) whose rules forbid the whole site. Same simplification as `parseRobots`: only a site-wide `Disallow: /` counts. */
export const robotsBlockedAgents = (text: string, agents: readonly string[]): string[] => {
    const { groups } = readRobots(text);
    return agents.filter((agent) => forbidsAll(groupsFor(groups, agent.toLowerCase())));
};

export type SitemapInfo = {
    /** `urlset` lists pages, `index` lists other sitemaps, `invalid` is neither or is not well-formed. */
    kind: 'urlset' | 'index' | 'invalid';
    /** The `<loc>` addresses, decoded. */
    locations: string[];
};

/** The text with every `open`...`close` section (CDATA, comments) cut out, by `indexOf` so a section left open cannot make it slow. */
const cut = (text: string, open: string, close: string): string => {
    let kept = '';
    let from = 0;
    for (let start = text.indexOf(open); start !== -1; start = text.indexOf(open, from)) {
        kept += text.slice(from, start);
        const end = text.indexOf(close, start + open.length);
        from = end === -1 ? text.length : end + close.length;
    }
    return kept + text.slice(from);
};

// An `&` that starts no character reference makes the XML malformed; one at the very end may be a reference cut off mid-way.
const BARE_AMPERSAND = /&(?!(?:[a-z][\w.-]*|#\d+|#x[\da-f]+);|[\w#.-]*$)/i;

/**
 * Reads a sitemap's kind and addresses. A tolerant scan, not a schema validation; a cut-off file still yields what was read.
 * `complete` says the whole file was read, so a missing closing root tag is an error and not the cut.
 */
export const parseSitemap = (text: string, complete = false): SitemapInfo => {
    // The sitemap namespace may come with a prefix (`<sm:urlset>`).
    const root = /<((?:[\w-]+:)?(sitemapindex|urlset))(?![\w.:-])/i.exec(text);
    const prefix = root?.[1]?.slice(0, -(root[2]?.length ?? 0)) ?? '';
    const kind = root === null ? 'invalid' : root[2]?.toLowerCase() === 'sitemapindex' ? 'index' : 'urlset';
    if (kind === 'invalid' || BARE_AMPERSAND.test(cut(cut(text, '<![CDATA[', ']]>'), '<!--', '-->'))) return { kind: 'invalid', locations: [] };
    if (complete && !new RegExp(`</${root?.[1] ?? ''}\\s*>`, 'i').test(text)) return { kind: 'invalid', locations: [] };
    const open = new RegExp(`<${prefix}loc(?![\\w.:-])[^<>]*>`, 'gi');
    const close = new RegExp(`</${prefix}loc\\s*>`, 'gi');
    const locations: string[] = [];
    // Each `<loc>` is matched to the next closing tag by a forward scan: linear even when closing tags are missing.
    for (let match = open.exec(text); match !== null; match = open.exec(text)) {
        close.lastIndex = open.lastIndex;
        const end = close.exec(text);
        if (end === null) break;
        const loc = decode(
            text
                .slice(open.lastIndex, end.index)
                .replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '')
                .trim(),
        );
        if (loc !== '') locations.push(loc);
        open.lastIndex = close.lastIndex;
    }
    return { kind, locations };
};

// `www.example.com` and `example.com` are one site: a sitemap named on one is read on the other, as search engines do.
export const sameSite = (candidate: string, host: string): boolean => candidate === host || candidate === hostVariantOf(host);

/** Where to look for the sitemap: the first `Sitemap:` line of `robots.txt` on the scanned site, else `/sitemap.xml`. Another site's sitemap is not followed, so a site cannot point the scanner elsewhere. */
export const sitemapLocation = (robots: RobotsInfo | null, scheme: string, host: string): string => {
    for (const candidate of robots?.sitemaps ?? []) {
        try {
            const url = new URL(candidate);
            if (sameSite(url.host, host) && (url.protocol === 'https:' || url.protocol === 'http:')) return url.href;
        } catch {
            // A malformed line is skipped.
        }
    }
    return `${scheme}://${host}/sitemap.xml`;
};

/** Up to `limit` addresses on the scanned site, spread over the list (first, middle, last). */
export const sitemapSampleUrls = (locations: readonly string[], host: string, limit: number): string[] => {
    const own = locations.filter((loc) => {
        try {
            const url = new URL(loc);
            return sameSite(url.host, host) && (url.protocol === 'https:' || url.protocol === 'http:');
        } catch {
            return false;
        }
    });
    if (own.length <= limit) return own;
    if (limit < 2) return own.slice(0, limit);
    return Array.from({ length: limit }, (_unused, index) => own[Math.round((index * (own.length - 1)) / (limit - 1))] ?? '');
};

/**
 * The other name a site may answer on: `www.` added to a bare domain, or removed. Only for a name of two labels
 * or one that starts with `www.`, so `shop.example.com` has none.
 * shortcut: without a public-suffix list, `example.co.uk` has no variant; add the list when this misses real sites.
 */
export const hostVariantOf = (host: string): string | null => {
    if (host.startsWith('www.')) return host.slice(4);
    return host.split('.').length === 2 ? `www.${host}` : null;
};
