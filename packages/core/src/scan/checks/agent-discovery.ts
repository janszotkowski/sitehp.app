import type { CheckContext, CheckDefinition, CheckOutcome } from '../check.ts';
import { AGENT_FILE_PATHS } from '../agent-files.ts';
import { blocked, blockedPage } from '../gate.ts';
import type { SiteFile } from '../page.ts';

/**
 * Agent discovery: emerging ways for a site to tell an agent what it offers. They are bonus signals: a site that does not publish one is
 * `skipped` (`not_offered`), never penalised, since most sites have no API or OAuth server to describe. A file that is there but wrong
 * only warns. Every path and field is from the RFC or protocol spec named on each check.
 */
const discovery = (id: string, effort: CheckDefinition['effort'], run: CheckDefinition['run']): CheckDefinition => ({
    id,
    category: 'agent',
    group: 'agent_discovery',
    layer: 'light',
    severity: 'low',
    effort,
    run,
});

const notOffered = (evidence: Record<string, string | number | boolean | null> = {}): CheckOutcome => ({ status: 'skipped', evidence, skippedReason: 'not_offered' });

const filesOf = (context: CheckContext): Readonly<Record<string, SiteFile | null>> => {
    if (context.agentFiles === undefined) throw new Error('this check needs the well-known files');
    return context.agentFiles;
};

const ok = (file: SiteFile): boolean => file.status >= 200 && file.status < 300;

// A site that answers every path with its home page (a single-page app) returns HTML for these: that is no file of ours.
const isHtml = (file: SiteFile): boolean => /^\s*<(?:!doctype html|html|head)\b/i.test(file.body.replace(/^﻿/, ''));

const jsonOf = (file: SiteFile): unknown => {
    try {
        return JSON.parse(file.body.replace(/^﻿/, ''));
    } catch {
        return undefined;
    }
};

const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

type Found = { file: SiteFile; data: Record<string, unknown> | null };

/** What the paths answered: a firewall (`blocked`), nothing at all (`unreachable`), no file (`absent`), or the files that are there, with their JSON when it parses. */
const look = (files: Readonly<Record<string, SiteFile | null>>, paths: readonly string[]): { state: 'blocked' | 'unreachable' | 'absent' } | { state: 'found'; found: Found[] } => {
    const answers = paths.map((path) => files[path] ?? null);
    if (answers.every((file) => file === null)) return { state: 'unreachable' };
    // A file that is there counts first: a firewall on one path does not hide a valid file on another.
    const present = answers.filter((file): file is SiteFile => file !== null && ok(file) && !isHtml(file));
    if (present.length > 0) return { state: 'found', found: present.map((file) => ({ file, data: record(jsonOf(file)) })) };
    return answers.some((file) => file !== null && blocked(file.status)) ? { state: 'blocked' } : { state: 'absent' };
};

const skip = (state: 'blocked' | 'unreachable' | 'absent'): CheckOutcome => (state === 'absent' ? notOffered() : { status: 'skipped', evidence: {}, skippedReason: state });

// RFC 8288 names the link relations an agent can follow; the last three are service description and documentation (RFC 8631) and `describedby` (RFC 6892).
const AGENT_RELATIONS = ['api-catalog', 'service-desc', 'service-doc', 'describedby'];

const relationsOf = (header: string): string[] => Array.from(header.matchAll(/rel\s*=\s*(?:"([^"]*)"|([^\s;,]+))/gi), (match) => (match[1] ?? match[2] ?? '').toLowerCase().split(/\s+/)).flat();

/** Bonus: the page's `Link` header points an agent at its API catalog, service description or documentation (RFC 8288, RFC 9727, RFC 8631). */
export const linkHeaders = discovery('link_headers', 'minutes', ({ page }) => {
    if (page === undefined) throw new Error('this check needs the fetched page');
    const gate = blockedPage(page);
    if (gate !== null) return gate;
    const found = relationsOf(page.headers['link'] ?? '').filter((relation) => AGENT_RELATIONS.includes(relation));
    return found.length === 0 ? notOffered() : { status: 'pass', evidence: { relations: Array.from(new Set(found)).join(', ') } };
});

/** Bonus: an API catalog at `/.well-known/api-catalog` (RFC 9727): a JSON linkset that lists the site's APIs. */
export const apiCatalog = discovery('api_catalog', 'hours', (context) => {
    const seen = look(filesOf(context), [AGENT_FILE_PATHS.apiCatalog]);
    if (seen.state !== 'found') return skip(seen.state);
    const linkset = seen.found[0]?.data?.['linkset'];
    if (!Array.isArray(linkset)) return { status: 'warn', evidence: { present: true, valid: false } };
    return { status: linkset.length > 0 ? 'pass' : 'warn', evidence: { present: true, valid: true, entries: linkset.length } };
});

/** Bonus: protected resource metadata at `/.well-known/oauth-protected-resource` (RFC 9728): JSON with the required `resource`. */
export const oauthResource = discovery('oauth_resource', 'hours', (context) => {
    const seen = look(filesOf(context), [AGENT_FILE_PATHS.oauthResource]);
    if (seen.state !== 'found') return skip(seen.state);
    const valid = typeof seen.found[0]?.data?.['resource'] === 'string';
    return { status: valid ? 'pass' : 'warn', evidence: { present: true, valid } };
});

/** Bonus: an A2A Agent Card at `/.well-known/agent-card.json` (A2A protocol): JSON with a `name` and a list of `skills`. */
export const a2aAgentCard = discovery('a2a_agent_card', 'hours', (context) => {
    const seen = look(filesOf(context), [AGENT_FILE_PATHS.a2aAgentCard]);
    if (seen.state !== 'found') return skip(seen.state);
    const data = seen.found[0]?.data;
    const valid = typeof data?.['name'] === 'string' && Array.isArray(data['skills']);
    return { status: valid ? 'pass' : 'warn', evidence: { present: true, valid } };
});

export const agentDiscoveryChecks: readonly CheckDefinition[] = [linkHeaders, apiCatalog, oauthResource, a2aAgentCard];
