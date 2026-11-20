import { ALLOW_INDEXING, SITE_ORIGIN, TWITTER_ACCOUNTS, siteConfig } from '@config/site';
import { LOCALES, DEFAULT_LOCALE, isLocale, type Locale } from '@lib/i18n/switchLocalePath';
import { markdownTwinOf } from '@lib/seoMarkdown';
import { m } from '@paraglide/messages.js';

export type SeoMeta = {
    title: string;
    description: string;
    /** Localized path of the page, e.g. `/en/pricing`. */
    path: string;
    /** Path to the social image. The default is the image of the page language. */
    ogImage?: string;
    /** Alt text of the image. The default describes the language's image, not the title. */
    ogImageAlt?: string;
    ogType?: 'website' | 'article';
    /** Keep this page out of the index (reports, signed-in pages, errors). */
    noindex?: boolean;
    schema?: Record<string, unknown>;
    /**
     * Language variants of the same page (paths). The default is the same path
     * in every language; pass only what really exists, otherwise `hreflang`
     * would point at a 404.
     */
    alternates?: Partial<Record<Locale, string>>;
};

const OG_LOCALE: Record<Locale, string> = { en: 'en_US', cs: 'cs_CZ' };

const TRAILING_BRAND = /\|\s*sitehp\.app\s*$/i;

const LOCALE_PREFIX = new RegExp(`^/(${LOCALES.join('|')})(?=/|$)`);

const localeOfPath = (path: string): Locale | undefined => {
    const found = LOCALE_PREFIX.exec(path)?.[1];
    return found !== undefined && isLocale(found) ? found : undefined;
};

/** The same page in another language, by the shape of `/{locale}/…` addresses. */
const pathInLocale = (path: string, locale: Locale): string => {
    return path.replace(LOCALE_PREFIX, `/${locale}`);
};

export const ogImagePath = (locale: Locale): string => {
    return `/og/${locale}.png`;
};

/** A value inside a title (a domain), cut to `max` characters with an ellipsis so it cannot push the title past what a result shows. */
export const clip = (text: string, max: number): string => {
    const characters = Array.from(text);
    return characters.length <= max ? text : `${characters.slice(0, max - 1).join('')}…`;
};

const documentTitle = (title: string): string => {
    const trimmed = title.trimEnd();
    if (TRAILING_BRAND.test(trimmed)) {
        return trimmed;
    }
    return `${trimmed} | ${siteConfig.title}`;
};

export const seoHead = ({ title, description, path, ogImage, ogImageAlt, ogType = 'website', noindex = false, schema, alternates }: SeoMeta) => {
    const locale = localeOfPath(path);
    const url = `${SITE_ORIGIN}${path}`;
    const imageUrl = `${SITE_ORIGIN}${ogImage ?? ogImagePath(locale ?? DEFAULT_LOCALE)}`;
    const resolvedTitle = documentTitle(title);
    const imageAlt = ogImageAlt ?? m.seo_og_alt({}, { locale: locale ?? DEFAULT_LOCALE });
    const blocked = noindex || !ALLOW_INDEXING;
    const markdownTwin = markdownTwinOf(path);

    const variants: Partial<Record<Locale, string>> = alternates ?? (locale ? Object.fromEntries(LOCALES.map((candidate) => [candidate, pathInLocale(path, candidate)])) : {});
    const variantLocales = LOCALES.filter((candidate) => variants[candidate] !== undefined);
    // `x-default` is the default-language variant when it exists.
    const defaultVariant = variants[DEFAULT_LOCALE] ?? variantLocales.map((candidate) => variants[candidate]).find((value) => value !== undefined);
    const hreflang =
        variantLocales.length > 1 && defaultVariant !== undefined
            ? [
                  ...variantLocales.map((candidate) => ({ rel: 'alternate' as const, hrefLang: candidate, href: `${SITE_ORIGIN}${variants[candidate]}` })),
                  { rel: 'alternate' as const, hrefLang: 'x-default', href: `${SITE_ORIGIN}${defaultVariant}` },
              ]
            : [];

    return {
        meta: [
            { title: resolvedTitle },
            { name: 'description', content: description },
            { name: 'robots', content: blocked ? 'noindex, nofollow' : 'index, follow' },
            { property: 'og:title', content: resolvedTitle },
            { property: 'og:description', content: description },
            { property: 'og:url', content: url },
            { property: 'og:type', content: ogType },
            { property: 'og:image', content: imageUrl },
            { property: 'og:image:alt', content: imageAlt },
            { property: 'og:image:width', content: '1200' },
            { property: 'og:image:height', content: '630' },
            { property: 'og:site_name', content: siteConfig.title },
            ...(locale
                ? [
                      { property: 'og:locale', content: OG_LOCALE[locale] },
                      ...variantLocales.filter((candidate) => candidate !== locale).map((candidate) => ({ property: 'og:locale:alternate', content: OG_LOCALE[candidate] })),
                  ]
                : []),
            { name: 'twitter:card', content: 'summary_large_image' },
            { name: 'twitter:title', content: resolvedTitle },
            { name: 'twitter:description', content: description },
            { name: 'twitter:image', content: imageUrl },
            { name: 'twitter:image:alt', content: imageAlt },
            ...(TWITTER_ACCOUNTS.site ? [{ name: 'twitter:site', content: TWITTER_ACCOUNTS.site }] : []),
            ...(TWITTER_ACCOUNTS.creator ? [{ name: 'twitter:creator', content: TWITTER_ACCOUNTS.creator }] : []),
        ],
        links: [
            { rel: 'canonical' as const, href: url },
            ...hreflang,
            ...(markdownTwin === undefined ? [] : [{ rel: 'alternate' as const, type: 'text/markdown', href: `${SITE_ORIGIN}${markdownTwin}` }]),
        ],
        scripts: schema ? [{ type: 'application/ld+json' as const, children: JSON.stringify(schema).replace(/</g, '\\u003c') }] : [],
    };
};
