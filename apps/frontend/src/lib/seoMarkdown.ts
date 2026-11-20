import { SITE_ORIGIN } from '@config/site';
import { DEFAULT_LOCALE } from '@lib/i18n/switchLocalePath';
import { getPublicPages, markdownPath } from '@vite/pages';
import { m } from '@paraglide/messages.js';

/** Markdown address → the public page it is the twin of. Only public pages have one: never a report or an error page. */
const TWINS: ReadonlyMap<string, string> = new Map(getPublicPages().map(({ path }) => [markdownPath(path), path]));

/** The page whose Markdown twin `pathname` is, if it is one. */
export const markdownSourceOf = (pathname: string): string | undefined => TWINS.get(pathname);

/** The Markdown twin of a page, if the page has one. */
export const markdownTwinOf = (path: string): string | undefined => (TWINS.has(markdownPath(path)) ? markdownPath(path) : undefined);

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = (text: string): string =>
    text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
        if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
        if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
        return NAMED[name] ?? entity;
    });

const stripTags = (html: string): string => html.replace(/<[^>]*>/g, '');

/** One line of text: tags gone, whitespace collapsed (entities are decoded once, at the end). */
const inline = (html: string): string => stripTags(html).replace(/\s+/g, ' ').trim();

const absolute = (href: string): string => (href.startsWith('/') && !href.startsWith('//') ? `${SITE_ORIGIN}${href}` : href);

const table = (html: string): string => {
    const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
        [...(row[1] ?? '').matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map((cell) => inline(cell[1] ?? '').replaceAll('|', '\\|')),
    );
    const [head, ...body] = rows;
    if (head === undefined) return '';
    const line = (cells: string[]): string => `| ${cells.join(' | ')} |`;
    return `\n\n${[line(head), line(head.map(() => '---')), ...body.map(line)].join('\n')}\n\n`;
};

/**
 * The `<main>` of one of our own server-rendered pages as Markdown, for agents (the `.md` twin of a public page).
 * shortcut: regular expressions over React's own, well-formed output, enough for headings, paragraphs, lists, links and
 * simple tables; switch to a real HTML parser if a page gains nested lists or tables, or markup this does not cover.
 */
export const htmlToMarkdown = (html: string): string => {
    const main = /<main\b[^>]*>([\s\S]*)<\/main>/.exec(html)?.[1] ?? '';
    const markdown = main
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style|svg|form|template)\b[\s\S]*?<\/\1>/g, '')
        .replace(/<span\b[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, '')
        .replace(/<\w+\b(?=[^>]*\brole="img")[^>]*\baria-label="([^"]*)"[^>]*>/g, '\n\n$1\n\n')
        .replace(/<table\b[^>]*>([\s\S]*?)<\/table>/g, (_, body: string) => table(body))
        // Address lines are stacked by CSS, not by markup.
        .replace(/<address\b[^>]*>([\s\S]*?)<\/address>/g, (_, body: string) => `\n\n${body.replace(/<\/(span|a)>/g, '$&\n')}\n\n`)
        .replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_, href: string, text: string) => (href.startsWith('#') ? inline(text) : `[${inline(text)}](${absolute(decode(href))})`))
        .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/g, (_, _tag: string, text: string) => `**${inline(text)}**`)
        .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/g, (_, text: string) => `\`${inline(text)}\``)
        .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g, (_, level: string, text: string) => `\n\n${'#'.repeat(Number(level))} ${inline(text)}\n\n`)
        .replace(/<summary\b[^>]*>([\s\S]*?)<\/summary>/g, (_, text: string) => `\n\n**${inline(text)}**\n\n`)
        // A list item made of blocks (a card with a heading) reads better as its blocks than as a bullet.
        .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/g, (_, body: string) => (/\n\n|<p\b/.test(body) ? `\n\n${body}\n\n` : `\n- ${body}\n`))
        .replace(/<(p|br)\b[^>]*>/g, '\n\n')
        .replace(/<\/(p|div|section|header|footer|figure|figcaption|ul|ol|li|details|dl|dt|dd|blockquote|nav|article|aside)>/g, '\n');
    return `${decode(stripTags(markdown))
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .replaceAll(')[', ') [')
        .replace(/\n{3,}/g, '\n\n')
        .trim()}\n`;
};

/** The `q` of each media range in an `Accept` header (`text/html;q=0.9` → 0.9); a missing `q` is 1. */
const acceptQualities = (accept: string): Map<string, number> => {
    const qualities = new Map<string, number>();
    for (const part of accept.split(',')) {
        const [range = '', ...params] = part.split(';').map((piece) => piece.trim().toLowerCase());
        const q = params.map((param) => /^q=([\d.]+)$/.exec(param)?.[1]).find((value) => value !== undefined);
        const quality = q === undefined ? 1 : Number(q);
        if (range !== '' && !Number.isNaN(quality)) qualities.set(range, quality);
    }
    return qualities;
};

/**
 * Whether a request asks for Markdown rather than HTML (agents send `Accept: text/markdown`; browsers never do).
 * `text/markdown` must be named with `q > 0` and rank at least as high as HTML (named, or through `text/*` or `*\/*`);
 * a bare `*\/*` never triggers it.
 */
export const wantsMarkdown = (accept: string | null | undefined): boolean => {
    if (!accept) return false;
    const qualities = acceptQualities(accept);
    const markdown = qualities.get('text/markdown') ?? 0;
    const html = qualities.get('text/html') ?? qualities.get('text/*') ?? qualities.get('*/*') ?? 0;
    return markdown > 0 && markdown >= html;
};

/** A rough token count for agents budgeting their context (about four characters a token). */
export const markdownTokens = (markdown: string): number => Math.ceil(markdown.length / 4);

/** The answer to an agent that asked for a page that does not exist, in Markdown rather than the HTML error page. */
export const notFoundMarkdown = (): string => {
    const locale = DEFAULT_LOCALE;
    return `# ${m.notfound_title({}, { locale })}\n\n${m.notfound_body({}, { locale })}\n\n[${m.notfound_back_home({}, { locale })}](${SITE_ORIGIN}/${locale})\n`;
};
