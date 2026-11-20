import { describe, expect, it } from 'vitest';
import { SCORE_BANDS, scoreBand, scoreColor, scoreColorHex } from '@src/score-color.ts';

describe('scoreBand', () => {
    it('puts the edges of every band in the right band', () => {
        expect(scoreBand(0)).toBe('critical');
        expect(scoreBand(39)).toBe('critical');
        expect(scoreBand(40)).toBe('poor');
        expect(scoreBand(59)).toBe('poor');
        expect(scoreBand(60)).toBe('fair');
        expect(scoreBand(79)).toBe('fair');
        expect(scoreBand(80)).toBe('good');
        expect(scoreBand(94)).toBe('good');
        expect(scoreBand(95)).toBe('excellent');
        expect(scoreBand(100)).toBe('excellent');
    });

    it('clamps out-of-range and invalid scores', () => {
        expect(scoreBand(-5)).toBe('critical');
        expect(scoreBand(250)).toBe('excellent');
        expect(scoreBand(Number.NaN)).toBe('critical');
    });

    it('knows every band', () => {
        expect(SCORE_BANDS).toEqual(['critical', 'poor', 'fair', 'good', 'excellent']);
    });
});

describe('scoreColor', () => {
    it('is deterministic', () => {
        expect(scoreColor(73)).toBe(scoreColor(73));
    });

    it('returns an oklch() color', () => {
        expect(scoreColor(84)).toMatch(/^oklch\(\d(\.\d+)? \d(\.\d+)? \d+(\.\d+)?\)$/);
    });

    it('differs between themes', () => {
        expect(scoreColor(84, 'dark')).not.toBe(scoreColor(84, 'light'));
    });

    it('changes continuously, with no jump between neighbouring scores', () => {
        const parse = (value: string) => value.match(/[\d.]+/g)?.map(Number) ?? [];
        for (let hp = 0; hp < 100; hp += 1) {
            const [l1 = 0, c1 = 0] = parse(scoreColor(hp));
            const [l2 = 0, c2 = 0] = parse(scoreColor(hp + 1));
            expect(Math.abs(l1 - l2)).toBeLessThan(0.05);
            expect(Math.abs(c1 - c2)).toBeLessThan(0.05);
        }
    });

    it('returns exactly the anchor color in the middle of a band', () => {
        // The ends of the scale hold the first and last anchor.
        expect(scoreColor(0, 'dark')).toBe(scoreColor(20, 'dark'));
        expect(scoreColor(100, 'dark')).toBe(scoreColor(98, 'dark'));
    });
});

describe('scoreColorHex', () => {
    it('gives the anchor colors back at their anchors, as #rrggbb', () => {
        expect(scoreColorHex(20, 'dark').toUpperCase()).toBe('#FF6B63');
        expect(scoreColorHex(87, 'dark').toUpperCase()).toBe('#3DD68C');
        expect(scoreColorHex(98, 'light').toUpperCase()).toBe('#0B9488');
    });

    it('is a plain hex color everywhere on the scale', () => {
        for (const hp of [0, 33, 50, 64, 79, 95, 100]) expect(scoreColorHex(hp)).toMatch(/^#[0-9a-f]{6}$/);
    });
});

describe('the light anchors as graphics', () => {
    const luminance = (hex: string): number => {
        const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
            number,
            number,
            number,
        ];
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string): number => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
        return (hi + 0.05) / (lo + 0.05);
    };

    it('reach 3 : 1 on the light page and on a card (WCAG 1.4.11), all along the scale', () => {
        for (let hp = 0; hp <= 100; hp += 1) {
            for (const surface of ['#fbfbfd', '#ffffff']) expect(contrast(scoreColorHex(hp, 'light'), surface), `${hp} on ${surface}`).toBeGreaterThanOrEqual(3);
        }
    });
});
