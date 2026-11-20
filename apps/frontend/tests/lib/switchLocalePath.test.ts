import { describe, expect, it } from 'vitest';
import { asLocale, isLocale, switchLocalePath } from '@lib/i18n/switchLocalePath';

describe('locale helpers', () => {
    it('recognises only supported languages', () => {
        expect(isLocale('en')).toBe(true);
        expect(isLocale('xx')).toBe(false);
        expect(asLocale('xx')).toBe('en');
    });

    it('keeps the user on the same page without a trailing slash', () => {
        expect(switchLocalePath('/en/pricing', 'en')).toBe('/en/pricing');
        expect(switchLocalePath('/en', 'en')).toBe('/en');
    });
});
