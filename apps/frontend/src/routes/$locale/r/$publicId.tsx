import { CHECKS, SCORE_MODEL_VERSION, domainToUnicode, scoreBand, simulateFix, type Category, type ScanSnapshot } from '@sitehp.app/core/browser';
import { Link, createFileRoute, getRouteApi } from '@tanstack/react-router';
import { useCallback, useState, type ReactElement } from 'react';
import { CategoryScores } from '@components/CategoryScores';
import { CopyButton } from '@components/CopyButton';
import { ProgressBar } from '@components/ProgressBar';
import { ReportBadge } from '@components/ReportBadge';
import { RawHeaders } from '@components/RawHeaders';
import { ReportTable } from '@components/ReportTable';
import { ScanAgain, canScanAgain } from '@components/ScanAgain';
import { ScanBanter } from '@components/ScanBanter';
import { ScoreRing } from '@components/ScoreRing';
import { Button, buttonVariants } from '@components/ui/button';
import { siteConfig } from '@config/site';
import { asLocale, type Locale } from '@lib/i18n/switchLocalePath';
import { loadReport } from '@lib/loadReport';
import { ogImagePathOf } from '@lib/ogRoute';
import { printPathOf } from '@lib/reportPrint';
import { pageHead } from '@lib/pageHead';
import { clip } from '@lib/seo';
import { bandTitle } from '@lib/reportTitles';
import { filterCounts } from '@lib/reportModel';
import { failureReasonMessage } from '@lib/scanFailure';
import { safeExternalHref } from '@lib/scanInput';
import { scoreColorStyle } from '@lib/scoreStyle';
import { technologyNames } from '@lib/technologyNames';
import { reportView } from '@lib/reportView';
import { useScan } from '@lib/useScan';
import { m } from '@paraglide/messages.js';
import { getLocale } from '@paraglide/runtime.js';

type ReportViewProps = { initial: ScanSnapshot; locale: Locale };

