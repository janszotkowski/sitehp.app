/**
 * International domain names for people. The scanner, the contract and the database keep the
 * ASCII form (`xn--…`, punycode), which is what DNS and URLs carry; a person should read the
 * name they typed (`háčky.cz`). These functions turn the ASCII form back for display only.
 *
 * The Unicode form can be made to look like another name (a Cyrillic `а` in `аpple.com`), so
 * a page that shows it should show the ASCII form next to it whenever the two differ.
 *
 * Pure and dependency-free (RFC 3492 decoding), so the browser, the server and the CLI agree.
 */

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_CODE_POINT = 0x10ffff;
const ACE_PREFIX = 'xn--';

const digitOf = (code: number): number => {
    if (code >= 48 && code <= 57) return code - 22; // 0-9 → 26-35
    if (code >= 65 && code <= 90) return code - 65; // A-Z → 0-25
    if (code >= 97 && code <= 122) return code - 97; // a-z → 0-25
    return BASE;
};

const adapt = (delta: number, points: number, first: boolean): number => {
    let value = first ? Math.floor(delta / DAMP) : delta >> 1;
    value += Math.floor(value / points);
    let k = 0;
    while (value > ((BASE - T_MIN) * T_MAX) >> 1) {
        value = Math.floor(value / (BASE - T_MIN));
        k += BASE;
    }
    return Math.floor(k + ((BASE - T_MIN + 1) * value) / (value + SKEW));
};

/** Decodes one punycode label (without `xn--`), or returns `undefined` if it is not valid punycode. */
const decodeLabel = (input: string): string | undefined => {
    const output: number[] = [];
    const delimiter = input.lastIndexOf('-');
    for (let index = 0; index < Math.max(delimiter, 0); index += 1) {
        const code = input.charCodeAt(index);
        if (code >= 0x80) return undefined;
        output.push(code);
    }

    let n = INITIAL_N;
    let bias = INITIAL_BIAS;
    let i = 0;
    for (let index = delimiter > 0 ? delimiter + 1 : 0; index < input.length;) {
        const oldI = i;
        let weight = 1;
        for (let k = BASE; ; k += BASE) {
            if (index >= input.length) return undefined;
            const digit = digitOf(input.charCodeAt(index));
            index += 1;
            if (digit >= BASE) return undefined;
            i += digit * weight;
            if (i > MAX_CODE_POINT * (output.length + 1)) return undefined;
            const threshold = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
            if (digit < threshold) break;
            weight *= BASE - threshold;
        }
        const length = output.length + 1;
        bias = adapt(i - oldI, length, oldI === 0);
        n += Math.floor(i / length);
        i %= length;
        if (n > MAX_CODE_POINT) return undefined;
        output.splice(i, 0, n);
        i += 1;
    }
    // A label with nothing outside ASCII is not an international name (`xn--`, `xn--abc-`): showing it decoded would hide the prefix.
    if (!output.some((code) => code >= 0x80)) return undefined;
    return String.fromCodePoint(...output);
};

/**
 * The Unicode form of one `xn--` label, accepted only if the URL parser encodes it back to exactly
 * the same label: that rejects characters IDNA does not allow (controls, symbols) and any
 * non-canonical encoding, so what is shown is always the name the address really means.
 */
const labelToUnicode = (label: string): string | undefined => {
    const decoded = decodeLabel(label.slice(ACE_PREFIX.length));
    if (decoded === undefined) return undefined;
    try {
        return new URL(`http://${decoded}/`).hostname === label.toLowerCase() ? decoded : undefined;
    } catch {
        return undefined;
    }
};

/** `xn--hky-ela4t.cz` → `háčky.cz`. A label that is not valid punycode is left as it is. */
export const domainToUnicode = (host: string): string =>
    host
        .split('.')
        .map((label) => (label.toLowerCase().startsWith(ACE_PREFIX) ? (labelToUnicode(label) ?? label) : label))
        .join('.');

/** The same address with its host in Unicode, for display. Anything that is not an absolute URL is returned unchanged. */
export const displayUrl = (href: string): string => {
    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return href;
    }
    const host = domainToUnicode(url.hostname);
    if (host === url.hostname) return href;
    return `${url.protocol}//${host}${url.port === '' ? '' : `:${url.port}`}${url.pathname}${url.search}${url.hash}`;
};
