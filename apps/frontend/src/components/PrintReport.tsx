import { Printer } from 'lucide-react';
import { SCORE_MODEL_VERSION, domainToUnicode, scoreBand, type ScanSnapshot } from '@sitehp.app/core/browser';
import { Link } from '@tanstack/react-router';
import { Button, buttonVariants } from '@components/ui/button';
import { checkText } from '@lib/checkMessages';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { effortLabel, gainText, severityLabel, skippedReasonLabel, type ReportRow } from '@lib/reportModel';
import { bandTitle, categoryTitle, groupTitle } from '@lib/reportTitles';
import { utcStamp } from '@lib/reportPrint';
import { reportView } from '@lib/reportView';
import { statusLabel } from '@lib/statusLabel';
import { m } from '@paraglide/messages.js';

type PrintReportProps = { snapshot: ScanSnapshot; locale: Locale };

/**
 * The report on paper. It is always light and plain whatever the app's theme (a PDF is read on white), carries no navigation when printed,
 * and says every status in words. Findings are not split across pages. Text from the scanned site (evidence) is left out: a PDF carries our own words only.
 */
export const PrintReport = (props: PrintReportProps) => {
    const { snapshot, locale } = props;
    const domain = domainToUnicode(snapshot.domain);
    const { sections, breakdown } = reportView(snapshot);
    const { todo, passed, unmeasured } = sections;
    const band = snapshot.score === null ? m.report_print_no_score({}, { locale }) : m.report_print_out_of({ band: bandTitle(scoreBand(snapshot.score), locale) }, { locale });

    const finding = (row: ReportRow) => {
        const text = checkText(row.id, locale);
        return (
            <li
                key={row.id}
                className={'grid break-inside-avoid grid-cols-[minmax(0,1fr)_auto] gap-x-6 border-t border-neutral-200 py-3 first:border-t-0'}
            >
                <div className={'flex flex-col gap-0.5'}>
                    <h3 className={'text-callout font-semibold'}>{text.title}</h3>
                    <p className={'text-caption text-neutral-500'}>
                        {m.report_print_finding_meta(
                            {
                                area: groupTitle(row.definition.group, locale),
                                severity: severityLabel(row.definition.severity, locale),
                                effort: effortLabel(row.definition.effort, locale),
                            },
                            { locale },
                        )}
                    </p>
                    <p className={'text-caption mt-1 text-neutral-700'}>{text.explanation}</p>
                </div>
                <div className={'flex flex-col items-end gap-0.5 text-right'}>
                    <span className={'text-headline font-semibold tabular-nums'}>{gainText(row.gain, locale)}</span>
                    <span className={'text-caption text-neutral-500'}>{statusLabel(row.status, locale)}</span>
                </div>
            </li>
        );
    };

    const heading = (title: string, count: number) => (
        <h2 className={'text-caption flex items-baseline justify-between border-b border-neutral-900 pb-2 font-semibold tracking-wider uppercase break-after-avoid'}>
            <span>{title}</span>
            <span className={'tabular-nums text-neutral-500'}>{count}</span>
        </h2>
    );

    return (
        <main
            id={'main'}
            className={'flex-1 px-4 py-8 print:p-0'}
        >
            <div className={'mx-auto flex w-full max-w-3xl flex-col gap-10 rounded-lg bg-white p-6 text-neutral-900 sm:p-10 print:max-w-none print:rounded-none print:print-page'}>
                <div className={'flex flex-wrap items-center gap-3 print:hidden'}>
                    <Button
                        type={'button'}
                        onClick={() => window.print()}
                    >
                        <Printer aria-hidden={'true'} />
                        {m.report_print_save({}, { locale })}
                    </Button>
                    <Link
                        to={'/$locale/r/$publicId'}
                        params={{ locale, publicId: snapshot.publicId }}
                        className={buttonVariants({ variant: 'secondary' })}
                    >
                        {m.report_print_back({}, { locale })}
                    </Link>
                    <p className={'text-caption max-w-prose text-neutral-600'}>{m.report_print_hint({}, { locale })}</p>
                </div>

                <header className={'flex flex-col gap-6 border-b border-neutral-900 pb-8'}>
                    <div className={'flex flex-col gap-1'}>
                        <p className={'text-caption font-semibold tracking-wider text-neutral-500 uppercase'}>{m.report_print_eyebrow({}, { locale })}</p>
                        <h1 className={'text-title-1 break-all'}>{domain}</h1>
                    </div>
                    <div className={'flex items-end gap-6'}>
                        <p className={'text-[4.5rem] leading-none font-semibold tracking-tight tabular-nums'}>{snapshot.score ?? '—'}</p>
                        <div className={'flex flex-col gap-1 pb-1'}>
                            <p className={'text-headline font-semibold'}>{band}</p>
                            <p className={'text-caption text-neutral-600'}>{m.report_print_counts({ attention: todo.length, passed: passed.length, unmeasured: unmeasured.length }, { locale })}</p>
                            <p className={'text-caption text-neutral-500'}>
                                {m.report_print_scanned({ time: utcStamp(snapshot.createdAt), version: snapshot.scoreModelVersion ?? SCORE_MODEL_VERSION }, { locale })}
                            </p>
                        </div>
                    </div>
                </header>

                {breakdown !== null && (
                    <section className={'flex break-inside-avoid flex-col gap-3'}>
                        <h2 className={'text-caption border-b border-neutral-900 pb-2 font-semibold tracking-wider uppercase'}>{m.report_categories_title({}, { locale })}</h2>
                        <ul className={'grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 print:grid-cols-4'}>
                            {breakdown.categories.map((item) => (
                                <li
                                    key={item.category}
                                    className={'flex flex-col gap-0.5'}
                                >
                                    <span className={'text-title-1 tabular-nums'}>{item.score}</span>
                                    <span className={'text-callout font-semibold'}>{categoryTitle(item.category, locale)}</span>
                                    <span className={'text-caption text-neutral-500'}>
                                        {m.report_category_share({ share: Math.round(item.share * 100), checks: item.checks, total: item.total }, { locale })}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <section className={'flex flex-col gap-1'}>
                    {heading(m.report_print_attention({}, { locale }), todo.length)}
                    {todo.length > 0 ? <ul>{todo.map(finding)}</ul> : <p className={'text-callout py-3'}>{m.report_print_none({}, { locale })}</p>}
                </section>

                <section className={'flex flex-col gap-3'}>
                    {heading(m.report_print_passed({}, { locale }), passed.length)}
                    {passed.length > 0 ? (
                        <ul className={'text-caption columns-2 gap-6 text-neutral-700 sm:columns-3 print:columns-3'}>
                            {passed.map((row) => (
                                <li
                                    key={row.id}
                                    className={'break-inside-avoid py-0.5'}
                                >
                                    {checkText(row.id, locale).title}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className={'text-callout'}>{m.report_print_none({}, { locale })}</p>
                    )}
                </section>

                {unmeasured.length > 0 && (
                    <section className={'flex flex-col gap-3'}>
                        {heading(m.report_print_unmeasured({}, { locale }), unmeasured.length)}
                        <ul className={'text-caption flex flex-col gap-1 text-neutral-700'}>
                            {unmeasured.map((row) => (
                                <li
                                    key={row.id}
                                    className={'break-inside-avoid'}
                                >
                                    {checkText(row.id, locale).title}
                                    {row.result !== undefined && <span className={'text-neutral-500'}>{`: ${skippedReasonLabel(row.result, locale)}`}</span>}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <footer className={'text-caption border-t border-neutral-300 pt-3 text-neutral-500'}>{m.report_print_footer({}, { locale })}</footer>
            </div>
        </main>
    );
};
