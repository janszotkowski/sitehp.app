import { asLocale } from '@lib/i18n/switchLocalePath';
import { m } from '@paraglide/messages.js';
import { getLocale } from '@paraglide/runtime.js';

/** The first thing a keyboard user reaches: a way past the header to the page itself. Visible only when focused. */
export const SkipLink = () => {
    const locale = asLocale(getLocale());

    return (
        <a
            href={'#main'}
            className={
                'sr-only rounded-md bg-primary px-4 py-2 text-callout text-primary-foreground focus-visible:not-sr-only focus-visible:fixed focus-visible:top-4 focus-visible:left-4 focus-visible:z-50'
            }
        >
            {m.layout_skip_to_content({}, { locale })}
        </a>
    );
};
