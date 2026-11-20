import { afterEach, describe, expect, it, vi } from 'vitest';

const showBeta = async (): Promise<boolean> => {
    vi.resetModules();
    return (await import('@config/site')).SHOW_BETA;
};

describe('SHOW_BETA', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('is on by default and off only when VITE_SHOW_BETA is "false"', async () => {
        vi.stubEnv('VITE_SHOW_BETA', '');
        expect(await showBeta()).toBe(true);
        vi.stubEnv('VITE_SHOW_BETA', 'true');
        expect(await showBeta()).toBe(true);
        vi.stubEnv('VITE_SHOW_BETA', 'false');
        expect(await showBeta()).toBe(false);
    });
});
