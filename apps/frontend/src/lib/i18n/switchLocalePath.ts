import { deLocalizeHref, localizeHref } from '@paraglide/runtime.js';

export type Locale = 'en' | 'cs';

export const LOCALES: readonly Locale[] = ['en', 'cs'];

export const DEFAULT_LOCALE: Locale = 'en';

export const isLocale = (value: string): value is Locale => {
    return LOCALES.some((locale) => locale === value);
};

/** The `$locale` route param is a string for TypeScript; the router has already validated it. */
export const asLocale = (value: string): Locale => {
    return isLocale(value) ? value : DEFAULT_LOCALE;
};

/**
 * Switching language keeps the user on the same page. The path is not built
 * from strings by hand: the shape of localized URLs is described once in
 * `vite/paraglide.ts`, and building it here would create a second source of
 * truth. `deLocalizeHref` + `localizeHref` is the pair Paraglide documents.
 */
export const switchLocalePath = (pathname: string, target: Locale): string => {
    const switched: string = localizeHref(deLocalizeHref(pathname), { locale: target });
    // The language root localizes to `/en/`; a trailing slash would make a
    // second variant of an otherwise identical address.
    return switched.length > 1 ? switched.replace(/\/$/, '') : switched;
};
