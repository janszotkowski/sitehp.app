import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '@config/env.ts';

describe('loadConfig', () => {
    it('applies safe defaults', () => {
        const loaded = loadConfig({});
        expect(loaded.ok).toBe(true);
        if (loaded.ok) {
            expect(loaded.config).toMatchObject({ NODE_ENV: 'development', PORT: 4000, LOG_LEVEL: 'info', APP_VERSION: 'dev', SSE_HEARTBEAT_MS: 15000 });
            expect(loaded.config.CORS_ORIGINS).toEqual(['http://localhost:3000']);
        }
    });

    it('has safe fetch limits by default and refuses silly ones', () => {
        const loaded = loadConfig({});
        expect(loaded.ok && loaded.config).toMatchObject({ FETCH_TIMEOUT_MS: 10_000, FETCH_MAX_BYTES: 1_048_576, FETCH_MAX_REDIRECTS: 5 });
        for (const bad of [{ FETCH_TIMEOUT_MS: '1' }, { FETCH_TIMEOUT_MS: '9999999' }, { FETCH_MAX_BYTES: '1' }, { FETCH_MAX_BYTES: '999999999' }, { FETCH_MAX_REDIRECTS: '99' }]) {
            expect(loadConfig(bad).ok).toBe(false);
        }
    });

    it('trusts no proxy by default, and refuses counted proxies without the ranges they connect from', () => {
        const loaded = loadConfig({});
        expect(loaded.ok && loaded.config).toMatchObject({ TRUSTED_PROXY_HOPS: 0, TRUSTED_PROXY_CIDRS: [], NAT64_PREFIXES: [] });
        expect(loadConfig({ TRUSTED_PROXY_HOPS: '1' })).toMatchObject({ ok: false, problems: [expect.stringContaining('TRUSTED_PROXY_CIDRS')] });
        const behindProxy = loadConfig({ TRUSTED_PROXY_HOPS: '1', TRUSTED_PROXY_CIDRS: ' 10.0.0.0/8, fd00::/8 ,' });
        expect(behindProxy.ok && behindProxy.config.TRUSTED_PROXY_CIDRS.map((cidr) => cidr.family)).toEqual([4, 6]);
        expect(loadConfig({ TRUSTED_PROXY_CIDRS: '10.0.0.1' }).ok).toBe(false);
    });

    it('takes NAT64 prefixes as IPv6 /96 only', () => {
        expect(loadConfig({ NAT64_PREFIXES: '2a00:1:64::/96' }).ok).toBe(true);
        for (const bad of ['2a00:1:64::/64', '10.0.0.0/8', 'nonsense']) expect(loadConfig({ NAT64_PREFIXES: bad }).ok).toBe(false);
    });

    it('requires the CORS origins in production instead of allowing localhost', () => {
        const production = {
            NODE_ENV: 'production',
            DATABASE_URL: 'postgres://u:p@localhost:5432/sitehp',
            REDIS_URL: 'redis://localhost:6379',
        };
        expect(loadConfig(production)).toMatchObject({ ok: false, problems: [expect.stringContaining('CORS_ORIGINS')] });
        expect(loadConfig({ ...production, CORS_ORIGINS: ' , ' }).ok).toBe(false);
        const named = loadConfig({ ...production, CORS_ORIGINS: 'https://sitehp.app' });
        expect(named.ok && named.config.CORS_ORIGINS).toEqual(['https://sitehp.app']);
    });

    it('splits and trims the CORS origins', () => {
        const loaded = loadConfig({ CORS_ORIGINS: ' https://sitehp.app , https://www.sitehp.app ,' });
        expect(loaded.ok && loaded.config.CORS_ORIGINS).toEqual(['https://sitehp.app', 'https://www.sitehp.app']);
    });

    it('reports every problem by variable name instead of failing later', () => {
        const loaded = loadConfig({ PORT: '99999', LOG_LEVEL: 'loud' });
        expect(loaded.ok).toBe(false);
        if (!loaded.ok) {
            expect(loaded.problems.some((problem) => problem.startsWith('PORT'))).toBe(true);
            expect(loaded.problems.some((problem) => problem.startsWith('LOG_LEVEL'))).toBe(true);
        }
    });
});

describe('turbo.json', () => {
    /** Turbo runs tasks in strict mode: a variable it is not told about never reaches the process. */
    const passThrough = (task: string): string[] => {
        const turbo = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../turbo.json'), 'utf8')) as { tasks: Record<string, { passThroughEnv?: string[] }> };
        return turbo.tasks[task]?.passThroughEnv ?? [];
    };
    const matches = (patterns: string[], name: string): boolean => patterns.some((pattern) => (pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern));

    it.each(['start', 'dev'])('lets every backend setting through to `pnpm %s`', (task) => {
        const loaded = loadConfig({});
        if (!loaded.ok) throw new Error('the defaults do not load');
        const missing = Object.keys(loaded.config).filter((name) => !matches(passThrough(task), name));
        expect(missing).toEqual([]);
    });
});
