import { describe, expect, it } from 'vitest';
import { scoreColorHex } from '@sitehp.app/core/browser';
import { badgeCacheControl, badgePathOf, badgeReportIdOf, badgeSnippets, badgeStateOf, badgeSvg, badgeText, badgeThemeOf } from '@lib/badge';

const ID = 'a'.repeat(22);

describe('badge route', () => {
    it('asks for one report by its id and nothing else', () => {
        expect(badgeReportIdOf(badgePathOf(ID))).toBe(ID);
        expect(badgeReportIdOf('/badge/r/short.svg')).toBeUndefined();
        expect(badgeReportIdOf(`/badge/r/${ID}.png`)).toBeUndefined();
        expect(badgeReportIdOf(`/badge/r/${ID}.svg/extra`)).toBeUndefined();
        expect(badgeReportIdOf(`/badge/${ID}.svg`)).toBeUndefined();
        expect(badgeReportIdOf(`/og/r/${ID}.svg`)).toBeUndefined();
    });

    it('says a running scan is scanning, a finished one its score, and one without a score so', () => {
        expect(badgeStateOf({ status: 'running', score: 40 })).toEqual({ kind: 'scanning' });
        expect(badgeStateOf({ status: 'completed', score: 87 })).toEqual({ kind: 'score', score: 87 });
        expect(badgeStateOf({ status: 'completed', score: 100, selectedChecks: ['http_status'] })).toEqual({ kind: 'no_score' });
        expect(badgeStateOf({ status: 'completed', score: null })).toEqual({ kind: 'no_score' });
        expect(badgeStateOf({ status: 'failed', score: null })).toEqual({ kind: 'no_score' });
    });

    it('keeps a finished badge for an hour, a running one for a minute, and never an error', () => {
        expect(badgeCacheControl({ kind: 'score', score: 87 })).toBe('public, max-age=3600');
        expect(badgeCacheControl({ kind: 'scanning' })).toBe('public, max-age=60');
        expect(badgeCacheControl({ kind: 'expired' })).toBe('public, max-age=300');
        expect(badgeCacheControl({ kind: 'unavailable' })).toBe('no-store');
    });
});

describe('badge image', () => {
    const textOf = (svg: string) => [...svg.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map((match) => match[1]?.replace(/<[^>]+>/g, ''));

    it('writes the score and its word, in the image and for a screen reader', () => {
        expect(badgeText({ kind: 'score', score: 87 })).toEqual({ value: '87 · Good', title: 'HP score 87, Good' });
        const svg = badgeSvg({ kind: 'score', score: 87 });
        expect(svg).toContain('aria-label="HP score 87, Good"');
        expect(svg).toContain('<title>HP score 87, Good</title>');
        expect(textOf(svg)).toEqual(['87', 'HP Good']);
        expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    });

    it('fills the ring to the score, in the color of that score for the theme', () => {
        const circumference = 2 * Math.PI * 12;
        for (const theme of ['dark', 'light'] as const) {
            const svg = badgeSvg({ kind: 'score', score: 50 }, theme);
            expect(svg).toContain(`stroke="${scoreColorHex(50, theme)}"`);
            expect(svg).toContain(`stroke-dasharray="${(circumference / 2).toFixed(2)} ${circumference.toFixed(2)}"`);
        }
        expect(badgeSvg({ kind: 'score', score: 0 })).toContain(`stroke-dasharray="0.00 `);
        expect(badgeSvg({ kind: 'score', score: 100 })).toContain(`stroke-dasharray="${circumference.toFixed(2)} `);
        expect(textOf(badgeSvg({ kind: 'score', score: 100 }))[0]).toBe('100');
    });

    it('has a dark and a light variant that differ in their surface and text, and the dark one by default', () => {
        const dark = badgeSvg({ kind: 'score', score: 87 }, 'dark');
        const light = badgeSvg({ kind: 'score', score: 87 }, 'light');
        expect(badgeSvg({ kind: 'score', score: 87 })).toBe(dark);
        expect(dark).toContain('fill="#1C1C20"');
        expect(dark).toContain('<g fill="#FFFFFF"');
        expect(light).toContain('fill="#FFFFFF"');
        expect(light).toContain('<g fill="#1C1C20"');
    });

    it('reads the theme from the query, light only when asked', () => {
        expect(badgeThemeOf(new URLSearchParams('theme=light'))).toBe('light');
        expect(badgeThemeOf(new URLSearchParams('theme=dark'))).toBe('dark');
        expect(badgeThemeOf(new URLSearchParams('theme=<script>'))).toBe('dark');
        expect(badgeThemeOf(new URLSearchParams())).toBe('dark');
    });

    it('draws a neutral, empty ring and the word for a report that is expired, scanning, unscored or unreadable', () => {
        for (const [state, word] of [
            [{ kind: 'expired' }, 'Expired'],
            [{ kind: 'scanning' }, 'Scanning'],
            [{ kind: 'no_score' }, 'No score'],
            [{ kind: 'unavailable' }, 'Unavailable'],
        ] as const) {
            const svg = badgeSvg(state);
            expect(textOf(svg)).toEqual(['–', `HP ${word}`]);
            expect(svg).toContain('stroke="#8A8A93"');
            expect(svg).not.toContain('stroke-dasharray');
        }
    });

    it('contains neither a domain nor a script', () => {
        expect(badgeSvg({ kind: 'score', score: 100 })).not.toMatch(/<script|href=|http:\/\/(?!www\.w3\.org)/);
    });
});

describe('badge snippets', () => {
    const input = { origin: 'https://sitehp.app', locale: 'en', publicId: ID, score: 87, theme: 'dark' } as const;

    it('puts the image in a link to the report, in Markdown and in HTML', () => {
        const { markdown, html, imageUrl, reportUrl } = badgeSnippets(input);
        expect(imageUrl).toBe(`https://sitehp.app/badge/r/${ID}.svg`);
        expect(reportUrl).toBe(`https://sitehp.app/en/r/${ID}`);
        expect(markdown).toBe(`[![HP score 87, Good](${imageUrl})](${reportUrl})`);
        expect(html).toBe(`<a href="${reportUrl}"><img src="${imageUrl}" alt="HP score 87, Good" height="32"></a>`);
    });

    it('asks for the light badge only when the light one is chosen', () => {
        expect(badgeSnippets({ ...input, theme: 'light' }).imageUrl).toBe(`https://sitehp.app/badge/r/${ID}.svg?theme=light`);
        expect(badgeSnippets(input).imageUrl).not.toContain('theme');
    });
});
