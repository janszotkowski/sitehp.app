import { CATEGORY_WEIGHT, CHECKS, CRITICAL_CAP, SCORE_MODEL_VERSION, SEVERITIES, SEVERITY_WEIGHT, type Effort, type Severity } from '@sitehp.app/core/browser';
import { Link, createFileRoute } from '@tanstack/react-router';
import { ScanBanner } from '@components/Banner';
import { InfoSection } from '@components/InfoSection';
import { RuledList } from '@components/RuledList';
import { buttonVariants } from '@components/ui/button';
import { checkText } from '@lib/checkMessages';
import { asLocale, type Locale } from '@lib/i18n/switchLocalePath';
import { methodology, plannedCategories } from '@lib/methodology';
import { pageHead } from '@lib/pageHead';
import { scoreColorStyle } from '@lib/scoreStyle';
import { PAGE_LASTMOD } from '@vite/pages';
import { categoryTitle, groupTitle } from '@lib/reportTitles';
import { m } from '@paraglide/messages.js';

const severityLabel = (severity: Severity, locale: Locale): string => {
    const labels: Record<Severity, string> = {
        critical: m.severity_critical({}, { locale }),
        high: m.severity_high({}, { locale }),
        medium: m.severity_medium({}, { locale }),
        low: m.severity_low({}, { locale }),
    };
    return labels[severity];
};

const effortLabel = (effort: Effort, locale: Locale): string => {
    const labels: Record<Effort, string> = { minutes: m.effort_minutes({}, { locale }), hours: m.effort_hours({}, { locale }), days: m.effort_days({}, { locale }) };
    return labels[effort];
};

const formatPoints = (points: number): string => String(points);

const bodyClass = 'max-w-prose text-callout text-muted-foreground';

