import { getDomain } from 'tldts';

/**
 * The domain someone registers, by the Public Suffix List: `x.com` for `a.b.x.com`. Its private section counts too, so the
 * sites of `x.github.io` and `y.github.io` belong to different people. A host the list cannot place counts as itself.
 */
export const registrableDomain = (host: string): string => getDomain(host, { allowPrivateDomains: true }) ?? host;
