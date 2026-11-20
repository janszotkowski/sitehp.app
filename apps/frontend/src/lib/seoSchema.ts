import { OPERATOR } from '@config/operator';
import { SITE_ORIGIN, SOCIAL_PROFILES, canonicalUrl, siteConfig } from '@config/site';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { m } from '@paraglide/messages.js';

const SITE_URL = `${SITE_ORIGIN}/`;

type Node = Record<string, unknown>;

/** Nodes refer to each other by `@id`, not by copy: one operator, one node. */
export const OPERATOR_ID = `${SITE_URL}#operator`;
export const WEBSITE_ID = `${SITE_URL}#website`;
export const APPLICATION_ID = `${SITE_URL}#application`;

/** The site's own icon: it belongs to the product (website, application), not to the person who runs it. */
const SITE_IMAGE = `${SITE_ORIGIN}/apple-touch-icon.png`;

/** The single operator node for every public graph: the person who runs the site, with the product as its `brand`. The description is in the page language. */
export const operatorNode = (locale: Locale): Node => {
    return {
        '@type': 'Person',
        '@id': OPERATOR_ID,
        name: OPERATOR.name,
        url: OPERATOR.url,
        description: m.schema_operator_description({ name: OPERATOR.name }, { locale }),
        brand: { '@type': 'Brand', name: siteConfig.title, url: SITE_URL },
        sameAs: [OPERATOR.x, ...SOCIAL_PROFILES],
    };
};

export const websiteNode = (locale: Locale): Node => {
    return {
        '@type': 'WebSite',
        '@id': WEBSITE_ID,
        name: siteConfig.title,
        url: SITE_URL,
        image: SITE_IMAGE,
        description: m.schema_description({}, { locale }),
        inLanguage: locale,
        publisher: { '@id': OPERATOR_ID },
    };
};

/** The product itself. Used on the landing page; it is a free web application for people who build and run sites. */
export const applicationNode = (locale: Locale): Node => {
    return {
        '@type': 'WebApplication',
        '@id': APPLICATION_ID,
        name: siteConfig.title,
        url: SITE_URL,
        image: SITE_IMAGE,
        description: m.schema_description({}, { locale }),
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Any',
        inLanguage: locale,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        publisher: { '@id': OPERATOR_ID },
    };
};

export type WebPageInput = {
    type?: 'WebPage' | 'CollectionPage' | 'ProfilePage';
    name: string;
    description: string;
    path: string;
    locale: Locale;
    hasBreadcrumb?: boolean;
    mainEntity?: string;
    /** Day of the last substantive change (`YYYY-MM-DD`), only where it is really known. */
    dateModified?: string | undefined;
    /** Version of what the page describes, e.g. the scoring model on the methodology page. */
    version?: number;
};

export const webPageNode = (props: WebPageInput): Node => {
    const url = canonicalUrl(props.path);
    return {
        '@type': props.type ?? 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: props.name,
        description: props.description,
        inLanguage: props.locale,
        isPartOf: { '@id': WEBSITE_ID },
        ...(props.hasBreadcrumb ? { breadcrumb: { '@id': `${url}#breadcrumb` } } : {}),
        ...(props.mainEntity ? { mainEntity: { '@id': props.mainEntity } } : {}),
        ...(props.dateModified ? { dateModified: props.dateModified } : {}),
        ...(props.version === undefined ? {} : { version: props.version }),
    };
};

export type BlogPostingInput = {
    headline: string;
    description: string;
    path: string;
    locale: Locale;
    published: string;
    updated?: string | undefined;
};

/** A blog post, written and published by the operator. The page it sits on is its `WebPage` (`mainEntityOfPage`). */
export const blogPostingNode = (props: BlogPostingInput): Node => {
    const url = canonicalUrl(props.path);
    return {
        '@type': 'BlogPosting',
        '@id': `${url}#article`,
        url,
        headline: props.headline,
        description: props.description,
        inLanguage: props.locale,
        datePublished: props.published,
        dateModified: props.updated ?? props.published,
        author: { '@id': OPERATOR_ID },
        publisher: { '@id': OPERATOR_ID },
        mainEntityOfPage: { '@id': `${url}#webpage` },
    };
};

export type FaqItem = { q: string; a: string };

/** Questions and answers that are visible on the page (`path`), as `FAQPage`. */
export const faqPageNode = (path: string, items: readonly FaqItem[]): Node => {
    const url = canonicalUrl(path);
    return {
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        url,
        isPartOf: { '@id': `${url}#webpage` },
        mainEntity: items.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })),
    };
};

export type BreadcrumbItem = {
    name: string;
    path: string;
};

export const breadcrumbNode = (items: readonly BreadcrumbItem[]): Node => {
    const last = items[items.length - 1];
    return {
        '@type': 'BreadcrumbList',
        '@id': `${canonicalUrl(last?.path ?? '')}#breadcrumb`,
        itemListElement: items.map(({ name, path }, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name,
            item: canonicalUrl(path),
        })),
    };
};

/** One JSON-LD graph per page: `@context` once, nodes linked by `@id`. */
export const graph = (nodes: ReadonlyArray<Node>): Record<string, unknown> => {
    return { '@context': 'https://schema.org', '@graph': nodes };
};
