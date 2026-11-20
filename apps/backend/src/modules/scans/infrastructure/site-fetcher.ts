import type { Config } from '@config/env.ts';
import type { Clock } from '@platform/ports.ts';
import type { Logger } from '@platform/logger.ts';
import { isBlockedHost } from '@platform/net/blocked-hosts.ts';
import { createSafeFetcher } from '@platform/net/safe-fetch.ts';
import type { SiteFetcher } from '@modules/scans/ports.ts';

/** Identifies the scanner to the sites it visits, with a place to read about it. */
export const SCANNER_USER_AGENT = 'sitehp.app-scanner/1.0 (+https://sitehp.app)';

/** The SSRF-safe fetcher with the limits from configuration. */
export const createSiteFetcher = (
    config: Pick<Config, 'FETCH_TIMEOUT_MS' | 'FETCH_MAX_BYTES' | 'FETCH_MAX_REDIRECTS' | 'BLOCKED_TLDS' | 'BLOCKED_DOMAINS' | 'NAT64_PREFIXES'>,
    clock: Clock,
    logger?: Logger,
): SiteFetcher => {
    const safe = createSafeFetcher({
        timeoutMs: config.FETCH_TIMEOUT_MS,
        maxBytes: config.FETCH_MAX_BYTES,
        maxRedirects: config.FETCH_MAX_REDIRECTS,
        userAgent: SCANNER_USER_AGENT,
        nat64Prefixes: config.NAT64_PREFIXES,
        ...(logger === undefined ? {} : { logger }),
        isHostBlocked: (host) => isBlockedHost(host, { tlds: config.BLOCKED_TLDS, domains: config.BLOCKED_DOMAINS }),
        now: () => clock.now().getTime(),
    });
    return {
        fetchPage: (url, options) => safe.fetchPage(url, options?.signal, options?.accept, options?.stayOnSite),
        inspectCertificate: (host) => safe.inspectCertificate(host),
        close: () => safe.close(),
    };
};
