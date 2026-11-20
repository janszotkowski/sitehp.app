import { CHECK_IDS } from '@sitehp.app/core';
import { describe, expect, it } from 'vitest';
import { checkText, checkTexts } from '@lib/checkMessages';

describe('check texts', () => {
    it('cover every check in the registry, and nothing else', () => {
        expect(Object.keys(checkTexts).sort()).toEqual([...CHECK_IDS].sort());
    });

    it.each([...CHECK_IDS])('give %s a title and an explanation of real length', (id) => {
        const text = checkText(id, 'en');
        expect(text.title.length).toBeGreaterThan(1);
        expect(text.explanation.length).toBeGreaterThan(40);
    });

    // F3-5: written for a site owner, not a developer: what it is, why it matters, what happens without it, in two or three sentences.
    it.each([...CHECK_IDS])('explain %s in two or three plain sentences', (id) => {
        const { explanation } = checkText(id, 'en');
        const sentences = explanation.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.length > 0);
        expect(sentences.length, explanation).toBeGreaterThanOrEqual(2);
        expect(sentences.length, explanation).toBeLessThanOrEqual(3);
        expect(explanation.length, explanation).toBeLessThanOrEqual(420);
    });

    it('falls back to the id for a check the frontend does not know yet, instead of crashing', () => {
        expect(checkText('future_check', 'en')).toEqual({ title: 'future_check', explanation: '' });
    });
});
