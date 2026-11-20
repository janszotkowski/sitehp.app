import { CHECK_IDS, CATEGORY_WEIGHT } from '@sitehp.app/core';
import { describe, expect, it } from 'vitest';
import { methodology, plannedCategories } from '@lib/methodology';

describe('methodology', () => {
    it('lists every check of the registry exactly once', () => {
        const ids = methodology().flatMap((category) => category.groups.flatMap((group) => group.checks.map((check) => check.id)));
        expect(ids.sort()).toEqual([...CHECK_IDS].sort());
    });

    it('counts the checks of each category and carries its weight', () => {
        for (const category of methodology()) {
            expect(category.count).toBe(category.groups.reduce((sum, group) => sum + group.checks.length, 0));
            expect(category.weight).toBe(CATEGORY_WEIGHT[category.category]);
        }
    });

    it('gives each live category its real share of the HP while the planned ones have no checks', () => {
        const shares = Object.fromEntries(methodology().map((category) => [category.category, category.share]));
        expect(Object.keys(shares)).toEqual(['security', 'speed', 'seo', 'agent']);
        expect(shares.security).toBeCloseTo(40 / 95);
        expect(shares.speed).toBeCloseTo(15 / 95);
        expect(shares.seo).toBeCloseTo(30 / 95);
        expect(shares.agent).toBeCloseTo(10 / 95);
    });

    it('names the weighted categories that have no check yet as planned', () => {
        const live = methodology().map((category) => category.category);
        expect(live).toEqual(['security', 'speed', 'seo', 'agent']);
        expect(plannedCategories()).toEqual(['privacy']);
    });
});
