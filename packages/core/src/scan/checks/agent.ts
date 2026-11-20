import type { CheckDefinition, CheckOutcome, Group } from '../check.ts';
import { blocked } from '../gate.ts';
import { attribute, elementsOf, visibleTextOf } from '../html.ts';
import { WORDS } from '../limits.ts';
import { AI_RETRIEVAL_AGENTS, AI_TRAINING_AGENTS, robotsBlockedAgents, robotsRefusingSignals } from '../site-files.ts';
import { isFile } from '../site-files.ts';
import { onHtml } from './seo-html.ts';

const agent = (id: string, group: Group, severity: CheckDefinition['severity'], effort: CheckDefinition['effort'], run: CheckDefinition['run']): CheckDefinition => ({
    id,
    category: 'agent',
    group,
    layer: 'light',
    severity,
    effort,
    run,
});

const unreachable: CheckOutcome = { status: 'skipped', evidence: {}, skippedReason: 'unreachable' };
const turnedAway: CheckOutcome = { status: 'skipped', evidence: {}, skippedReason: 'blocked' };

/**
 * Agents: `/llms.txt` exists, starts with a title and links with absolute addresses, as the proposal asks (an agent reads the file
 * on its own, without a page to resolve a relative link against). It is not a standard and no search engine requires it, so a gap only warns.
 */
const llmsTxt = agent('llms_txt', 'agent_content', 'low', 'minutes', ({ llms }) => {
    if (llms === undefined) throw new Error('this check needs llms.txt');
    if (llms === null) return unreachable;
    if (blocked(llms.status)) return turnedAway;
    if (!isFile(llms)) return { status: 'warn', evidence: { present: false, status: llms.status } };
    const first =
        llms.body
            .replace(/^\uFEFF/, '')
            .split(/\r?\n/)
            .find((line) => line.trim() !== '') ?? '';
    const hasTitle = /^#\s+\S/.test(first);
    const targets = Array.from(llms.body.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g), (match) => match[1] ?? '');
    const relative = targets.filter((target) => !/^https?:\/\//i.test(target)).length;
    return { status: hasTitle && relative === 0 ? 'pass' : 'warn', evidence: { present: true, hasTitle, links: targets.length, relative } };
});

// `Link: </page.md>; rel="alternate"; type="text/markdown"`: the header form of the alternate link, which also works for pages that are not HTML.
const markdownLink = (header: string | null | undefined): string | undefined =>
    header
        ?.split(/,\s*(?=<)/)
        .find((part) => /;\s*rel="?alternate"?/i.test(part) && /;\s*type="?text\/markdown/i.test(part))
        ?.match(/^\s*<([^>]*)>/)?.[1];

/**
 * Agents: the page can be had as Markdown, by asking for it (`Accept: text/markdown`) or because it points to a Markdown version
 * (`<link rel="alternate" type="text/markdown">` or the same in a `Link` header, as llms.txt v2 proposes). Markdown is what an agent
 * reads best and cheapest. Never fails and weighs little: nothing requires it. A `.md` twin that nothing points to is not looked for.
 */
const markdownNegotiation = agent('markdown_negotiation', 'agent_content', 'low', 'hours', async ({ markdown, page }) => {
    if (markdown === undefined) throw new Error('this check needs the Markdown probe');
    if (markdown === null) return unreachable;
    if (blocked(markdown.status)) return turnedAway;
    if (markdown.status >= 200 && markdown.status < 300 && /markdown/i.test(markdown.contentType ?? '')) {
        // The same address answering in two formats must say so, or a shared cache hands Markdown to a browser.
        const varies = /(?:^|[\s,])(?:accept|\*)(?:$|[\s,])/i.test(markdown.vary ?? '');
        return { status: varies ? 'pass' : 'warn', evidence: { served: true, contentType: markdown.contentType, varyAccept: varies } };
    }
    const elements = page === undefined || !/html/i.test(page.contentType ?? '') ? null : await elementsOf(page);
    const tag = elements?.find((element) => element.tagName === 'link' && /\balternate\b/i.test(attribute(element, 'rel') ?? '') && /markdown/i.test(attribute(element, 'type') ?? ''));
    const alternate = tag === undefined ? (markdownLink(page?.headers['link']) ?? markdownLink(markdown.link)) : (attribute(tag, 'href') ?? '');
    if (alternate !== undefined) return { status: 'pass', evidence: { served: false, alternate: alternate.slice(0, 200) } };
    return { status: 'warn', evidence: { served: false, status: markdown.status, contentType: markdown.contentType } };
});

/**
 * Agents: `robots.txt` does not shut out the AI crawlers that fetch pages for a person asking an assistant (search and user agents).
 * Blocking the crawlers that collect training data is a choice about the content and is only reported, never judged. A `Content-Signal`
 * that refuses search or AI answers (`search=no`, `ai-input=no`) to those crawlers keeps the site out the same way, so it warns.
 */
const aiCrawlers = agent('ai_crawlers', 'agent_access', 'medium', 'minutes', ({ robots }) => {
    if (robots === undefined) throw new Error('this check needs robots.txt');
    if (robots === null) return unreachable;
    if (blocked(robots.status)) return turnedAway;
    // A server error is not a rule; what an AI crawler does then is its own policy.
    if (robots.status >= 500) return { status: 'skipped', evidence: { status: robots.status }, skippedReason: 'robots_error' };
    // No file, or an HTML fallback, forbids nothing: there are no rules to judge.
    if (!isFile(robots)) return { status: 'skipped', evidence: { present: false }, skippedReason: 'no_robots' };
    const retrieval = robotsBlockedAgents(robots.body, AI_RETRIEVAL_AGENTS);
    const training = robotsBlockedAgents(robots.body, AI_TRAINING_AGENTS);
    const refused = robotsRefusingSignals(robots.body, AI_RETRIEVAL_AGENTS).filter((name) => !retrieval.includes(name));
    const status = retrieval.length === AI_RETRIEVAL_AGENTS.length ? 'fail' : retrieval.length > 0 || refused.length > 0 ? 'warn' : 'pass';
    return { status, evidence: { present: true, blockedRetrieval: retrieval.join(', '), refusedBySignal: refused.join(', '), blockedTraining: training.join(', ') } };
});

const wordCount = (text: string): number => {
    let count = 0;
    for (const part of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) if (part.isWordLike === true) count += 1;
    return count;
};

/** Agents: the page's text is in the HTML the server sends. An agent that does not run scripts, as most do not, otherwise sees an empty shell. */
const contentInHtml = agent(
    'content_in_html',
    'agent_content',
    'high',
    'days',
    onHtml((_page, elements) => {
        const body = elements.find((element) => element.tagName === 'body');
        const words = body === undefined ? 0 : wordCount(visibleTextOf(body));
        const scripts = elements.filter((element) => element.tagName === 'script' && attribute(element, 'src') !== undefined).length;
        return { status: words < WORDS.few ? 'fail' : words < WORDS.enough ? 'warn' : 'pass', evidence: { words, scripts } };
    }),
);

export const agentChecks: readonly CheckDefinition[] = [llmsTxt, markdownNegotiation, aiCrawlers, contentInHtml];
