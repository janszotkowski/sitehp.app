import type { CheckDefinition } from '../check.ts';
import { agentChecks } from './agent.ts';
import { agentDiscoveryChecks } from './agent-discovery.ts';
import { certExpiry, certValid, httpRedirect } from './https.ts';
import { cookieChecks } from './cookies.ts';
import { httpStatus } from './http-status.ts';
import { httpsScheme } from './https-scheme.ts';
import { mixedContent } from './mixed-content.ts';
import { speedChecks } from './speed.ts';
import { seoFileChecks } from './seo-files.ts';
import { seoHtmlChecks } from './seo-html.ts';
import { securityHeaders } from './security-headers.ts';

/** Every check the engine runs, in the order its results appear. Add a check by adding a file and listing it here. */
export const CHECKS: readonly CheckDefinition[] = [
    // First: a blocked page (401/403/429) means no score at all, so no preliminary score is shown before that is known.
    httpStatus,
    httpsScheme,
    httpRedirect,
    certValid,
    certExpiry,
    ...securityHeaders,
    ...cookieChecks,
    mixedContent,
    ...seoHtmlChecks,
    ...seoFileChecks,
    ...agentChecks,
    ...agentDiscoveryChecks,
    ...speedChecks,
];

export const CHECK_IDS: readonly string[] = CHECKS.map((check) => check.id);

/** The checks a scan runs: all of them, or the stored selection in registry order. */
export const checksFor = (selected: readonly string[] | undefined): readonly CheckDefinition[] => (selected === undefined ? CHECKS : CHECKS.filter((check) => selected.includes(check.id)));
