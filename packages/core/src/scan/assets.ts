import { attribute, elementsOf } from './html.ts';
import type { FetchedPage } from './page.ts';
import { sitemapSampleUrls } from './site-files.ts';

/** Up to `limit` stylesheets and scripts the page links on its own site, spread over the page (first, middle, last). */
export const assetUrlsOf = async (page: FetchedPage, limit: number): Promise<string[]> => {
    const elements = await elementsOf(page);
    if (elements === null) return [];
    const found = new Set<string>();
    for (const element of elements) {
        const reference =
            element.tagName === 'script'
                ? attribute(element, 'src')
                : element.tagName === 'link' && attribute(element, 'rel')?.toLowerCase().split(/\s+/).includes('stylesheet')
                  ? attribute(element, 'href')
                  : undefined;
        if (reference === undefined || reference === '') continue;
        try {
            found.add(new URL(reference, page.finalUrl).href.replace(/#.*$/, ''));
        } catch {
            // A reference that is not an address is the page's own mistake, not a file to fetch.
        }
    }
    return sitemapSampleUrls([...found], new URL(page.finalUrl).host, limit);
};
