import { Link } from '@tanstack/react-router';
import { buttonVariants } from '@components/ui/button';
import { failureCodeOf, failureMessage } from '@lib/apiErrors';
import { asLocale } from '@lib/i18n/switchLocalePath';
import { m } from '@paraglide/messages.js';
import { getLocale } from '@paraglide/runtime.js';

type ErrorStateProps = {
    error: unknown;
    reset?: () => void;
};

/** What a route shows when its loader or render fails: calm, factual, with a way out. */
export const ErrorState = (props: ErrorStateProps) => {
    const locale = asLocale(getLocale());

    return (
        <main
            id={'main'}
            className={'grid flex-1 place-items-center px-4 py-16'}
        >
            <div className={'flex max-w-md flex-col items-center gap-6 text-center'}>
                <h1 className={'text-title-1'}>{m.error_boundary_title({}, { locale })}</h1>
                <p className={'text-callout text-muted-foreground'}>{failureMessage(failureCodeOf(props.error), locale)}</p>
                <div className={'flex gap-3'}>
                    {props.reset !== undefined && (
                        <button
                            type={'button'}
                            onClick={props.reset}
                            className={buttonVariants({ size: 'lg' })}
                        >
                            {m.error_boundary_retry({}, { locale })}
                        </button>
                    )}
                    <Link
                        to={'/$locale'}
                        params={{ locale }}
                        className={buttonVariants({ size: 'lg', variant: 'secondary' })}
                    >
                        {m.notfound_back_home({}, { locale })}
                    </Link>
                </div>
            </div>
        </main>
    );
};
