import { CATEGORIES, CHECKS, type Category } from '@sitehp.app/core/browser';
import { Bot, ChevronDown, EyeOff, FileDown, Gauge, ListOrdered, Mail, MessageSquareText, Search, ShieldCheck, Zap, type LucideIcon } from 'lucide-react';
import { useRef, type MouseEvent, type ReactNode } from 'react';
import { StatusPill } from '@components/StatusIcon';
import { RuledColumns, RuledList } from '@components/RuledList';
import { Button } from '@components/ui/button';
import { OPERATOR } from '@config/operator';
import { checkText } from '@lib/checkMessages';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { categoryTitle } from '@lib/reportTitles';
import type { FaqItem } from '@lib/seoSchema';
import { focusScanField } from '@lib/scanShortcut';
import { m } from '@paraglide/messages.js';

type LocaleProps = { locale: Locale };

type SectionProps = { title: string; intro?: string; children: ReactNode; id?: string };

/** A band of the landing page: a heading, an optional one-line intro and the content, at the same width and rhythm as the others. */
const Section = (props: SectionProps) => (
    <section
        aria-labelledby={props.id}
        className={'reveal flex w-full flex-col gap-8'}
    >
        <div className={'flex flex-col gap-3'}>
            <h2
                id={props.id}
                className={'text-title-1'}
            >
                {props.title}
            </h2>
            {props.intro !== undefined && <p className={'max-w-prose text-callout text-muted-foreground'}>{props.intro}</p>}
        </div>
        {props.children}
    </section>
);

// A card is kept for the one place that imitates the product (the sample finding); elsewhere the page is type and hairlines.
const card = 'glow-hover flex flex-col gap-3 rounded-lg border bg-card p-6 text-left';

const countIn = (category: Category): number => CHECKS.filter((check) => check.category === category).length;

/** What is checked. The counts come from the registry, so the page can never claim a number the engine does not have. */
export const WhatWeCheck = (props: LocaleProps) => {
    const { locale } = props;
    const bodies: Partial<Record<Category, string>> = {
        security: m.home_check_security_body({}, { locale }),
        seo: m.home_check_seo_body({}, { locale }),
        speed: m.home_check_speed_body({}, { locale }),
        agent: m.home_check_agent_body({}, { locale }),
    };
    const shown = CATEGORIES.filter((category) => bodies[category] !== undefined && countIn(category) > 0);

    return (
        <Section
            id={'home-check'}
            title={m.home_check_title({}, { locale })}
            intro={m.home_check_intro({ count: CHECKS.length, categories: shown.length }, { locale })}
        >
            <RuledList
                items={[
                    ...shown.map((category) => ({
                        key: category,
                        title: categoryTitle(category, locale),
                        meta: m.home_check_count({ count: countIn(category) }, { locale }),
                        body: bodies[category] ?? '',
                    })),
                    { key: 'next', title: m.home_check_next_title({}, { locale }), meta: m.home_check_next_badge({}, { locale }), body: m.home_check_next_body({}, { locale }), muted: true },
                ]}
            />
        </Section>
    );
};

export const HowItWorks = (props: LocaleProps) => {
    const { locale } = props;
    const steps = [
        { title: m.home_how_1_title({}, { locale }), body: m.home_how_1_body({}, { locale }) },
        { title: m.home_how_2_title({}, { locale }), body: m.home_how_2_body({}, { locale }) },
        { title: m.home_how_3_title({}, { locale }), body: m.home_how_3_body({}, { locale }) },
    ];

    return (
        <Section
            id={'home-how'}
            title={m.home_how_title({}, { locale })}
        >
            <RuledColumns
                ordered
                items={steps.map((step, index) => ({ key: step.title, lead: index + 1, title: step.title, body: step.body }))}
            />
        </Section>
    );
};

/** One real finding, as the report shows it, so a visitor sees the plain-language depth before scanning. The text is the check's own. */
export const SampleFinding = (props: LocaleProps) => {
    const { locale } = props;
    const text = checkText('csp', locale);

    return (
        <Section
            id={'home-sample'}
            title={m.home_sample_title({}, { locale })}
            intro={m.home_sample_body({}, { locale })}
        >
            <figure className={'flex flex-col gap-3'}>
                <div className={`${card} max-w-2xl`}>
                    <div className={'flex flex-wrap items-center gap-x-3 gap-y-2'}>
                        <h3 className={'text-title-2 min-w-0 flex-1'}>{text.title}</h3>
                        <StatusPill
                            status={'fail'}
                            locale={locale}
                        />
                    </div>
                    <p className={'text-callout text-muted-foreground'}>{text.explanation}</p>
                    <p className={'text-callout font-medium tabular-nums'}>{m.report_detail_gain({ gain: 2.7 }, { locale })}</p>
                </div>
                <figcaption className={'text-caption text-subtle-foreground'}>{m.home_sample_label({}, { locale })}</figcaption>
            </figure>
        </Section>
    );
};

