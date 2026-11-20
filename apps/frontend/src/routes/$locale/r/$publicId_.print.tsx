import { domainToUnicode, type ScanSnapshot } from '@sitehp.app/core/browser';
import { createFileRoute, getRouteApi } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { PrintReport } from '@components/PrintReport';
import { siteConfig } from '@config/site';
import { asLocale } from '@lib/i18n/switchLocalePath';
import { loadReport } from '@lib/loadReport';
import { printPathOf } from '@lib/reportPrint';
import { m } from '@paraglide/messages.js';

const routeApi = getRouteApi('/$locale/r/$publicId_/print');

// The explicit return type keeps TypeScript from checking the body while it infers the route's own type (a cycle).
const PrintPage = (): ReactElement => {
    const locale = asLocale(routeApi.useParams().locale);
    return (
        <PrintReport
            snapshot={routeApi.useLoaderData()}
            locale={locale}
        />
    );
};

/** The report laid out for paper, at its own address. Private like the report: never indexed, and not in the sitemap. */
export const Route = createFileRoute('/$locale/r/$publicId_/print')({
    head: ({ params, loaderData }) => {
        const locale = asLocale(params.locale);
        const domain = loaderData === undefined ? '' : domainToUnicode(loaderData.domain);
        return {
            meta: [{ title: `${m.report_print_title({ domain }, { locale })} | ${siteConfig.title}` }, { name: 'robots', content: 'noindex, nofollow' }],
            links: [{ rel: 'canonical', href: printPathOf(locale, params.publicId) }],
        };
    },
    loader: ({ params }: { params: { publicId: string } }): Promise<ScanSnapshot> => loadReport(params.publicId),
    component: PrintPage,
});