const ReportPageView = (props: ReportViewProps) => {
    const locale = props.locale;
    const { snapshot, live, connectionLost, ended, retry } = useScan(props.initial);
    // The category the checks are narrowed to: chosen among the category scores, shown in the table.
    const [category, setCategory] = useState<Category | undefined>(undefined);
    const failed = snapshot.status === 'failed';
    // The address came from the API: it only becomes a link if it is plain http(s).
    const externalHref = safeExternalHref(snapshot.url);
    // The name as the person typed it; the ASCII form the address really carries is shown too, so a look-alike name cannot pass for another.
    const domain = domainToUnicode(snapshot.domain);
    const technologies = snapshot.technologies ?? [];
    const { rows, customized, blocked, olderModel, breakdown } = reportView(snapshot);
    const review = filterCounts(rows).review;
    const outcome = ended
        ? m.report_follow_ended({}, { locale })
        : failed
          ? `${m.report_failed({}, { locale })} ${failureReasonMessage(snapshot.failureReason, locale)}`
          : blocked !== null
            ? m.report_blocked_verdict({ status: blocked }, { locale })
            : review === 0
              ? m.report_verdict_clear({}, { locale })
              : review === 1
                ? m.report_verdict_one({}, { locale })
                : m.report_verdict_many({ count: review }, { locale });
    // "What if I fixed these": the checks the person ticked, and the HP today's model gives the scan with them passed.
    const [planned, setPlanned] = useState<readonly string[]>([]);
    const togglePlan = useCallback((id: string) => setPlanned((ids) => (ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id])), []);
    const plannable = !live && breakdown !== null && snapshot.score !== null;
    const plannedScore = plannable && planned.length > 0 ? simulateFix(snapshot.checks, planned) : null;
    const scoreLabel = snapshot.score === null ? m.report_score_pending({}, { locale }) : m.home_score_label({ score: snapshot.score }, { locale });

    return (
        <main
            style={scoreColorStyle(snapshot.score)}
            id={'main'}
            className={'score-themed score-glow flex-1 [--score-color:var(--score-good)]'}
        >
            <div className={'mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-12 sm:py-20'}>
                <header className={'flex flex-col items-center gap-6 text-center md:flex-row md:gap-10 md:text-left'}>
                    {blocked === null ? (
                        <ScoreRing
                            score={snapshot.score}
                            label={scoreLabel}
                            transitionName={'score-ring'}
                            busy={live}
                            className={'size-[min(56vw,14rem)] md:size-44 md:shrink-0'}
                        />
                    ) : (
                        <div
                            role={'img'}
                            aria-label={m.report_blocked_label({ status: blocked }, { locale })}
                            className={
                                'grid size-[min(56vw,14rem)] place-content-center justify-items-center gap-1 rounded-full border-[0.875rem] border-dashed border-secondary md:size-44 md:shrink-0'
                            }
                        >
                            <span
                                aria-hidden={'true'}
                                className={'text-title-1 tabular-nums'}
                            >
                                {blocked}
                            </span>
                            <span
                                aria-hidden={'true'}
                                className={'text-callout text-muted-foreground'}
                            >
                                {m.report_blocked_badge({}, { locale })}
                            </span>
                        </div>
                    )}
                    <div className={'flex min-w-0 flex-1 flex-col items-center gap-2 md:items-start'}>
                        <h1 className={'text-title-1 break-all'}>{domain}</h1>
                        {snapshot.score !== null && blocked === null && (
                            <p className={'text-callout font-semibold'}>{m.report_condition({ band: bandTitle(scoreBand(snapshot.score), locale) }, { locale })}</p>
                        )}
                        {domain !== snapshot.domain && <p className={'text-caption break-all text-subtle-foreground'}>{m.report_domain_ascii({ ascii: snapshot.domain }, { locale })}</p>}
                        {customized && <p className={'text-caption text-subtle-foreground'}>{m.report_customized({ count: rows.length, total: CHECKS.length }, { locale })}</p>}
                        {technologies.length > 0 && (
                            <p className={'text-caption text-subtle-foreground'}>{m.report_detected({ names: technologies.map((id) => technologyNames[id]).join(', ') }, { locale })}</p>
                        )}
                        <p className={'max-w-prose text-callout text-muted-foreground'}>
                            {live ? m.report_scanning({ done: snapshot.checks.length, total: snapshot.totalChecks }, { locale }) : outcome}
                        </p>
                        {/* Announced once as the scan starts and once with the outcome, not with every check that lands. */}
                        <p
                            role={'status'}
                            className={'sr-only'}
                        >
                            {live ? m.report_scanning_live({ domain }, { locale }) : outcome}
                        </p>
                        {live ? (
                            <>
                                <ProgressBar
                                    value={snapshot.checks.length}
                                    max={snapshot.totalChecks}
                                    label={m.report_progress_label({}, { locale })}
                                    className={'w-full max-w-prose'}
                                />
                                <ScanBanter locale={locale} />
                            </>
                        ) : (
                            !failed && !ended && <p className={'text-caption text-subtle-foreground'}>{m.report_scan_complete({ total: snapshot.totalChecks }, { locale })}</p>
                        )}
                        {plannable && (
                            <div
                                role={'status'}
                                className={'flex flex-wrap items-center justify-center gap-x-3 md:justify-start'}
                            >
                                <p className={'text-callout tabular-nums text-muted-foreground'}>
                                    {plannedScore === null ? m.report_plan_hint({}, { locale }) : m.report_plan({ count: planned.length, from: snapshot.score ?? 0, to: plannedScore }, { locale })}
                                </p>
                                {plannedScore !== null && (
                                    <button
                                        type={'button'}
                                        onClick={() => setPlanned([])}
                                        className={
                                            'text-caption inline-flex min-h-11 items-center rounded-xs text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'
                                        }
                                    >
                                        {m.report_plan_clear({}, { locale })}
                                    </button>
                                )}
                            </div>
                        )}
                        {/* Always in the page (empty while the connection holds), so a screen reader is already watching it; polite, as the scan goes on in the background and the button only skips the wait. */}
                        <div
                            role={'status'}
                            className={'flex flex-wrap items-center justify-center gap-x-3 gap-y-1 empty:-mt-2 md:justify-start'}
                        >
                            {connectionLost && (
                                <>
                                    <p className={'text-caption text-muted-foreground'}>{m.report_connection_lost({}, { locale })}</p>
                                    <Button
                                        type={'button'}
                                        variant={'secondary'}
                                        size={'sm'}
                                        onClick={retry}
                                    >
                                        {m.report_connection_retry({}, { locale })}
                                    </Button>
                                </>
                            )}
                        </div>
                        <div className={'flex flex-wrap items-center justify-center gap-x-4 md:justify-start'}>
                            {externalHref !== undefined && (
                                <a
                                    href={externalHref}
                                    target={'_blank'}
                                    rel={'noopener noreferrer nofollow'}
                                    className={'text-caption inline-flex min-h-11 items-center text-link underline-offset-4 hover:underline'}
                                >
                                    {m.report_visit_site({ domain }, { locale })}
                                    <span className={'sr-only'}>{` ${m.report_new_tab({}, { locale })}`}</span>
                                </a>
                            )}
                            {/* "A report you can pass on": its own address, without anything a visitor added to it. */}
                            <CopyButton
                                getText={() => `${window.location.origin}/${locale}/r/${snapshot.publicId}`}
                                label={m.report_copy_link({}, { locale })}
                                locale={locale}
                                className={'-ml-3 md:ml-0'}
                            />
                        </div>
                    </div>
                    {/* At the right edge of the header on a wide screen, under the summary on a phone. */}
                    {!live && canScanAgain(snapshot.url) && (
                        <ScanAgain
                            url={snapshot.url}
                            checks={snapshot.selectedChecks}
                            locale={locale}
                            className={'md:self-start'}
                        />
                    )}
                </header>

                {olderModel !== undefined && (
                    <p className={'max-w-prose text-callout text-muted-foreground'}>{m.report_older_model({ version: olderModel, current: SCORE_MODEL_VERSION }, { locale })}</p>
                )}

                {breakdown !== null && (
                    <CategoryScores
                        breakdown={breakdown}
                        locale={locale}
                        selected={category}
                        onSelect={setCategory}
                    />
                )}

                <ReportTable
                    rows={rows}
                    domain={domain}
                    score={snapshot.score}
                    printHref={printPathOf(locale, snapshot.publicId)}
                    category={breakdown === null ? undefined : category}
                    onCategoryChange={setCategory}
                    planned={planned}
                    onTogglePlan={plannable ? togglePlan : undefined}
                    info={{ scannedAt: snapshot.createdAt, scoreModelVersion: snapshot.scoreModelVersion, breakdown, technologies }}
                    locale={locale}
                />

                {/* After the scan only, and only with a score to show: a running, failed or blocked report has no badge worth sharing. */}
                {!live && !failed && !ended && blocked === null && snapshot.score !== null && (
                    <ReportBadge
                        publicId={snapshot.publicId}
                        score={snapshot.score}
                        locale={locale}
                    />
                )}

                {snapshot.responseHeaders !== null && (
                    <RawHeaders
                        headers={snapshot.responseHeaders}
                        locale={locale}
                    />
                )}

                <footer className={'flex justify-center'}>
                    <Link
                        to={'/$locale'}
                        params={{ locale }}
                        className={buttonVariants({ size: 'lg', variant: 'secondary' })}
                    >
                        {m.report_new_scan({}, { locale })}
                    </Link>
                </footer>
            </div>
        </main>
    );
};

