import { SEVERITY_WEIGHT, type Technology } from '@sitehp.app/core/browser';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { CopyButton } from '@components/CopyButton';
import { FixGuide } from '@components/FixGuide';
import { Disclosure } from '@components/Disclosure';
import { StatusPill } from '@components/StatusIcon';
import { checkDocs } from '@lib/checkDocs';
import { checkText } from '@lib/checkMessages';
import { evidenceLabel, evidenceValue } from '@lib/evidenceFormat';
import { findingSummary } from '@lib/findingSummary';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { effortLabel, evidenceEntries, severityLabel, skippedReasonLabel, type ReportRow } from '@lib/reportModel';
import { categoryTitle, groupTitle } from '@lib/reportTitles';
import { m } from '@paraglide/messages.js';

type FindingDetailProps = {
    row: ReportRow;
    locale: Locale;
    /** What the scan recognised on the site, to open the guide for its platform. */
    technologies: readonly Technology[];
    /** The scanned site, named in the text copied for an AI agent. */
    domain: string;
    /** Hides the title (the sheet and the drawer already show it). */
    hideTitle?: boolean;
};

type SectionTitleProps = { children: string };

const SectionTitle = (props: SectionTitleProps) => <h3 className={'text-overline uppercase text-subtle-foreground'}>{props.children}</h3>;

type FactProps = { label: string; value: string };

/** One of the three numbers a person reads first: what fixing it is worth, how serious it is, how long it takes. */
const Fact = (props: FactProps) => (
    <div className={'flex min-w-0 flex-col gap-1 px-3 py-4 first:pl-0'}>
        <dt className={'text-overline uppercase text-subtle-foreground'}>{props.label}</dt>
        <dd className={'text-title-2 tabular-nums'}>{props.value}</dd>
    </div>
);

/**
 * Everything the report knows about one check, in the order a person wants it: first how much it matters (HP gain, severity, time to fix),
 * then what the check is, what was found (or why it could not be checked), where to read more, and last, folded, the facts only a developer
 * wants (id, area, weight, points lost). Used by the modal and the phone sheet, so they never drift apart.
 */
