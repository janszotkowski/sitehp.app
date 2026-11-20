import { describe, expect, it } from 'vitest';
import { isScanShortcut, shortcutLabel } from '@lib/scanShortcut';

const key = (overrides: Partial<Parameters<typeof isScanShortcut>[0]>) => ({ key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...overrides });

describe('isScanShortcut', () => {
    it('accepts Cmd+K and Ctrl+K, in either case', () => {
        expect(isScanShortcut(key({ metaKey: true }))).toBe(true);
        expect(isScanShortcut(key({ ctrlKey: true }))).toBe(true);
        expect(isScanShortcut(key({ ctrlKey: true, key: 'K' }))).toBe(true);
    });

    it('ignores a plain K, another key and a chord with another modifier', () => {
        expect(isScanShortcut(key({}))).toBe(false);
        expect(isScanShortcut(key({ metaKey: true, key: 'j' }))).toBe(false);
        expect(isScanShortcut(key({ metaKey: true, shiftKey: true }))).toBe(false);
        expect(isScanShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false);
    });
});

describe('shortcutLabel', () => {
    it('names the key the person has', () => {
        expect(shortcutLabel('MacIntel')).toBe('⌘K');
        expect(shortcutLabel('iPhone')).toBe('⌘K');
        expect(shortcutLabel('Win32')).toBe('Ctrl K');
        expect(shortcutLabel('Linux x86_64')).toBe('Ctrl K');
    });
});
