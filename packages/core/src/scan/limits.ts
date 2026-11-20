/** Thresholds the checks judge by and the report quotes back to the owner. Plain values, so a page can import them without the check runners. */
export const TITLE_LENGTH = { min: 30, max: 60 };
export const DESCRIPTION_LENGTH = { min: 70, max: 160 };
/** 180 days, the usual bar for a "real" HSTS policy. */
export const HSTS_MIN_SECONDS = 15_552_000;
/** Time to first byte, in ms: above `warn` is slow, above `fail` is poor (Google's own guide). */
export const TTFB_MS = { warn: 800, fail: 1800 };
/** Days left on the certificate: under `warn` is close, under `fail` is urgent. */
export const EXPIRY_DAYS = { warn: 14, fail: 5 };
/** The HTML's size and the number of files it points to: over `warn` the page is heavy, over `fail` very heavy. */
export const HTML_BYTES = { warn: 500_000, fail: 1_000_000 };
export const RESOURCES = { warn: 100, fail: 200 };
/** Words in the HTML body: under `few` an agent sees an empty shell, under `enough` a thin page. */
export const WORDS = { few: 10, enough: 50 };
