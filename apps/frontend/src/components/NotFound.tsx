import { Link } from '@tanstack/react-router';
import { buttonVariants } from '@components/ui/button';
import { asLocale } from '@lib/i18n/switchLocalePath';
import { m } from '@paraglide/messages.js';
import { getLocale } from '@paraglide/runtime.js';

/**
 * A calm, factual error page (design language, section 9): neutral gray, never
 * red, no blame. The ring is the product's motif left empty: nothing was found.
 */
export const NotFound = () => {
    const locale = asLocale(getLocale());

    return (
        <main
            id={'main'}
            className={'grid flex-1 place-items-center px-4 py-16'}
        >
            <div className={'flex max-w-md flex-col items-center gap-8 text-center'}>
                <div className={'relative grid size-[min(56vw,13rem)] place-items-center'}>
                    <svg
                        viewBox={'0 0 200 200'}
                        aria-hidden={'true'}
                        className={'absolute inset-0 size-full'}
                    >
                        <circle
                            cx={100}
                            cy={100}
                            r={90}
                            fill={'none'}
                            strokeWidth={14}
                            className={'stroke-secondary'}
                        />
                    </svg>
                    <span
                        aria-hidden={'true'}
                        className={'text-display tabular-nums text-subtle-foreground'}
                    >
                        {m.notfound_code({}, { locale })}
                    </span>
                </div>

                <div className={'flex flex-col gap-3'}>
                    <h1 className={'text-title-1'}>{m.notfound_title({}, { locale })}</h1>
                    <p className={'text-callout text-muted-foreground'}>{m.notfound_body({}, { locale })}</p>
                </div>

                <Link
                    to={'/$locale'}
                    params={{ locale }}
                    className={buttonVariants({ size: 'lg' })}
                >
                    {m.notfound_back_home({}, { locale })}
                </Link>
            </div>
        </main>
    );
};
