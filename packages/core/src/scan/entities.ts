/** Decodes the XML character references of a sitemap (`&amp;`, `&#39;`, `&#x27;`); HTML is decoded by parse5. An unknown name stays as written. */
const ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
};

// A code point past Unicode or a lone surrogate is no character: the reference stays as written.
const character = (code: number, whole: string): string => (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? whole : String.fromCodePoint(code));

export const decode = (text: string): string =>
    text.replace(/&(?:#(\d+)|#x([\da-f]+)|(\w+));/gi, (whole, dec?: string, hex?: string, name?: string) => {
        if (dec !== undefined) return character(Number(dec), whole);
        if (hex !== undefined) return character(parseInt(hex, 16), whole);
        return ENTITIES[name ?? ''] ?? whole;
    });
