import { HeadContent, Outlet, Scripts, createRootRouteWithContext, useRouterState } from '@tanstack/react-router';
import { ALLOW_INDEXING, siteConfig } from '@config/site';
import { asLocale, type Locale } from '@lib/i18n/switchLocalePath';
import { THEME_BOOT_SCRIPT, THEME_COLOR } from '@lib/theme';
import { m } from '@paraglide/messages.js';
import { getLocale } from '@paraglide/runtime.js';
import appCss from '@styles/app.css?url';
// The same file the stylesheet names (one asset by content hash): preloaded, so text gets its face without waiting for the CSS to be read.
import interLatin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import interLatinExt from '@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2?url';
import { PointerGlow } from '@components/PointerGlow';
import { RouteAnnouncer } from '@components/RouteAnnouncer';
import { BetaPill } from '@components/BetaPill';
import { SiteFooter } from '@components/SiteFooter';
import { SiteHeader, isLanding } from '@components/SiteHeader';
import { SkipLink } from '@components/SkipLink';
import type { RouterContext } from '@lib/routerContext';

const RootDocument = () => {
    // The Paraglide runtime is typed only in JSDoc, so getLocale() comes out as
    // any. Narrowing here is the one place it can be stopped.
    const locale: Locale = asLocale(getLocale());
    const pathname = useRouterState({ select: (state) => state.location.pathname });

    return (
        // The server always renders dark (the dark identity, and it cannot see the visitor's setting);
        // the boot script below switches before first paint, hence suppressHydrationWarning.
        <html
            lang={locale}
            className={'dark'}
            suppressHydrationWarning
        >
            <head>
                <HeadContent />
                <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
            </head>
            <body className={'flex min-h-svh flex-col'}>
                <SkipLink />
                <RouteAnnouncer />
                <PointerGlow />
                <SiteHeader />
                <div className={'flex flex-1 flex-col'}>
                    <Outlet />
                </div>
                <SiteFooter />
                {/* The landing page has its own pill above the title. */}
                {!isLanding(pathname) && (
                    <BetaPill
                        variant={'floating'}
                        locale={locale}
                    />
                )}
                <Scripts />
            </body>
        </html>
    );
};

export const Route = createRootRouteWithContext<RouterContext>()({
    head: ({ matches }) => {
        // An error page does not belong in the index, and its title says what happened.
        const notFound = matches.some((match) => match.status === 'notFound' || match._notFound === true);
        const failed = !notFound && matches.some((match) => match.status === 'error');
        return {
            meta: [
                { charSet: 'utf-8' },
                { name: 'viewport', content: 'width=device-width, initial-scale=1' },
                { name: 'theme-color', content: THEME_COLOR.dark },
                { title: notFound ? `${m.notfound_title()} | ${siteConfig.title}` : failed ? `${m.error_boundary_title()} | ${siteConfig.title}` : siteConfig.title },
                // Safe default for routes that set no head of their own: not indexed,
                // and on non-production environments nothing is indexed anywhere.
                ...(notFound || failed || !ALLOW_INDEXING ? [{ name: 'robots', content: 'noindex, nofollow' }] : []),
            ],
            links: [
                { rel: 'stylesheet', href: appCss },
                { rel: 'preload', href: interLatin, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
                // Czech letters (ě, š, č, ř…) are in the latin-ext file: a Czech page needs it as early as the latin one.
                ...(asLocale(getLocale()) === 'cs' ? [{ rel: 'preload', href: interLatinExt, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' as const }] : []),
                // The ICO for browsers and tools that ask for `/favicon.ico` or cannot draw SVG; the SVG wins where it can be drawn.
                { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
                { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
                { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
            ],
        };
    },
    component: RootDocument,
});
