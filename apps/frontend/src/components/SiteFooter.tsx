import { Link, useRouterState } from '@tanstack/react-router';
import { OperatorDetails } from '@components/OperatorDetails';
import { OPERATOR } from '@config/operator';
import { SHOW_BETA } from '@config/site';
import { LOCALES, asLocale, switchLocalePath, type Locale } from '@lib/i18n/switchLocalePath';
import { m } from '@paraglide/messages.js';
import { getLocale } from '@paraglide/runtime.js';

const LEGAL_LINKS = [
    { to: '/$locale/privacy', label: (locale: Locale) => m.legal_link_privacy({}, { locale }) },
    { to: '/$locale/terms', label: (locale: Locale) => m.legal_link_terms({}, { locale }) },
    { to: '/$locale/cookies', label: (locale: Locale) => m.legal_link_cookies({}, { locale }) },
    { to: '/$locale/accessibility', label: (locale: Locale) => m.legal_link_accessibility({}, { locale }) },
    { to: '/$locale/website-owners', label: (locale: Locale) => m.legal_link_website_owners({}, { locale }) },
] as const;

/** Each language named in itself, so a reader finds theirs whatever the page is in. */
const LOCALE_NAMES: Record<Locale, string> = { en: 'English', cs: 'Čeština' };

const linkClass = 'inline-flex min-h-8 items-center text-callout text-muted-foreground underline-offset-4 hover:text-foreground hover:underline';

/** The bottom of every page: what the product is, where to go, and who is behind it (the operator's name and contacts). */
export const SiteFooter = () => {
    const locale = asLocale(getLocale());
    const pathname = useRouterState({ select: (state) => state.location.pathname });

    return (
        <footer className={'border-t print:hidden px-4 py-12 [view-transition-name:site-footer] sm:px-6'}>
            <div className={'mx-auto grid max-w-5xl gap-10 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)]'}>
                <div className={'flex flex-col gap-3'}>
                    <p className={'text-headline tracking-tight'}>{m.footer_product({}, { locale })}</p>
                    <p className={'max-w-xs text-callout text-muted-foreground'}>{m.footer_brand_text({}, { locale })}</p>
                    {SHOW_BETA && <p className={'max-w-xs text-caption text-subtle-foreground'}>{m.beta_footer({}, { locale })}</p>}
                </div>

                <nav
                    aria-label={m.footer_product({}, { locale })}
                    className={'flex flex-col gap-1'}
                >
                    <Link
                        to={'/$locale'}
                        params={{ locale }}
                        className={linkClass}
                    >
                        {m.footer_scan({}, { locale })}
                    </Link>
                    <Link
                        to={'/$locale/methodology'}
                        params={{ locale }}
                        className={linkClass}
                    >
                        {m.nav_methodology({}, { locale })}
                    </Link>
                    <Link
                        to={'/$locale/about'}
                        params={{ locale }}
                        className={linkClass}
                    >
                        {m.nav_about({}, { locale })}
                    </Link>
                    <Link
                        to={'/$locale/blog'}
                        params={{ locale }}
                        className={linkClass}
                    >
                        {m.nav_blog({}, { locale })}
                    </Link>
                </nav>

                <div className={'flex flex-col gap-3'}>
                    <h2 className={'text-overline uppercase text-subtle-foreground'}>{m.footer_operator({}, { locale })}</h2>
                    <OperatorDetails locale={locale} />
                </div>
            </div>

            <div className={'mx-auto mt-10 flex max-w-5xl flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between'}>
                <div className={'flex flex-wrap items-center gap-x-5 gap-y-1'}>
                    <p className={'text-caption text-subtle-foreground'}>{m.footer_copyright({ name: OPERATOR.name }, { locale })}</p>
                    {/* A full page load: the language is read from the address when the page starts. */}
                    <nav aria-label={m.footer_language({}, { locale })}>
                        <ul className={'flex gap-x-3'}>
                            {LOCALES.filter((other) => other !== locale).map((other) => (
                                <li key={other}>
                                    <a
                                        href={switchLocalePath(pathname, other)}
                                        hrefLang={other}
                                        lang={other}
                                        className={'inline-flex min-h-8 items-center text-caption text-subtle-foreground underline-offset-4 hover:text-foreground hover:underline'}
                                    >
                                        {LOCALE_NAMES[other]}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </nav>
                </div>
                <nav aria-label={m.footer_legal({}, { locale })}>
                    <ul className={'flex flex-wrap gap-x-5 gap-y-1'}>
                        {LEGAL_LINKS.map((link) => (
                            <li key={link.to}>
                                <Link
                                    to={link.to}
                                    params={{ locale }}
                                    className={'inline-flex min-h-8 items-center text-caption text-subtle-foreground underline-offset-4 hover:text-foreground hover:underline'}
                                >
                                    {link.label(locale)}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </nav>
            </div>
        </footer>
    );
};
