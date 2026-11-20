import { domainToASCII } from 'node:url';

export type BlockRules = {
    /** Top-level domains refused with everything under them, lower case and without the dot, as the ASCII (punycode) form `normalizeUrl` produces. */
    tlds: readonly string[];
    /** Domains refused with all their subdomains. */
    domains: readonly string[];
};

/**
 * The rule that blocks the host, or undefined: `*.ru` when its top-level domain is listed, the listed domain when it is that domain or
 * one of its subdomains. It judges the name only; where a server physically stands (a `.com` hosted in a blocked country) is not looked at.
 */
export const blockedBy = (host: string, rules: BlockRules): string | undefined => {
    const name = host.toLowerCase().replace(/\.$/, '');
    const tld = name.slice(name.lastIndexOf('.') + 1);
    if (rules.tlds.includes(tld)) return `*.${tld}`;
    return rules.domains.find((domain) => name === domain || name.endsWith(`.${domain}`));
};

export const isBlockedHost = (host: string, rules: BlockRules): boolean => blockedBy(host, rules) !== undefined;

const NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

/**
 * A comma-separated setting as a clean list: trimmed, no leading dot, no empty entries, in the ASCII (punycode) form hosts are compared in,
 * so `рф` works as well as `xn--p1ai`. Anything that is not a plain name (`*.x.com`, `https://x.com`, `x.com:80`) throws: it would never match.
 */
export const parseBlockList = (value: string): string[] =>
    value
        .split(',')
        .map((entry) => entry.trim().replace(/^\./, ''))
        .filter((entry) => entry !== '')
        .map((entry) => {
            // Checked before the conversion too: it quietly drops a path (`x.com/a` becomes `x.com`).
            const ascii = /[/:?#@\s]/.test(entry) ? '' : domainToASCII(entry);
            if (!NAME.test(ascii)) throw new Error(`"${entry}" is not a domain name`);
            return ascii;
        });
