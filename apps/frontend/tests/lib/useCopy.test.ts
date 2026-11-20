import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '@lib/useCopy';

describe('copyText', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reports a copy that worked', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        expect(await copyText('hello')).toBe(true);
        expect(writeText).toHaveBeenCalledWith('hello');
    });

    it('reports a refusal and a missing clipboard as a failure, never silently', async () => {
        vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('NotAllowedError')) } });
        expect(await copyText('hello')).toBe(false);
        vi.stubGlobal('navigator', {});
        expect(await copyText('hello')).toBe(false);
    });
});
