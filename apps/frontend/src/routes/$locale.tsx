import { Outlet, createFileRoute, notFound } from '@tanstack/react-router';
import { isLocale } from '@lib/i18n/switchLocalePath';

export const Route = createFileRoute('/$locale')({
    // The only place that guards the language in the address. Without it
    // `/xx/pricing`, `/favicon.ico` or `/sitemap.xml` would be taken as a
    // "language" and answer 200 with a page that does not belong there.
    beforeLoad: ({ params }) => {
        if (!isLocale(params.locale)) throw notFound();
    },
    component: Outlet,
});
