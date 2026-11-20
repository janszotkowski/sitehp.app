import type { CheckDefinition } from '../check.ts';

const schemeOf = (href: string): string | undefined => {
    try {
        return new URL(href).protocol.replace(/:$/, '');
    } catch {
        return undefined;
    }
};

/**
 * Security: visitors end up on HTTPS. What counts is where the page is really served from
 * after redirects, not what was typed: `http://` that redirects to `https://` passes, and
 * `https://` that redirects back to `http://` fails. Without the fetched page it judges the
 * address alone. Critical: a site only on http is not safe however good its headers.
 */
export const httpsScheme: CheckDefinition = {
    id: 'https_scheme',
    category: 'security',
    group: 'https',
    layer: 'light',
    severity: 'critical',
    effort: 'hours',
    run: ({ url, page }) => {
        const finalScheme = page === undefined ? url.scheme : (schemeOf(page.finalUrl) ?? url.scheme);
        return { status: finalScheme === 'https' ? 'pass' : 'fail', evidence: { scheme: url.scheme, finalScheme } };
    },
};
