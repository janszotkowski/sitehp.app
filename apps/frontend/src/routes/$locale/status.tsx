import { createFileRoute } from '@tanstack/react-router';
import { failureCodeOf, failureMessage, type FailureCode } from '@lib/apiErrors';
import { asLocale } from '@lib/i18n/switchLocalePath';
import { pageHead } from '@lib/pageHead';
import { m } from '@paraglide/messages.js';

// Only whether the backend answers: its version and uptime are for operators, and loader data is written into the page.
type Health = { failure: FailureCode | undefined };

const StatusPage = () => {
    const locale = asLocale(Route.useParams().locale);
    const { failure } = Route.useLoaderData();

    return (
        <main
            id={'main'}
            className={'mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-16'}
        >
            <header className={'flex flex-col gap-3'}>
                <h1 className={'text-title-1'}>{m.status_title({}, { locale })}</h1>
                <p className={'text-callout text-muted-foreground'}>{m.status_intro({}, { locale })}</p>
            </header>

            <section
                aria-labelledby={'status-backend'}
                className={'flex flex-col gap-3 rounded-lg border bg-card p-6'}
            >
                <h2
                    id={'status-backend'}
                    className={'text-headline'}
                >
                    {m.status_health_title({}, { locale })}
                </h2>
                {failure === undefined ? (
                    <p className={'text-callout text-score-good'}>{m.status_health_ok({}, { locale })}</p>
                ) : (
                    <p className={'text-callout text-destructive'}>{failureMessage(failure, locale)}</p>
                )}
            </section>
        </main>
    );
};

export const Route = createFileRoute('/$locale/status')({
    head: ({ params }) => {
        const locale = asLocale(params.locale);
        return pageHead({
            locale,
            title: m.seo_status_title({}, { locale }),
            description: m.seo_status_description({}, { locale }),
            path: `/${locale}/status`,
            // A diagnostic page, not content: kept out of the index and out of the sitemap.
            noindex: true,
        });
    },
    loader: async (): Promise<Health> => {
        try {
            // The loader is not split off with the page, so the API client (and its schemas) is loaded here, not with every page.
            const { createApi } = await import('@lib/api');
            await createApi().health();
            return { failure: undefined };
        } catch (error) {
            return { failure: failureCodeOf(error) };
        }
    },
    component: StatusPage,
});
