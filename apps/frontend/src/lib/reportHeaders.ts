/** `/en/r/<id>`, a report page in any language, and `/og/r/<id>.png`, its preview image: both are as private as the link. */
const REPORT_PATH = /^\/[a-z]{2}\/r\//;

export const isReportPath = (pathname: string): boolean => REPORT_PATH.test(pathname);

/**
 * Headers for every response of a report page. A report is reachable only by
 * its unguessable link, so it must stay out of search results even if someone
 * posts the link publicly, and following a link out of it must not reveal the
 * address in the Referer header.
 */
export const REPORT_HEADERS: Readonly<Record<string, string>> = {
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
};
