import type { CheckDefinition } from '../check.ts';
import { blockedPage } from '../gate.ts';

/**
 * SEO: the page answers with a successful status. A page that answers 404 or 500 cannot
 * be found, ranked or used. The first check that reads the fetched page rather than the URL.
 * Critical: an error page skips the checks of the HTML, so without the cap the headers alone would score it.
 */
export const httpStatus: CheckDefinition = {
    id: 'http_status',
    category: 'seo',
    group: 'page',
    layer: 'light',
    severity: 'critical',
    effort: 'hours',
    run: ({ page }) => {
        if (page === undefined) throw new Error('this check needs the fetched page');
        // A firewall's 403 is not the site's answer; `computeScore` reads this skip as "no score".
        const gate = blockedPage(page);
        if (gate !== null) return gate;
        const ok = page.status >= 200 && page.status < 300;
        return { status: ok ? 'pass' : 'fail', evidence: { status: page.status, redirects: page.redirects.length } };
    },
};
