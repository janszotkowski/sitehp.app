import { CRITICAL_CAP, type Category, type ScoreBreakdown } from '@sitehp.app/core/browser';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { checkText } from '@lib/checkMessages';
import { categoryTitle } from '@lib/reportTitles';
import { scoreColorStyle } from '@lib/scoreStyle';
import { cn } from '@lib/utils';
import { m } from '@paraglide/messages.js';

type CategoryScoresProps = {
    breakdown: ScoreBreakdown;
    locale: Locale;
    /** The category the checks below are narrowed to, if any. */
    selected: Category | undefined;
    onSelect: (category: Category | undefined) => void;
};

/** The HP taken apart: one small ring per category that ran, with its share of the HP, and why the HP is lower than they suggest when a critical failure caps it. */
export const CategoryScores = (props: CategoryScoresProps) => {
    const locale = props.locale;
    return (
        <section
            aria-labelledby={'category-scores-title'}
            className={'flex flex-col gap-4'}
        >
            <div className={'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'}>
                <h2
                    id={'category-scores-title'}
                    className={'text-overline text-muted-foreground uppercase'}
                >
                    {m.report_categories_title({}, { locale })}
                </h2>
                <p className={'text-caption text-subtle-foreground'}>{m.report_categories_hint({}, { locale })}</p>
            </div>
            {/* The landing page's strip of figures between hairlines, each one a button that narrows the checks below. */}
            <ul className={'grid grid-cols-2 divide-x divide-y border-y md:grid-cols-4 md:divide-y-0'}>
                {props.breakdown.categories.map((item) => {
                    const title = categoryTitle(item.category, locale);
                    return (
                        <li
                            key={item.category}
                            className={'min-w-0'}
                        >
                            <button
                                type={'button'}
                                aria-pressed={props.selected === item.category}
                                aria-label={m.report_category_score({ category: title, score: item.score }, { locale })}
                                onClick={() => props.onSelect(props.selected === item.category ? undefined : item.category)}
                                className={cn(
                                    'glow-hover flex h-full w-full flex-col gap-1 px-4 py-6 text-left outline-none transition-colors duration-100 hover:bg-secondary/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-6',
                                    props.selected === item.category && 'bg-secondary/60',
                                )}
                            >
                                <span
                                    aria-hidden={'true'}
                                    className={'text-score score-themed text-[clamp(2.5rem,6vw,3.5rem)] text-(--score-color) tabular-nums'}
                                    style={scoreColorStyle(item.score)}
                                >
                                    {item.score}
                                </span>
                                <span className={'text-callout font-semibold'}>{title}</span>
                                <span className={'text-caption text-subtle-foreground'}>
                                    {m.report_category_share({ share: Math.round(item.share * 100), checks: item.checks, total: item.total }, { locale })}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            {props.breakdown.capped && (
                <p className={'max-w-prose text-callout text-muted-foreground'}>
                    {m.report_capped({ cap: CRITICAL_CAP, checks: props.breakdown.cappedBy.map((id) => checkText(id, locale).title).join(', ') }, { locale })}
                </p>
            )}
        </section>
    );
};
