import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScoreRing, arcLength } from '@components/ScoreRing';

describe('arcLength', () => {
    const circumference = 2 * Math.PI * 90;

    it('is empty at 0, the full circle at 100 and proportional in between', () => {
        expect(arcLength(0)).toBe(0);
        expect(arcLength(100)).toBeCloseTo(circumference, 10);
        expect(arcLength(50)).toBeCloseTo(circumference / 2, 10);
    });

    it('never goes outside the circle, whatever the spring does', () => {
        expect(arcLength(-5)).toBe(0);
        expect(arcLength(140)).toBeCloseTo(circumference, 10);
    });
});

describe('ScoreRing on the server', () => {
    it('renders the final score even when it fills in as an entrance, never a 0', () => {
        const html = renderToString(createElement(ScoreRing, { score: 84, label: 'HP 84', animateIn: true }));
        expect(html).toContain('>84</span>');
        expect(html).not.toContain('>0</span>');
    });
});
