import type { Locale } from '@lib/i18n/switchLocalePath';
import { seoHead, type SeoMeta } from '@lib/seo';
import { breadcrumbNode, graph, operatorNode, webPageNode, websiteNode, type BreadcrumbItem, type WebPageInput } from '@lib/seoSchema';

type Props = Pick<SeoMeta, 'title' | 'description' | 'path' | 'ogImage' | 'ogImageAlt' | 'ogType' | 'noindex' | 'alternates'> & {
    locale: Locale;
    /** Breadcrumbs including the home page. Without it the node is not emitted. */
    breadcrumbs?: readonly BreadcrumbItem[];
    /** Extra nodes (application, article, …) attached to the page graph. */
    nodes?: ReadonlyArray<Record<string, unknown>>;
    page?: Pick<WebPageInput, 'type' | 'mainEntity' | 'dateModified' | 'version'>;
};

/**
 * Head of a public page: title, description, canonical, `hreflang`, Open Graph
 * and one JSON-LD graph (organization, website, page, breadcrumbs). The only
 * place that graph is assembled, so every page emits the same nodes in the
 * same shape. A `noindex` page gets no graph: nothing is to be understood
 * about a page kept out of search.
 */
export const pageHead = ({ locale, breadcrumbs, nodes = [], page, ...seo }: Props) => {
    const hasBreadcrumb = breadcrumbs !== undefined && breadcrumbs.length > 0;
    if (seo.noindex === true) return seoHead(seo);
    return seoHead({
        ...seo,
        schema: graph([
            operatorNode(locale),
            websiteNode(locale),
            webPageNode({ ...page, name: seo.title, description: seo.description, path: seo.path, locale, hasBreadcrumb }),
            ...(hasBreadcrumb ? [breadcrumbNode(breadcrumbs)] : []),
            ...nodes,
        ]),
    });
};
