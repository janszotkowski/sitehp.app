import { CATEGORIES, CHECKS } from '@sitehp.app/core/browser';
import { createFileRoute } from '@tanstack/react-router';
import { OperatorDetails } from '@components/OperatorDetails';
import { ScanBanner } from '@components/Banner';
import { InfoSection } from '@components/InfoSection';
import { RuledColumns, RuledList } from '@components/RuledList';
import { OPERATOR } from '@config/operator';
import { asLocale } from '@lib/i18n/switchLocalePath';
import { pageHead } from '@lib/pageHead';
import { m } from '@paraglide/messages.js';

const AboutPage = () => {
    const locale = asLocale(Route.useParams().locale);
    const principles = [
        { title: m.about_how_1_title({}, { locale }), body: m.about_how_1_body({}, { locale }) },
        { title: m.about_how_2_title({}, { locale }), body: m.about_how_2_body({}, { locale }) },
        { title: m.about_how_3_title({}, { locale }), body: m.about_how_3_body({}, { locale }) },
    ];
    const abilities = [
        { title: m.about_can_1_title({}, { locale }), body: m.about_can_1_body({}, { locale }) },
        { title: m.about_can_2_title({}, { locale }), body: m.about_can_2_body({}, { locale }) },
        { title: m.about_can_3_title({}, { locale }), body: m.about_can_3_body({}, { locale }) },
        { title: m.about_can_4_title({}, { locale }), body: m.about_can_4_body({}, { locale }) },
        { title: m.about_can_5_title({}, { locale }), body: m.about_can_5_body({}, { locale }) },
    ];
    // Counted from the registry, like the home page: the page cannot claim a check the engine does not have.
    const liveCategories = CATEGORIES.filter((category) => CHECKS.some((check) => check.category === category)).length;

    return (
        <main
            id={'main'}
            className={'mx-auto flex w-full max-w-5xl flex-1 flex-col gap-20 px-4 py-16 sm:gap-28 sm:py-24'}
        >
            <header className={'flex flex-col gap-4'}>
                <h1 className={'text-display text-fade'}>{m.about_title({}, { locale })}</h1>
                <p className={'max-w-prose text-callout text-muted-foreground'}>{m.about_lead({}, { locale })}</p>
            </header>

            <InfoSection title={m.about_why_title({}, { locale })}>
                <p className={'max-w-prose text-callout text-muted-foreground'}>{m.about_why_body({}, { locale })}</p>
            </InfoSection>

            <InfoSection title={m.about_can_title({}, { locale })}>
                <p className={'max-w-prose text-callout text-muted-foreground'}>{m.about_can_intro({ count: CHECKS.length, categories: liveCategories }, { locale })}</p>
                <RuledList items={abilities.map((ability) => ({ key: ability.title, title: ability.title, body: ability.body }))} />
            </InfoSection>

            <InfoSection title={m.about_how_title({}, { locale })}>
                <RuledColumns items={principles.map((principle) => ({ key: principle.title, title: principle.title, body: principle.body }))} />
            </InfoSection>

            <InfoSection title={m.about_not_title({}, { locale })}>
                <p className={'max-w-prose text-callout text-muted-foreground'}>{m.about_not_body({}, { locale })}</p>
            </InfoSection>

            <InfoSection title={m.about_operator_title({}, { locale })}>
                <p className={'max-w-prose text-callout text-muted-foreground'}>{m.about_operator_body({ name: OPERATOR.name }, { locale })}</p>
                <OperatorDetails locale={locale} />
            </InfoSection>
            <ScanBanner locale={locale} />
        </main>
    );
};

export const Route = createFileRoute('/$locale/about')({
    head: ({ params }) => {
        const locale = asLocale(params.locale);
        return pageHead({
            locale,
            title: m.seo_about_title({}, { locale }),
            description: m.seo_about_description({}, { locale }),
            path: `/${locale}/about`,
            breadcrumbs: [
                { name: m.footer_product({}, { locale }), path: `/${locale}` },
                { name: m.nav_about({}, { locale }), path: `/${locale}/about` },
            ],
            page: { type: 'WebPage' },
        });
    },
    component: AboutPage,
});
