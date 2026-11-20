import { SCAN_FAILURE_REASONS } from '@sitehp.app/core';
import { describe, expect, it } from 'vitest';
import { failureReasonMessage } from '@lib/scanFailure';

describe('failureReasonMessage', () => {
    it.each([...SCAN_FAILURE_REASONS])('has a message for %s, and not the generic one unless it is the generic reason', (reason) => {
        const text = failureReasonMessage(reason, 'en');
        expect(text.length).toBeGreaterThan(20);
        if (reason !== 'internal_error') expect(text).not.toBe(failureReasonMessage('internal_error', 'en'));
    });

    it('answers a missing reason with the generic message instead of nothing', () => {
        expect(failureReasonMessage(null, 'en')).toBe(failureReasonMessage('internal_error', 'en'));
    });

    it('gives every reason its own message', () => {
        const texts = SCAN_FAILURE_REASONS.map((reason) => failureReasonMessage(reason, 'en'));
        expect(new Set(texts).size).toBe(texts.length);
    });
});
