import { CHECK_IDS, TECHNOLOGIES } from '@sitehp.app/core';
import { describe, expect, it } from 'vitest';
import { fixGuides, guideTabs } from '@lib/fixGuides';

describe('fix guides', () => {
    it('belong to checks of the registry, and the platforms are known', () => {
        for (const [id, entry] of Object.entries(fixGuides)) {
            expect(CHECK_IDS, id).toContain(id);
            for (const platform of Object.keys(entry.platforms ?? {})) expect(TECHNOLOGIES as readonly string[], `${id}/${platform}`).toContain(platform);
        }
    });

    it.each(Object.entries(fixGuides))('give %s real steps, and a snippet that is not empty', (id, entry) => {
        for (const guide of [entry.generic, ...Object.values(entry.platforms ?? {})]) {
            expect(guide.steps.length, id).toBeGreaterThanOrEqual(1);
            expect(guide.steps.length, id).toBeLessThanOrEqual(5);
            for (const step of guide.steps) expect(step.en.length, id).toBeGreaterThan(10);
            if (guide.snippet !== undefined) expect(guide.snippet.code.trim().length, id).toBeGreaterThan(5);
        }
    });

    it.each(Object.entries(fixGuides))('give %s Czech text for every English one', (id, entry) => {
        for (const guide of [entry.generic, ...Object.values(entry.platforms ?? {})]) {
            for (const text of [...guide.steps, ...(guide.risk === undefined ? [] : [guide.risk])]) {
                expect(text.cs.trim().length, `${id}: ${text.en}`).toBeGreaterThan(5);
                expect(text.cs, id).not.toBe(text.en);
            }
        }
    });

    it('resolve to plain strings in the page language', () => {
        const [en] = guideTabs('hsts', [], 'en');
        const [cs] = guideTabs('hsts', [], 'cs');
        expect(en?.guide.steps[0]).toBe('Make your server send the Strict-Transport-Security header with every page.');
        expect(cs?.guide.steps[0]).toBe('Nastavte server tak, aby s každou stránkou posílal hlavičku Strict-Transport-Security.');
        expect(cs?.guide.snippet).toEqual(en?.guide.snippet);
        expect(typeof cs?.guide.risk).toBe('string');
    });

    // A guide's snippet is a template: it must not quote a real site, so an example host is the only one allowed.
    it('never carry a real host name in a snippet, only example.com and the standards themselves', () => {
        for (const [id, entry] of Object.entries(fixGuides)) {
            for (const guide of [entry.generic, ...Object.values(entry.platforms ?? {})]) {
                const hosts = [...(guide.snippet?.code.matchAll(/https?:\/\/([a-z0-9.-]+)/gi) ?? [])].map((match) => match[1]);
                for (const host of hosts) expect(host, id).toMatch(/^(?:(?:[a-z0-9-]+\.)*example\.com|schema\.org|www\.sitemaps\.org)$/);
            }
        }
    });

    it('opens the detected platform first, then the guide for any site, then the rest', () => {
        const ids = (detected: Parameters<typeof guideTabs>[1]) => guideTabs('hsts', detected, 'en').map((tab) => tab.id);
        expect(ids([])[0]).toBe('generic');
        expect(ids(['nginx', 'cloudflare']).slice(0, 3)).toEqual(['nginx', 'cloudflare', 'generic']);
        expect(ids(['shopify'])[0]).toBe('generic');
    });

    it('has no tabs for a check without a guide', () => {
        expect(guideTabs('ttfb', ['nginx'], 'en')).toEqual([]);
    });
});
