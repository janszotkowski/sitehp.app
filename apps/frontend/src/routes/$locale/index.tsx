import { createFileRoute } from '@tanstack/react-router';
import { Faq, FinalCta, Flow, HowItWorks, SampleFinding, Stats, TrustPoints, WhatWeCheck, faqItems } from '@components/HomeSections';
import { ScanForm } from '@components/ScanForm';
import { BetaPill } from '@components/BetaPill';
import { ScoreRing } from '@components/ScoreRing';
import { asLocale } from '@lib/i18n/switchLocalePath';
import { pageHead } from '@lib/pageHead';
import { applicationNode, faqPageNode } from '@lib/seoSchema';
import { m } from '@paraglide/messages.js';

const HomePage = () => {
    const locale = asLocale(Route.useParams().locale);
    const demoScore = 84;

    return (
        <main
            id={'main'}
            className={'flex-1'}
        >
            <div className={'mx-auto flex max-w-5xl flex-col items-center gap-12 px-4 py-16 text-center sm:py-24'}>
                <div className={'flex flex-col items-center gap-6'}>
                    <div className={'rise'}>
                        <BetaPill
                            variant={'hero'}
                            locale={locale}
                        />
                    </div>
                    <h1 className={'text-display text-fade rise max-w-[20ch]'}>{m.home_title({}, { locale })}</h1>
                    <p className={'text-callout rise max-w-prose text-muted-foreground [--i:1]'}>{m.home_tagline({}, { locale })}</p>
                    <p className={'text-caption rise text-subtle-foreground [--i:2]'}>{m.home_trust({}, { locale })}</p>
                </div>
                <div className={'rise flex w-full justify-center [--i:3]'}>
                    <ScanForm />
                </div>
                <figure className={'rise flex flex-col items-center gap-4 [--i:4]'}>
                    <ScoreRing
                        score={demoScore}
                        label={m.home_score_label({ score: demoScore }, { locale })}
                        transitionName={'score-ring'}
                        animateIn
                        className={'size-[min(72vw,18rem)]'}
                    />
                    <figcaption className={'text-caption text-subtle-foreground'}>{m.home_demo_caption({}, { locale })}</figcaption>
                </figure>
            </div>

            <div className={'mx-auto flex max-w-5xl flex-col gap-24 px-4 pt-8 pb-24 sm:gap-32 sm:pb-32'}>
                <Stats locale={locale} />
                <Flow locale={locale} />
                <WhatWeCheck locale={locale} />
                <HowItWorks locale={locale} />
                <SampleFinding locale={locale} />
                <TrustPoints locale={locale} />
                <Faq locale={locale} />
                <FinalCta locale={locale} />
            </div>
        </main>
    );
};

export const Route = createFileRoute('/$locale/')({
    head: ({ params }) => {
        const locale = asLocale(params.locale);
        return pageHead({
            locale,
            title: m.seo_home_title({}, { locale }),
            description: m.seo_home_description({}, { locale }),
            path: `/${locale}`,
            nodes: [applicationNode(locale), faqPageNode(`/${locale}`, faqItems(locale))],
        });
    },
    component: HomePage,
});
