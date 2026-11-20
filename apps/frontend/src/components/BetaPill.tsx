import { SHOW_BETA } from '@config/site';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { m } from '@paraglide/messages.js';

type BetaPillProps = {
    /** `hero` is big, above the landing page's title; `header` sits by the logo from `sm` up; `floating` hangs in the corner of a phone, where the header has no room. */
    variant: 'hero' | 'header' | 'floating';
    locale: Locale;
};

/** The word Beta as a neon-green outlined pill with a pulsing dot, so no one takes the product for finished. Nothing when `VITE_SHOW_BETA=false`. */
export const BetaPill = (props: BetaPillProps) => {
    if (!SHOW_BETA) return null;
    const { variant, locale } = props;
    return (
        <span
            title={m.beta_badge_label({}, { locale })}
            // Joined, not merged with `cn`: tailwind-merge takes the custom `text-overline` size for a text color and would drop `text-background`. The display is per variant, so `hidden` and `inline-flex` never meet.
            className={[
                'beta-pulse items-center gap-2 rounded-4xl border border-score-good/35 font-semibold shadow-[0_0_16px_-2px_color-mix(in_oklch,var(--glow-color)_70%,transparent),inset_0_0_8px_-4px_color-mix(in_oklch,var(--glow-color)_60%,transparent)] tracking-wide whitespace-nowrap text-score-good uppercase',
                variant === 'hero' ? 'inline-flex px-4 py-1.5 text-callout' : '',
                variant === 'header' ? 'text-overline hidden px-2.5 py-0.5 sm:inline-flex' : '',
                // An opaque background, so it reads over any content, and below a modal's layer.
                variant === 'floating' ? 'text-overline fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-30 inline-flex bg-background px-3 py-1 sm:hidden print:hidden' : '',
            ].join(' ')}
        >
            <span
                aria-hidden={'true'}
                className={'size-1.5 rounded-full bg-score-good motion-safe:animate-pulse'}
            />
            {variant === 'hero' ? m.beta_pill_hero({}, { locale }) : m.beta_badge({}, { locale })}
        </span>
    );
};
