/**
 * Color of a HP score. One pure function shared by the UI and the Open Graph
 * image, so the two can never disagree. The five anchor colors come from the
 * design language (`docs/DESIGN.md`, section 3.3); between them the
 * color is interpolated continuously in OKLab, so it never snaps between bands.
 */

export type ScoreBand = 'critical' | 'poor' | 'fair' | 'good' | 'excellent';

export type ScoreTheme = 'dark' | 'light';

export const SCORE_BANDS: readonly ScoreBand[] = ['critical', 'poor', 'fair', 'good', 'excellent'];

/** Inclusive lower bound of every band. */
const BAND_START: Record<ScoreBand, number> = { critical: 0, poor: 40, fair: 60, good: 80, excellent: 95 };

/** Where each anchor color sits on the 0–100 scale: the middle of its band. */
const ANCHOR_AT: Record<ScoreBand, number> = { critical: 20, poor: 50, fair: 70, good: 87, excellent: 98 };

/**
 * Anchor colors per theme, for what the score color draws: the rings, the bars, the glow, the share image. Graphics need
 * 3 : 1 against the page (WCAG 1.4.11), not the 4.5 : 1 of text, so the light anchors are the vivid ones; the text-safe
 * shades a status pill writes in are the `--score-*` tokens in `app.css`. Dark uses the same values for both.
 */
const ANCHOR_HEX: Record<ScoreTheme, Record<ScoreBand, string>> = {
    dark: { critical: '#FF6B63', poor: '#FF9F43', fair: '#F2D14B', good: '#3DD68C', excellent: '#2DD4CF' },
    light: { critical: '#DC3B33', poor: '#D9620B', fair: '#B88A00', good: '#1F9D55', excellent: '#0B9488' },
};

type Lab = readonly [number, number, number];

const clampScore = (hp: number): number => {
    if (!Number.isFinite(hp)) return 0;
    return Math.min(100, Math.max(0, hp));
};

export const scoreBand = (hp: number): ScoreBand => {
    const score = clampScore(hp);
    let found: ScoreBand = 'critical';
    for (const band of SCORE_BANDS) {
        if (score >= BAND_START[band]) found = band;
    }
    return found;
};

const srgbToLinear = (channel: number): number => {
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};

const hexToOklab = (hex: string): Lab => {
    const value = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((start) => srgbToLinear(Number.parseInt(value.slice(start, start + 2), 16) / 255)) as [number, number, number];

    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};

const mix = (from: Lab, to: Lab, t: number): Lab => {
    return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
};

const round = (value: number, digits: number): number => {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
};

const linearToSrgb = (channel: number): number => (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055);

/** `#rrggbb`, for renderers that know no `oklch()` (the Open Graph image). Out-of-gamut channels are clipped. */
const oklabToHex = ([L, a, b]: Lab): string => {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
    return `#${rgb
        .map((channel) =>
            Math.round(Math.min(1, Math.max(0, linearToSrgb(channel))) * 255)
                .toString(16)
                .padStart(2, '0'),
        )
        .join('')}`;
};

const oklabToCss = ([l, a, b]: Lab): string => {
    const chroma = Math.hypot(a, b);
    const hue = chroma < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    return `oklch(${round(l, 4)} ${round(chroma, 4)} ${round(hue, 2)})`;
};

/** The color of a score in OKLab, interpolated between the anchors. Scores outside 0–100 are clamped. */
const scoreLab = (hp: number, theme: ScoreTheme): Lab => {
    const score = clampScore(hp);
    const stops = SCORE_BANDS.map((band) => ({ at: ANCHOR_AT[band], lab: hexToOklab(ANCHOR_HEX[theme][band]) }));

    const first = stops[0];
    const last = stops[stops.length - 1];
    if (first === undefined || last === undefined) return [0.7, 0, 0];
    if (score <= first.at) return first.lab;
    if (score >= last.at) return last.lab;

    for (let index = 1; index < stops.length; index += 1) {
        const upper = stops[index];
        const lower = stops[index - 1];
        if (upper === undefined || lower === undefined) continue;
        if (score <= upper.at) {
            return mix(lower.lab, upper.lab, (score - lower.at) / (upper.at - lower.at));
        }
    }

    return last.lab;
};

/** CSS `oklch()` color for a score in the given theme. Scores outside 0–100 are clamped. */
export const scoreColor = (hp: number, theme: ScoreTheme = 'dark'): string => oklabToCss(scoreLab(hp, theme));

/** The same color as `scoreColor`, as `#rrggbb`. */
export const scoreColorHex = (hp: number, theme: ScoreTheme = 'dark'): string => oklabToHex(scoreLab(hp, theme));
