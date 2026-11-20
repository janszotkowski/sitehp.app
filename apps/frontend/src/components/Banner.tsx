import { Bot, Gauge, Search, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { buttonVariants } from '@components/ui/button';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { m } from '@paraglide/messages.js';
import { cn } from '@lib/utils';

type BannerProps = {
    id: string;
    kicker?: string;
    title: string;
    body?: string;
    children?: ReactNode;
    className?: string;
};

// Tilted tiles at the corners, hidden on a phone where they would crowd the text.
const TILES: readonly { icon: LucideIcon; position: string }[] = [
    { icon: ShieldCheck, position: 'top-10 left-[5%] -rotate-12' },
    { icon: Search, position: 'bottom-28 left-[10%] rotate-6' },
    { icon: Bot, position: 'top-12 right-[6%] rotate-12' },
    { icon: Gauge, position: 'bottom-24 right-[12%] -rotate-6' },
];

/** The closing panel of a page: a green field with floating tiles, a heading, a line and the actions (children). */
export const Banner = (props: BannerProps) => (
    <section
        aria-labelledby={props.id}
        className={cn('banner reveal flex w-full flex-col items-center gap-5 rounded-xl px-6 py-20 text-center sm:py-28', props.className)}
    >
        {TILES.map(({ icon: Icon, position }) => (
            <span
                key={position}
                aria-hidden={'true'}
                className={cn('banner-tile hidden md:grid', position)}
            >
                <Icon className={'size-6'} />
            </span>
        ))}
        {props.kicker !== undefined && <p className={'text-overline uppercase text-white/70'}>{props.kicker}</p>}
        <h2
            id={props.id}
            className={'text-title-1 sm:text-display max-w-[22ch]'}
        >
            {props.title}
        </h2>
        {props.body !== undefined && <p className={'max-w-prose text-callout text-white/85'}>{props.body}</p>}
        <div className={'flex flex-wrap items-center justify-center gap-x-6 gap-y-3 pt-3'}>{props.children}</div>
    </section>
);

/** A button for use on the banner: white, so it stands out on the green. */
export const bannerButton = 'bg-white! text-neutral-950! hover:bg-white/85!';

type ScanBannerProps = { locale: Locale };

/** The closing banner of the information pages: the way back to the scan field on the landing page. */
export const ScanBanner = (props: ScanBannerProps) => (
    <Banner
        id={'scan-banner'}
        title={m.home_final_title({}, { locale: props.locale })}
    >
        <Link
            to={'/$locale'}
            params={{ locale: props.locale }}
            className={buttonVariants({ size: 'lg', className: bannerButton })}
        >
            {m.home_final_cta({}, { locale: props.locale })}
        </Link>
    </Banner>
);
