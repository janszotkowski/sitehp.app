import { DEFAULT_SITE_ORIGIN } from './origin';

const configured: unknown = import.meta.env.VITE_SITE_URL;

export const SITE_ORIGIN: string = (typeof configured === 'string' && configured !== '' ? configured : DEFAULT_SITE_ORIGIN).replace(/\/$/, '');

/** Indexing is allowed only when explicitly enabled (production). Every other environment is noindex. */
export const ALLOW_INDEXING: boolean = import.meta.env.VITE_ALLOW_INDEXING === 'true';

/** Whether the pages say the product is in beta. On unless `VITE_SHOW_BETA=false` is set at build time: turn it off for the real launch. */
export const SHOW_BETA: boolean = import.meta.env.VITE_SHOW_BETA !== 'false';

export const siteConfig = {
    title: 'sitehp.app',
    url: SITE_ORIGIN,
} as const;

/**
 * Public profiles of the product. Empty until they exist: JSON-LD `sameAs` may
 * only contain addresses that really belong to sitehp.app.
 */
export const SOCIAL_PROFILES: readonly string[] = [];

/** X/Twitter accounts (`@handle`). `null` = none, and the tags are omitted. */
export const TWITTER_ACCOUNTS: { site: string | null; creator: string | null } = { site: null, creator: null };

export const canonicalUrl = (path = ''): string => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return normalizedPath === '/' ? SITE_ORIGIN : `${SITE_ORIGIN}${normalizedPath}`;
};