export const FindingDetail = (props: FindingDetailProps) => {
    const { row, locale } = props;
    const text = checkText(row.id, locale);
    const entries = evidenceEntries(row.result);
    const links = checkDocs[row.id] ?? [];
    const found = findingSummary(row.id, row.result, locale);
    const [technical, setTechnical] = useState(false);
    const skipped = row.status === 'skipped';

    return (
        // One column on a phone (what is wrong, then how to fix it); from `lg`, in the modal, the problem on the left and the fix on the right.
        <div className={'grid gap-6 lg:grid-cols-2 lg:gap-12'}>
            <div className={'flex min-w-0 flex-col gap-6'}>
                {props.hideTitle !== true && (
                    <div className={'flex flex-wrap items-center gap-x-3 gap-y-2'}>
                        <h2 className={'text-title-2 min-w-0 flex-1'}>{text.title}</h2>
                        <StatusPill
                            status={row.status}
                            locale={locale}
                        />
                    </div>
                )}

                <dl className={'grid grid-cols-3 divide-x border-y'}>
                    <Fact
                        label={m.report_detail_gain_label({}, { locale })}
                        value={row.gain > 0 ? `+${row.gain}` : '—'}
                    />
                    <Fact
                        label={m.report_detail_severity({}, { locale })}
                        value={severityLabel(row.definition.severity, locale)}
                    />
                    <Fact
                        label={m.report_detail_effort({}, { locale })}
                        value={effortLabel(row.definition.effort, locale)}
                    />
                </dl>

                {found !== null && (
                    <section className={'flex flex-col gap-2'}>
                        <SectionTitle>{m.report_detail_found({}, { locale })}</SectionTitle>
                        <p className={'text-callout max-w-prose font-medium'}>{found}</p>
                    </section>
                )}

                <section className={'flex flex-col gap-2'}>
                    <SectionTitle>{m.report_detail_what({}, { locale })}</SectionTitle>
                    <p className={'text-callout max-w-prose text-muted-foreground'}>{text.explanation}</p>
                </section>

                {skipped ? (
                    <section className={'flex flex-col gap-2 border-y bg-muted/50 px-4 py-4'}>
                        <SectionTitle>{m.report_detail_why_skipped({}, { locale })}</SectionTitle>
                        <p className={'text-callout'}>{skippedReasonLabel(row.result, locale)}</p>
                    </section>
                ) : (
                    <section
                        aria-label={m.report_detail_measured({}, { locale })}
                        className={'flex flex-col gap-2'}
                    >
                        <div className={'flex items-center justify-between'}>
                            <SectionTitle>{m.report_detail_measured({}, { locale })}</SectionTitle>
                            {entries.length > 0 && (
                                <CopyButton
                                    getText={() => entries.map(([name, value]) => `${name}: ${value}`).join('\n')}
                                    locale={locale}
                                    className={'-mr-3'}
                                />
                            )}
                        </div>
                        {entries.length === 0 ? (
                            <p className={'text-callout text-muted-foreground'}>{m.report_detail_not_measured({}, { locale })}</p>
                        ) : (
                            <dl className={'flex flex-col divide-y border-y'}>
                                {entries.map(([name, value]) => {
                                    const shown = evidenceValue(name, value, locale);
                                    return (
                                        <div
                                            key={name}
                                            className={'flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4'}
                                        >
                                            <dt className={'text-caption text-muted-foreground'}>{evidenceLabel(name)}</dt>
                                            <dd
                                                title={shown.exact}
                                                className={'text-callout min-w-0 font-medium tabular-nums break-words sm:text-right'}
                                            >
                                                {shown.text}
                                            </dd>
                                        </div>
                                    );
                                })}
                            </dl>
                        )}
                    </section>
                )}
            </div>

            <div className={'flex min-w-0 flex-col gap-6'}>
                {(row.status === 'fail' || row.status === 'warn') && (
                    <FixGuide
                        key={row.id}
                        row={row}
                        domain={props.domain}
                        technologies={props.technologies}
                        locale={locale}
                    />
                )}

                {links.length > 0 && (
                    <section className={'flex flex-col gap-2'}>
                        <SectionTitle>{m.report_detail_learn_more({}, { locale })}</SectionTitle>
                        <ul className={'flex flex-col'}>
                            {links.map((link) => (
                                <li key={link.url}>
                                    <a
                                        href={link.url}
                                        target={'_blank'}
                                        rel={'noopener noreferrer'}
                                        className={'text-callout inline-flex min-h-11 items-center gap-2 text-link underline-offset-4 hover:underline'}
                                    >
                                        <span>
                                            {link.title}
                                            <span className={'text-subtle-foreground'}>{` · ${link.source}`}</span>
                                        </span>
                                        <ExternalLink
                                            aria-hidden={'true'}
                                            className={'size-3.5 shrink-0'}
                                        />
                                        <span className={'sr-only'}>{m.report_new_tab({}, { locale })}</span>
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <div className={'border-t'}>
                    <Disclosure
                        open={technical}
                        onToggle={() => setTechnical(!technical)}
                        headerClassName={'py-3'}
                        header={<span className={'text-caption min-w-0 flex-1 font-medium'}>{m.report_detail_technical({}, { locale })}</span>}
                    >
                        <dl className={'text-caption grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 pb-3'}>
                            <dt className={'text-subtle-foreground'}>{m.report_detail_id({}, { locale })}</dt>
                            <dd className={'font-mono break-all'}>{row.id}</dd>
                            <dt className={'text-subtle-foreground'}>{m.report_detail_area({}, { locale })}</dt>
                            <dd>
                                {categoryTitle(row.definition.category, locale)} / {groupTitle(row.definition.group, locale)}
                            </dd>
                            <dt className={'text-subtle-foreground'}>{m.report_detail_weight({}, { locale })}</dt>
                            <dd className={'tabular-nums'}>{SEVERITY_WEIGHT[row.definition.severity]}</dd>
                            {row.result !== undefined && row.result.status !== 'skipped' && (
                                <>
                                    <dt className={'text-subtle-foreground'}>{m.report_detail_lost({}, { locale })}</dt>
                                    <dd className={'tabular-nums'}>{row.result.pointsLost}</dd>
                                </>
                            )}
                        </dl>
                    </Disclosure>
                </div>
            </div>
        </div>
    );
};
