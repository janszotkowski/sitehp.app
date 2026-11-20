import { Link, useRouterState } from '@tanstack/react-router';
import { Menu } from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { BetaPill } from '@components/BetaPill';
import type { NavLink } from '@components/MobileMenu';
import { ScanForm } from '@components/ScanForm';
import { ThemeToggle } from '@components/ThemeToggle';
import { asLocale, type Locale } from '@lib/i18n/switchLocalePath';
import { focusScanField, isScanShortcut } from '@lib/scanShortcut';
import { m } from '@paraglide/messages.js';
import { getLocale } from '@paraglide/runtime.js';

/** The landing page (`/en`) has the scan form in its hero, so the header does not repeat it there. */
export const isLanding = (pathname: string): boolean => /^\/[^/]*\/?$/.test(pathname);

const NAV_LINKS: readonly NavLink[] = [
    { to: '/$locale/methodology', label: (locale: Locale) => m.nav_methodology({}, { locale }) },
    { to: '/$locale/about', label: (locale: Locale) => m.nav_about({}, { locale }) },
    { to: '/$locale/blog', label: (locale: Locale) => m.nav_blog({}, { locale }) },
];

/**
 * The top of every page, including the error pages: the wordmark that leads home and, beside it, a field to scan
 * another site. It stays at the top while the page scrolls, on a translucent layer. It keeps its own view-transition
 * name so it stays put while the page below it changes. Cmd+K (Ctrl+K) puts the cursor in the field from anywhere.
 * Below `md` the links sit behind a Menu button that opens a full-screen menu (`MobileMenu`); a page change closes it.
 */
// The menu's dialog is fetched when a phone user reaches for the button (hover, focus, touch), not with every page.
const loadMobileMenu = () => import('@components/MobileMenu');
const MobileMenu = lazy(() => loadMobileMenu().then((module) => ({ default: module.MobileMenu })));

// The same look as the menu's own buttons (`iconButton` in MobileMenu.tsx), kept here so the header does not load that file.
const menuButton = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring';

export const SiteHeader = () => {
    const locale = asLocale(getLocale());
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    const [menuOpen, setMenuOpen] = useState(false);
    // Mounted from the first open on, so it can animate closed and keep its state; open only once mounted (see `onMounted`).
    const [menuMounted, setMenuMounted] = useState(false);
    const [menuReady, setMenuReady] = useState(false);
    const markMenuReady = useCallback(() => setMenuReady(true), []);
    const menuTrigger = useRef<HTMLButtonElement>(null);
    // A page change (a link in the menu, the wordmark, a scan) closes the menu; adjusted during render, not in an effect.
    const [menuPath, setMenuPath] = useState(pathname);
    if (menuPath !== pathname) {
        setMenuPath(pathname);
        setMenuOpen(false);
    }

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!isScanShortcut(event)) return;
            // Browsers take Ctrl+K for their own search bar; when a field exists the page wins, and when none does the browser keeps it.
            if (focusScanField()) event.preventDefault();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    return (
        <header
            className={
                'glass-heavy print:hidden sticky top-0 z-40 grid h-(--site-header-height) grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-x-0 border-t-0 px-4 py-2 shadow-none [view-transition-name:site-header] sm:gap-6 sm:px-6 md:grid-cols-[1fr_minmax(0,36rem)_1fr]'
            }
        >
            <div className={'flex items-center gap-2 justify-self-start'}>
                <Link
                    to={'/$locale'}
                    params={{ locale }}
                    aria-label={m.layout_home_label({}, { locale })}
                    className={'inline-flex min-h-11 items-center rounded-xs text-headline tracking-tight text-foreground'}
                >
                    sitehp.app
                </Link>
                <BetaPill
                    variant={'header'}
                    locale={locale}
                />
            </div>
            {!isLanding(pathname) && <ScanForm variant={'compact'} />}
            <div className={'col-start-3 justify-self-end md:hidden'}>
                <button
                    ref={menuTrigger}
                    type={'button'}
                    aria-haspopup={'dialog'}
                    aria-expanded={menuOpen}
                    onPointerEnter={() => void loadMobileMenu()}
                    onFocus={() => void loadMobileMenu()}
                    onClick={() => {
                        setMenuMounted(true);
                        setMenuOpen(true);
                    }}
                    className={menuButton}
                >
                    <Menu aria-hidden={'true'} />
                    <span className={'sr-only'}>{m.nav_menu({}, { locale })}</span>
                </button>
                {menuMounted && (
                    <Suspense fallback={null}>
                        <MobileMenu
                            links={NAV_LINKS}
                            locale={locale}
                            open={menuOpen && menuReady}
                            onOpenChange={setMenuOpen}
                            trigger={menuTrigger}
                            onMounted={markMenuReady}
                        />
                    </Suspense>
                )}
            </div>
            <nav
                aria-label={m.nav_label({}, { locale })}
                className={'col-start-3 hidden items-center gap-1 justify-self-end md:flex'}
            >
                {NAV_LINKS.map((link) => (
                    <Link
                        key={link.to}
                        to={link.to}
                        params={{ locale }}
                        activeProps={{ 'aria-current': 'page', className: 'text-foreground' }}
                        className={
                            'text-callout inline-flex min-h-11 items-center rounded-md px-3 whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
                        }
                    >
                        {link.label(locale)}
                    </Link>
                ))}
                <ThemeToggle locale={locale} />
            </nav>
        </header>
    );
};