export const TrustPoints = (props: LocaleProps) => {
    const { locale } = props;
    const points = [
        { title: m.home_trust_1_title({}, { locale }), body: m.home_trust_1_body({}, { locale }) },
        { title: m.home_trust_2_title({}, { locale }), body: m.home_trust_2_body({}, { locale }) },
        { title: m.home_trust_3_title({}, { locale }), body: m.home_trust_3_body({}, { locale }) },
        { title: m.home_trust_4_title({}, { locale }), body: m.home_trust_4_body({}, { locale }) },
    ];

    return (
        <Section
            id={'home-trust'}
            title={m.home_trust_title({}, { locale })}
        >
            <RuledColumns
                columns={2}
                items={points.map((point) => ({ key: point.title, title: point.title, body: point.body }))}
            />
        </Section>
    );
};

/** The home page questions, shared by the visible list and its `FAQPage` markup so the two cannot drift apart. */
export const faqItems = (locale: Locale): FaqItem[] => [
    { q: m.home_faq_1_q({}, { locale }), a: m.home_faq_1_a({}, { locale }) },
    { q: m.home_faq_2_q({}, { locale }), a: m.home_faq_2_a({}, { locale }) },
    { q: m.home_faq_3_q({}, { locale }), a: m.home_faq_3_a({}, { locale }) },
    { q: m.home_faq_4_q({}, { locale }), a: m.home_faq_4_a({}, { locale }) },
    { q: m.home_faq_5_q({}, { locale }), a: m.home_faq_5_a({}, { locale }) },
    { q: m.home_faq_6_q({}, { locale }), a: m.home_faq_6_a({ name: OPERATOR.name }, { locale }) },
];

const FAQ_MS = 300;

type FaqItemProps = { item: FaqItem };

/**
 * A native disclosure whose height eases open and shut. Without scripts it is a plain `<details>`; with them the click is
 * taken over so closing can animate too (the browser drops the content the moment `open` goes away). Reduced motion snaps.
 */
