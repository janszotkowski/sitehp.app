import { StatusPill } from '@components/StatusIcon';
import { checkText } from '@lib/checkMessages';
import type { Locale } from '@lib/i18n/switchLocalePath';
import type { ReportRow } from '@lib/reportModel';
import { m } from '@paraglide/messages.js';

type FixFirstProps = { rows: readonly ReportRow[]; onOpen: (id: string) => void; locale: Locale };

/** The first sentence of an explanation: enough to say what the check is about, short enough for a card. */
const firstSentence = (text: string): string => /^.*?[.!?](?=\s|$)/s.exec(text)?.[0] ?? text;

/** What to do first: the few checks worth the most HP, each a card that opens its detail. Above the table so a report starts with action, not with 53 rows. */
export const FixFirst = (props: FixFirstProps) => {
    const { locale } = props;
    if (props.rows.length === 0) return null;
    return (
        <section
            aria-labelledby={'fix-first-title'}
            className={'flex flex-col gap-3'}
        >
            <div className={'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'}>
                <h2
                    id={'fix-first-title'}
                    className={'text-title-2'}
                >
                    {m.report_fix_first_title({}, { locale })}
                </h2>
                <p className={'text-caption text-subtle-foreground'}>{m.report_fix_first_hint({}, { locale })}</p>
            </div>
            {/* The landing page's ruled columns: type under a hairline, no card around it. */}
            <ul className={'grid gap-x-10 gap-y-2 md:grid-cols-3'}>
                {props.rows.map((row) => {
                    const text = checkText(row.id, locale);
                    return (
                        <li key={row.id}>
                            <button
                                type={'button'}
                                onClick={() => props.onOpen(row.id)}
                                className={
                                    'glow-hover flex h-full w-full flex-col items-start gap-2 border-t px-4 py-5 text-left outline-none transition-colors duration-100 hover:bg-secondary/20 focus-visible:ring-2 focus-visible:ring-ring'
                                }
                            >
                                <span className={'text-score text-[clamp(2rem,4vw,2.75rem)] tabular-nums'}>{m.report_gain({ gain: row.gain }, { locale })}</span>
                                <span className={'flex flex-wrap items-center gap-x-3 gap-y-1'}>
                                    <span className={'text-headline'}>{text.title}</span>
                                    <StatusPill
                                        status={row.status}
                                        locale={locale}
                                    />
                                </span>
                                <span className={'text-callout line-clamp-3 max-w-prose text-muted-foreground'}>{firstSentence(text.explanation)}</span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
};
