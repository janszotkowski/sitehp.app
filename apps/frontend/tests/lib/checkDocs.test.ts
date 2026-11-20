import { CHECK_IDS } from '@sitehp.app/core';
import { describe, expect, it } from 'vitest';
import { checkDocs } from '@lib/checkDocs';

describe('check documentation links', () => {
    it('belong to a check the engine has', () => {
        for (const id of Object.keys(checkDocs)) expect(CHECK_IDS, id).toContain(id);
    });

    it('are plain https addresses with a source and a title', () => {
        for (const [id, links] of Object.entries(checkDocs)) {
            expect(links.length, id).toBeGreaterThan(0);
            for (const link of links) {
                expect(new URL(link.url).protocol, `${id}: ${link.url}`).toBe('https:');
                expect(link.source.length).toBeGreaterThan(0);
                expect(link.title.length).toBeGreaterThan(0);
            }
        }
    });

    it('do not list the same address twice for one check', () => {
        for (const [id, links] of Object.entries(checkDocs)) expect(new Set(links.map((link) => link.url)).size, id).toBe(links.length);
    });
});
