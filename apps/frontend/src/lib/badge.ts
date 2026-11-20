import { publicIdSchema, scoreBand, scoreColorHex, type ScanSnapshot } from '@sitehp.app/core/browser';
import { DEFAULT_LOCALE } from '@lib/i18n/switchLocalePath';
import { m } from '@paraglide/messages.js';

// A badge is language-neutral and is drawn outside the page's locale middleware, so the language is always the default one.
const locale = { locale: DEFAULT_LOCALE };

/** `/badge/r/<publicId>.svg`, the HP badge of one report. It shows the score and a word for it, never the domain or a finding. */
export const badgePathOf = (publicId: string): string => `/badge/r/${publicId}.svg`;

/** The report id a badge path asks for, or `undefined` for any other path (or an id that cannot exist). */
export const badgeReportIdOf = (pathname: string): string | undefined => {
    const match = /^\/badge\/r\/([^/]+)\.svg$/.exec(pathname);
    const id = match?.[1];
    return id !== undefined && publicIdSchema.safeParse(id).success ? id : undefined;
};

/** What a badge says. `expired`: the report is gone; `unavailable`: the report could not be read just now. */
export type BadgeState = { kind: 'score'; score: number } | { kind: 'scanning' } | { kind: 'no_score' } | { kind: 'expired' } | { kind: 'unavailable' };

export const badgeStateOf = (snapshot: Pick<ScanSnapshot, 'status' | 'score' | 'selectedChecks'>): BadgeState => {
    if (snapshot.status === 'running') return { kind: 'scanning' };
    // A scan of a choice of checks has no HP to show off: picking only the checks a site passes would make any site a 100.
    return snapshot.score === null || snapshot.selectedChecks !== undefined ? { kind: 'no_score' } : { kind: 'score', score: snapshot.score };
};

/** A finished report is a fixed score but can expire, so its badge is kept for an hour, not for good; a running one only briefly. */
export const badgeCacheControl = (state: BadgeState): string => {
    if (state.kind === 'unavailable') return 'no-store';
    if (state.kind === 'scanning') return 'public, max-age=60';
    return state.kind === 'expired' ? 'public, max-age=300' : 'public, max-age=3600';
};

const BAND_WORD = {
    critical: () => m.method_band_critical({}, locale),
    poor: () => m.method_band_poor({}, locale),
    fair: () => m.method_band_fair({}, locale),
    good: () => m.method_band_good({}, locale),
    excellent: () => m.method_band_excellent({}, locale),
};

/** The words of a badge: what the right half says, and the full sentence for `title` and `aria-label`. */
export const badgeText = (state: BadgeState): { value: string; title: string } => {
    if (state.kind === 'score') {
        const word = BAND_WORD[scoreBand(state.score)]();
        return { value: `${state.score} · ${word}`, title: m.badge_title({ score: state.score, band: word }, locale) };
    }
    const word =
        state.kind === 'scanning'
            ? m.badge_scanning({}, locale)
            : state.kind === 'no_score'
              ? m.badge_no_score({}, locale)
              : state.kind === 'expired'
                ? m.badge_expired({}, locale)
                : m.badge_unavailable({}, locale);
    return { value: word, title: `HP: ${word}` };
};

export type BadgeTheme = 'light' | 'dark';

/** `?theme=light` asks for the badge for a light page; anything else is the dark one. */
export const badgeThemeOf = (search: URLSearchParams): BadgeTheme => (search.get('theme') === 'light' ? 'light' : 'dark');

const PALETTE: Record<BadgeTheme, { fill: string; border: string; text: string; track: string; neutral: string }> = {
    dark: { fill: '#1C1C20', border: '#1C1C20', text: '#FFFFFF', track: '#3A3A42', neutral: '#8A8A93' },
    light: { fill: '#FFFFFF', border: '#D6D6DB', text: '#1C1C20', track: '#E3E3E8', neutral: '#6B6B75' },
};

const HEIGHT = 32;
const RING_RADIUS = 12;
const RING_WIDTH = 3;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const TEXT_X = 38;
// Verdana at 12 px averages a little under 7.5 px a character; the badge is a fixed layout, so the width is estimated, not measured.
const CHAR_WIDTH = 7.4;
const escapeXml = (text: string): string => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/**
 * A flat pill: a ring filled to the score in the score's color with the number inside, then "HP" and the word for the score. The word is
 * there so the color is never the only thing that says it. Without a score the ring is grey and empty and the word says why.
 * The text is the theme's own color, not the score's: the ring is a graphic (3 : 1), the text must reach 4.5 : 1.
 */
export const badgeSvg = (state: BadgeState, theme: BadgeTheme = 'dark'): string => {
    const colors = PALETTE[theme];
    const { value, title } = badgeText(state);
    const word = state.kind === 'score' ? value.split(' · ')[1] : value;
    const width = Math.ceil(TEXT_X + (3 + (word?.length ?? 0)) * CHAR_WIDTH + 12);
    const centre = HEIGHT / 2;
    const arc = state.kind === 'score' ? (Math.min(100, Math.max(0, state.score)) / 100) * RING_CIRCUMFERENCE : 0;
    const ring = (stroke: string, dash?: string) =>
        `<circle cx="${centre}" cy="${centre}" r="${RING_RADIUS}" fill="none" stroke="${stroke}" stroke-width="${RING_WIDTH}"${dash === undefined ? '' : ` stroke-dasharray="${dash}" stroke-linecap="round" transform="rotate(-90 ${centre} ${centre})"`}/>`;
    const number = state.kind === 'score' ? String(state.score) : '–';
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}" role="img" aria-label="${escapeXml(title)}"><title>${escapeXml(title)}</title>` +
        `<rect x=".5" y=".5" width="${width - 1}" height="${HEIGHT - 1}" rx="${HEIGHT / 2 - 0.5}" fill="${colors.fill}" stroke="${colors.border}"/>` +
        ring(colors.track) +
        (state.kind === 'score' ? ring(scoreColorHex(state.score, theme), `${arc.toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`) : ring(colors.neutral)) +
        `<g fill="${colors.text}" font-family="Verdana,DejaVu Sans,sans-serif" dominant-baseline="central">` +
        `<text x="${centre}" y="${centre + 0.5}" font-size="${number.length > 2 ? 9 : 11}" font-weight="700" text-anchor="middle">${number}</text>` +
        `<text x="${TEXT_X}" y="${centre + 0.5}" font-size="12"><tspan font-weight="700">HP</tspan> ${escapeXml(word ?? '')}</text></g></svg>`
    );
};

type BadgeSnippetInput = { origin: string; locale: string; publicId: string; score: number; theme: BadgeTheme };

/** The two ways to put the badge on a page: both show the image and link it to the report. The words in the alt text are the score's, never the site's. */
export const badgeSnippets = (input: BadgeSnippetInput): { markdown: string; html: string; imageUrl: string; reportUrl: string } => {
    const imageUrl = `${input.origin}${badgePathOf(input.publicId)}${input.theme === 'light' ? '?theme=light' : ''}`;
    const reportUrl = `${input.origin}/${input.locale}/r/${input.publicId}`;
    const alt = badgeText({ kind: 'score', score: input.score }).title;
    return { imageUrl, reportUrl, markdown: `[![${alt}](${imageUrl})](${reportUrl})`, html: `<a href="${reportUrl}"><img src="${imageUrl}" alt="${alt}" height="32"></a>` };
};