const MethodologyPage = () => {
    const locale = asLocale(Route.useParams().locale);
    const categories = methodology();
    const planned = plannedCategories();
    const steps = [
        { title: m.method_step_1_title({}, { locale }), body: m.method_step_1_body({}, { locale }) },
        { title: m.method_step_2_title({}, { locale }), body: m.method_step_2_body({}, { locale }) },
        { title: m.method_step_3_title({}, { locale }), body: m.method_step_3_body({}, { locale }) },
        { title: m.method_step_4_title({}, { locale }), body: m.method_step_4_body({}, { locale }) },
        { title: m.method_step_5_title({ cap: CRITICAL_CAP }, { locale }), body: m.method_step_5_body({ cap: CRITICAL_CAP }, { locale }) },
    ];
    const bands = [
        { label: m.method_band_critical({}, { locale }), from: 0, to: 39 },
        { label: m.method_band_poor({}, { locale }), from: 40, to: 59 },
        { label: m.method_band_fair({}, { locale }), from: 60, to: 79 },
        { label: m.method_band_good({}, { locale }), from: 80, to: 94 },
        { label: m.method_band_excellent({}, { locale }), from: 95, to: 100 },
    ];
    const limits = [
        m.method_limits_blocked({}, { locale }),
        m.method_limits_skipped({}, { locale }),
        m.method_limits_bonus({}, { locale }),
        m.method_limits_gain({}, { locale }),
        m.method_limits_version({}, { locale }),
    ];
    const heaviest = Math.max(...Object.values(CATEGORY_WEIGHT));

    return (
        <main
            id={'main'}
            className={'mx-auto flex w-full max-w-5xl flex-1 flex-col gap-20 px-4 py-16 sm:gap-28 sm:py-24'}
        >
            <header className={'flex flex-col gap-4'}>
                <h1 className={'text-display text-fade'}>{m.method_title({}, { locale })}</h1>
                <p className={'max-w-prose text-callout text-muted-foreground'}>{m.method_lead({ count: CHECKS.length }, { locale })}</p>
                <p className={'text-caption tabular-nums text-subtle-foreground'}>{m.method_version({ version: SCORE_MODEL_VERSION }, { locale })}</p>
            </header>

            <InfoSection
                id={'steps'}
                title={m.method_steps_title({}, { locale })}
            >
                <RuledList
                    ordered
                    items={steps.map((step, index) => ({ key: step.title, id: `step-${index + 1}`, lead: index + 1, title: step.title, body: step.body }))}
                />
            </InfoSection>

            <InfoSection
                id={'severity'}
                title={m.method_severity_title({}, { locale })}
            >
                <div className={'overflow-x-auto'}>
                    <table className={'w-full text-left text-callout'}>
                        <caption className={'sr-only'}>{m.method_severity_caption({}, { locale })}</caption>
                        <thead className={'text-overline uppercase text-subtle-foreground'}>
                            <tr>
                                <th
                                    scope={'col'}
                                    className={'py-2 pr-4 font-normal'}
                                >
                                    {m.method_col_severity({}, { locale })}
                                </th>
                                <th
                                    scope={'col'}
                                    className={'py-2 pr-4 font-normal'}
                                >
                                    {m.method_col_weight({}, { locale })}
                                </th>
                                <th
                                    scope={'col'}
                                    className={'py-2 font-normal'}
                                >
                                    {m.method_col_loses({}, { locale })}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {SEVERITIES.map((severity) => (
                                <tr
                                    key={severity}
                                    className={'border-t'}
                                >
                                    <th
                                        scope={'row'}
                                        className={'py-3 pr-4 font-medium'}
                                    >
                                        {severityLabel(severity, locale)}
                                    </th>
                                    <td className={'py-3 pr-4 tabular-nums'}>{formatPoints(SEVERITY_WEIGHT[severity])}</td>
                                    <td className={'py-3 tabular-nums text-muted-foreground'}>
                                        {formatPoints(SEVERITY_WEIGHT[severity])} / {formatPoints(SEVERITY_WEIGHT[severity] / 2)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </InfoSection>

            <InfoSection
                id={'category-weights'}
                title={m.method_category_weights_title({}, { locale })}
            >
                <p className={bodyClass}>{m.method_category_weights_body({}, { locale })}</p>
                {/* A bar as long as the weight, against the heaviest one: the proportions read at a glance. */}
                <RuledList
                    items={[...categories.map((item) => ({ category: item.category, live: true, share: item.share })), ...planned.map((category) => ({ category, live: false, share: 0 }))].map(
                        (item) => ({
                            key: item.category,
                            id: `weight-${item.category}`,
                            title: categoryTitle(item.category, locale),
                            meta: [
                                item.live ? m.method_category_live({}, { locale }) : m.method_category_planned({}, { locale }),
                                m.method_category_weight({ weight: CATEGORY_WEIGHT[item.category] }, { locale }),
                                ...(item.live ? [m.method_category_share({ share: Math.round(item.share * 1000) / 10 }, { locale })] : []),
                            ].join(' · '),
                            muted: !item.live,
                            body: (
                                <div
                                    aria-hidden={'true'}
                                    className={'h-1.5 w-full self-center overflow-hidden rounded-full bg-secondary'}
                                >
                                    <div
                                        className={`h-full rounded-full ${item.live ? 'bg-foreground' : 'bg-subtle-foreground/40'}`}
                                        style={{ width: `${(100 * CATEGORY_WEIGHT[item.category]) / heaviest}%` }}
                                    />
                                </div>
                            ),
                        }),
                    )}
                />
            </InfoSection>

            <InfoSection
                id={'bands'}
                title={m.method_bands_title({}, { locale })}
            >
                {/* One scale from 0 to 100, each band as wide as its range and in its own color. */}
                <ul className={'flex flex-col gap-3 sm:flex-row sm:gap-1'}>
                    {bands.map((band) => (
                        <li
                            key={band.label}
                            className={'flex flex-col gap-2'}
                            style={{ flexGrow: band.to - band.from + 1, flexBasis: 0 }}
                        >
                            <span
                                aria-hidden={'true'}
                                style={scoreColorStyle((band.from + band.to) / 2)}
                                className={'score-themed h-2 rounded-full bg-hp'}
                            />
                            <span className={'text-headline'}>{band.label}</span>
                            <span className={'text-caption tabular-nums text-subtle-foreground'}>{m.method_band_range({ from: band.from, to: band.to }, { locale })}</span>
                        </li>
                    ))}
                </ul>
            </InfoSection>

            <InfoSection
                id={'limits'}
                title={m.method_limits_title({}, { locale })}
            >
                <ul className={'flex list-disc flex-col gap-2 pl-5'}>
                    {limits.map((text) => (
                        <li
                            key={text}
                            className={bodyClass}
                        >
                            {text}
                        </li>
                    ))}
                </ul>
            </InfoSection>

            <InfoSection
                id={'checks'}
                title={m.method_checks_title({}, { locale })}
            >
                <p className={bodyClass}>{m.method_checks_intro({}, { locale })}</p>
                {categories.map((category) => (
                    <section
                        key={category.category}
                        aria-labelledby={`method-${category.category}`}
                        className={'flex flex-col gap-6 pt-4'}
                    >
                        <div className={'flex flex-wrap items-baseline gap-x-4 gap-y-1'}>
                            <h3
                                id={`method-${category.category}`}
                                className={'text-title-2'}
                            >
                                {categoryTitle(category.category, locale)}
                            </h3>
                            <p className={'text-caption tabular-nums text-subtle-foreground'}>{m.method_checks_count({ count: category.count }, { locale })}</p>
                        </div>
                        {category.groups.map((group) => (
                            <div
                                key={group.group}
                                className={'flex flex-col gap-3'}
                            >
                                <h4
                                    id={`method-${category.category}-${group.group}`}
                                    className={'text-overline uppercase text-subtle-foreground'}
                                >
                                    {groupTitle(group.group, locale)}
                                </h4>
                                <ul className={'flex flex-col'}>
                                    {group.checks.map((check) => {
                                        const text = checkText(check.id, locale);
                                        return (
                                            <li
                                                key={check.id}
                                                className={'flex flex-col gap-1 border-t py-4'}
                                            >
                                                <div className={'flex flex-wrap items-baseline gap-x-3 gap-y-1'}>
                                                    <h5
                                                        id={`check-${check.id}`}
                                                        className={'text-headline'}
                                                    >
                                                        {text.title}
                                                    </h5>
                                                    <p className={'text-caption text-subtle-foreground'}>
                                                        {severityLabel(check.severity, locale)} · {formatPoints(SEVERITY_WEIGHT[check.severity])} ·{' '}
                                                        {m.method_check_effort({ effort: effortLabel(check.effort, locale).toLowerCase() }, { locale })}
                                                    </p>
                                                </div>
                                                <p className={bodyClass}>{text.explanation}</p>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        ))}
                    </section>
                ))}
            </InfoSection>

            <InfoSection
                id={'start'}
                title={m.method_cta_title({}, { locale })}
            >
                <p className={bodyClass}>{m.method_cta_body({}, { locale })}</p>
                <div>
                    <Link
                        to={'/$locale'}
                        params={{ locale }}
                        className={buttonVariants({ variant: 'default' })}
                    >
                        {m.method_cta_button({}, { locale })}
                    </Link>
                </div>
            </InfoSection>
            <ScanBanner locale={locale} />
        </main>
    );
};

export const Route = createFileRoute('/$locale/methodology')({
    head: ({ params }) => {
        const locale = asLocale(params.locale);
        return pageHead({
            locale,
            title: m.seo_methodology_title({}, { locale }),
            description: m.seo_methodology_description({}, { locale }),
            path: `/${locale}/methodology`,
            breadcrumbs: [
                { name: m.footer_product({}, { locale }), path: `/${locale}` },
                { name: m.nav_methodology({}, { locale }), path: `/${locale}/methodology` },
            ],
            page: { type: 'WebPage', dateModified: PAGE_LASTMOD['/methodology'], version: SCORE_MODEL_VERSION },
        });
    },
    component: MethodologyPage,
});