// Reached through the route API rather than `Route`, so the component can sit above the route definition.
const routeApi = getRouteApi('/$locale/r/$publicId');

/** An unknown id, or a report past its 30 days: say which, and offer the way back to a fresh scan. */
const ReportNotFound = () => {
    const locale = asLocale(getLocale());
    return (
        <main
            id={'main'}
            className={'grid flex-1 place-items-center px-4 py-16'}
        >
            <div className={'flex max-w-md flex-col items-center gap-6 text-center'}>
                <h1 className={'text-title-1'}>{m.report_not_found_title({}, { locale })}</h1>
                <p className={'text-callout text-muted-foreground'}>{m.report_not_found_body({}, { locale })}</p>
                <Link
                    to={'/$locale'}
                    params={{ locale }}
                    className={buttonVariants({ size: 'lg' })}
                >
                    {m.footer_scan({}, { locale })}
                </Link>
            </div>
        </main>
    );
};

// The explicit return type keeps TypeScript from checking the body while it infers the route's own type (a cycle).
const ReportPage = (): ReactElement => {
    const locale = asLocale(routeApi.useParams().locale);
    const snapshot = routeApi.useLoaderData();
    return (
        <ReportPageView
            // Keyed by id so a different report never inherits the previous one's live state.
            key={snapshot.publicId}
            initial={snapshot}
            locale={locale}
        />
    );
};

export const Route = createFileRoute('/$locale/r/$publicId')({
    head: ({ params, loaderData, match }) => {
        const locale = asLocale(params.locale);
        // The loader failed or the report does not exist: say nothing about a page that is not there, and keep it out of the index.
        if (loaderData === undefined) {
            // A failed load keeps the error title the root gives it; a missing report says so in the tab.
            const title = match.status === 'error' ? [] : [{ title: `${m.report_not_found_title({}, { locale })} | ${siteConfig.title}` }];
            return { meta: [...title, { name: 'robots', content: 'noindex, nofollow' }] };
        }
        const domain = domainToUnicode(loaderData.domain);
        return pageHead({
            locale,
            // "Report for " leaves 46 of the 57 characters a title has before the brand.
            title: m.seo_report_title({ domain: clip(domain, 46) }, { locale }),
            description: m.seo_report_description({ domain }, { locale }),
            path: `/${locale}/r/${params.publicId}`,
            // The share preview with this report's score (`server.ts`).
            ogImage: ogImagePathOf(params.publicId),
            ogImageAlt: m.og_report_alt({ domain, line: loaderData.score === null ? m.og_report_no_score({}, { locale }) : m.og_report_score({ score: loaderData.score }, { locale }) }, { locale }),
            // A report is reachable only by its link: never in search results, never in the sitemap.
            noindex: true,
        });
    },
    // The parameter type is spelled out: inferring it from the route would make the route's type depend on itself.
    loader: ({ params }: { params: { publicId: string } }): Promise<ScanSnapshot> => loadReport(params.publicId),
    component: ReportPage,
    notFoundComponent: ReportNotFound,
});
