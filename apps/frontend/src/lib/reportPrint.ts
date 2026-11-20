import type { Locale } from '@lib/i18n/switchLocalePath';

/** `/en/r/<id>/print`, the report laid out for paper: the browser's print dialog saves it as a PDF. */
export const printPathOf = (locale: Locale, publicId: string): string => `/${locale}/r/${publicId}/print`;

/** `2026-10-13 19:10 UTC`: the same text on the server and in the browser, whatever the reader's time zone. */
export const utcStamp = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