const FaqRow = (props: FaqItemProps) => {
    const details = useRef<HTMLDetailsElement>(null);
    const body = useRef<HTMLDivElement>(null);
    const running = useRef<Animation | null>(null);

    const toggle = (event: MouseEvent<HTMLElement>) => {
        const element = details.current;
        const panel = body.current;
        if (element === null || panel === null || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        event.preventDefault();
        running.current?.cancel();
        const opening = !element.open;
        if (opening) element.open = true;
        const full = `${panel.scrollHeight}px`;
        const from = opening ? '0px' : `${panel.getBoundingClientRect().height}px`;
        const to = opening ? full : '0px';
        const animation = panel.animate(
            [
                { height: from, opacity: opening ? 0 : 1 },
                { height: to, opacity: opening ? 1 : 0 },
            ],
            { duration: FAQ_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        );
        running.current = animation;
        animation.onfinish = () => {
            if (!opening) element.open = false;
            running.current = null;
        };
        animation.oncancel = () => {
            running.current = null;
        };
    };

    return (
        <details
            ref={details}
            className={'group border-b transition-colors duration-200 last:border-b-0 hover:bg-muted/40 open:bg-muted/40'}
        >
            <summary
                onClick={toggle}
                className={
                    'text-headline flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-5 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden'
                }
            >
                {props.item.q}
                <ChevronDown
                    aria-hidden={'true'}
                    className={'size-4 shrink-0 text-subtle-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none'}
                />
            </summary>
            <div
                ref={body}
                className={'overflow-hidden'}
            >
                <p className={'px-5 pb-5 text-callout text-muted-foreground'}>{props.item.a}</p>
            </div>
        </details>
    );
};

export const Faq = (props: LocaleProps) => {
    const { locale } = props;
    const items = faqItems(locale);

    return (
        <Section
            id={'home-faq'}
            title={m.home_faq_title({}, { locale })}
        >
            <div className={'flex w-full flex-col overflow-hidden rounded-lg border bg-card text-left'}>
                {items.map((item) => (
                    <FaqRow
                        key={item.q}
                        item={item}
                    />
                ))}
            </div>
        </Section>
    );
};

const FLOW_OUT = [
    { icon: Gauge, label: (locale: Locale) => m.home_flow_out_score({}, { locale }) },
    { icon: ListOrdered, label: (locale: Locale) => m.home_flow_out_fixes({}, { locale }) },
    { icon: MessageSquareText, label: (locale: Locale) => m.home_flow_out_plain({}, { locale }) },
    { icon: FileDown, label: (locale: Locale) => m.home_flow_out_export({}, { locale }) },
] as const;

const CATEGORY_ICON: Record<Category, LucideIcon> = {
    security: ShieldCheck,
    speed: Zap,
    seo: Search,
    privacy: EyeOff,
    agent: Bot,
    email: Mail,
};

const rail = 'grid grid-cols-2 gap-px border bg-border';
const tile = 'glow-hover flex flex-col items-center justify-center gap-3 bg-card px-3 py-6 text-center text-caption text-foreground';
const wire = 'flow-wire hidden h-px w-12 bg-border md:block lg:w-24';

/** What goes in and what comes out, with the product between: the page's one diagram. The categories are the registry's own. */
export const Flow = (props: LocaleProps) => {
    const { locale } = props;
    const shown = CATEGORIES.filter((category) => countIn(category) > 0);

    return (
        <Section
            id={'home-flow'}
            title={m.home_flow_title({}, { locale })}
        >
            <div className={'grid items-center gap-8 md:grid-cols-[1fr_auto_1fr] md:gap-0'}>
                <div className={'flex flex-col gap-3'}>
                    <p className={'text-overline uppercase text-subtle-foreground'}>{m.home_flow_in({}, { locale })}</p>
                    <ul className={rail}>
                        {shown.map((category) => {
                            const Icon = CATEGORY_ICON[category];
                            return (
                                <li
                                    key={category}
                                    className={tile}
                                >
                                    <Icon
                                        aria-hidden={'true'}
                                        className={'size-6 text-subtle-foreground'}
                                    />
                                    {categoryTitle(category, locale)}
                                </li>
                            );
                        })}
                    </ul>
                </div>
                <div className={'flex items-center justify-center py-6 md:px-0 md:py-0'}>
                    <span
                        aria-hidden={'true'}
                        className={wire}
                    />
                    <div
                        role={'img'}
                        aria-label={m.home_flow_hub({}, { locale })}
                        className={'flow-hub grid size-28 rotate-45 place-items-center rounded-3xl'}
                    >
                        <svg
                            aria-hidden={'true'}
                            viewBox={'0 0 24 24'}
                            fill={'none'}
                            strokeWidth={1.75}
                            strokeLinecap={'round'}
                            strokeLinejoin={'round'}
                            className={'size-12 -rotate-45 stroke-hp'}
                        >
                            <path
                                d={'M2 12h4l3-8 5 16 3-8h5'}
                                pathLength={1}
                                className={'opacity-25'}
                            />
                            <path
                                d={'M2 12h4l3-8 5 16 3-8h5'}
                                pathLength={1}
                                className={'flow-trace'}
                            />
                        </svg>
                    </div>
                    <span
                        aria-hidden={'true'}
                        className={wire}
                    />
                </div>
                <div className={'flex flex-col gap-3'}>
                    <p className={'text-overline uppercase text-subtle-foreground'}>{m.home_flow_out({}, { locale })}</p>
                    <ul className={rail}>
                        {FLOW_OUT.map(({ icon: Icon, label }) => (
                            <li
                                key={label(locale)}
                                className={tile}
                            >
                                <Icon
                                    aria-hidden={'true'}
                                    className={'size-6 text-hp'}
                                />
                                {label(locale)}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </Section>
    );
};

/** Three big figures under hairlines. The counts come from the registry, like the rest of the page. */
export const Stats = (props: LocaleProps) => {
    const { locale } = props;
    const categories = CATEGORIES.filter((category) => countIn(category) > 0).length;
    const stats = [
        { value: String(CHECKS.length), label: m.home_stat_checks({}, { locale }) },
        { value: String(categories), label: m.home_stat_categories({}, { locale }) },
        { value: '0', label: m.home_stat_signup({}, { locale }) },
    ];

    return (
        <dl className={'reveal grid w-full grid-cols-1 divide-y border-y sm:grid-cols-3 sm:divide-x sm:divide-y-0'}>
            {stats.map((stat) => (
                <div
                    key={stat.label}
                    className={'flex flex-col gap-1 px-2 py-8 text-left sm:px-8'}
                >
                    <dd className={'text-score text-fade text-[clamp(3rem,8vw,4.5rem)] tabular-nums'}>{stat.value}</dd>
                    <dt className={'text-callout text-muted-foreground'}>{stat.label}</dt>
                </div>
            ))}
        </dl>
    );
};

/** The last thing on the page: the field is a scroll away at the top, so this brings the cursor back to it. */
export const FinalCta = (props: LocaleProps) => (
    <section
        aria-labelledby={'home-final'}
        className={'reveal flex w-full flex-col items-center gap-6 py-8 text-center'}
    >
        <h2
            id={'home-final'}
            className={'text-title-1'}
        >
            {m.home_final_title({}, { locale: props.locale })}
        </h2>
        <Button
            size={'lg'}
            onClick={() => {
                window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
                focusScanField();
            }}
        >
            {m.home_final_cta({}, { locale: props.locale })}
        </Button>
    </section>
);
