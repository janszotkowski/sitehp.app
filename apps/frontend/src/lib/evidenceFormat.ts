import type { Locale } from '@lib/i18n/switchLocalePath';

const ACRONYMS = new Set(['html', 'css', 'js', 'url', 'http', 'https', 'tls', 'dns', 'csp', 'hsts', 'ttfb', 'id', 'ssl', 'cdn', 'ip', 'seo', 'og', 'json', 'xml', 'dmarc', 'spf', 'dkim']);

/** `htmlTransferredBytes` as "HTML transferred bytes": words split at the capitals and underscores, known acronyms in capitals. */
export const evidenceLabel = (name: string): string => {
    const words = name
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .toLowerCase()
        .split(' ')
        .filter((word) => word !== '')
        .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word));
    const text = words.join(' ');
    return text === '' ? name : text.charAt(0).toUpperCase() + text.slice(1);
};

/** Czech writes a decimal comma. */
const decimal = (value: string, locale: Locale): string => (locale === 'cs' ? value.replace('.', ',') : value);

const bytesText = (bytes: number, locale: Locale): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${decimal((bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0), locale)} kB`;
    return `${decimal((bytes / (1024 * 1024)).toFixed(1), locale)} MB`;
};

/** "1 day", "5 days"; Czech has three forms: 1 den, 2–4 dny, 5 dní. */
const daysText = (days: number, locale: Locale): string => {
    const size = Math.abs(days);
    if (locale === 'cs') return `${days} ${size === 1 ? 'den' : size >= 2 && size <= 4 ? 'dny' : 'dní'}`;
    return `${days} ${size === 1 ? 'day' : 'days'}`;
};

/**
 * A measured value as a person reads it: sizes in kB or MB (the exact number stays in the title and in the copied text), `true` and `false`
 * as yes and no. The name tells the unit (`…Bytes`, `…Ms`, `…Days`, `…Percent`). A value that is not a plain number is shown as it is.
 */
export const evidenceValue = (name: string, value: string, locale: Locale = 'en'): { text: string; exact?: string } => {
    if (value === 'true') return { text: locale === 'cs' ? 'ano' : 'yes' };
    if (value === 'false') return { text: locale === 'cs' ? 'ne' : 'no' };
    if (!/^-?\d+(\.\d+)?$/.test(value)) return { text: value };
    const number = Number(value);
    if (/bytes$/i.test(name))
        return number >= 1024
            ? { text: bytesText(number, locale), exact: locale === 'cs' ? `${number.toLocaleString('cs-CZ')} bajtů` : `${number.toLocaleString('en-US')} bytes` }
            : { text: `${number} B` };
    if (/ms$/i.test(name)) return { text: `${number} ms` };
    if (/days(left)?$/i.test(name)) return { text: daysText(number, locale) };
    if (/percent$/i.test(name)) return { text: `${decimal(String(number), locale)} %` };
    return { text: value };
};
