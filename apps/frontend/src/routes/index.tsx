import { createFileRoute, redirect } from '@tanstack/react-router';
import { DEFAULT_LOCALE } from '@lib/i18n/switchLocalePath';

export const Route = createFileRoute('/')({
    // In production `src/server.ts` redirects `/` by `Accept-Language` before the
    // router runs. The dev server does not use that entry, so without this
    // fallback `/` would be a 404 while developing.
    beforeLoad: () => {
        throw redirect({ to: '/$locale', params: { locale: DEFAULT_LOCALE } });
    },
});
