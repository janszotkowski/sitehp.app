import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '@composition/app.ts';
import { buildContainer, type ContainerOverrides } from '@composition/deps.ts';
import { healthRoutes } from '@modules/health/http/routes.ts';
import type { ReadinessProbe } from '@modules/health/ports.ts';
import { startHeartbeat } from '@platform/heartbeat.ts';
import { createBaseApp } from '@platform/http/app.ts';
import type { AppEnv } from '@platform/http/types.ts';
import { fakeFetcher, FIXED_TIME, testConfig, testContainer, testDatabase } from '@tests/helpers.ts';

const appWith = (probes: ReadinessProbe[]) => {
    const { deps } = testContainer();
    const app = createBaseApp(deps);
    const v1 = new Hono<AppEnv>();
    v1.route('/', healthRoutes(deps, probes));
    app.route('/v1', v1);
    return app;
};

describe('GET /v1/ready', () => {
    afterEach(() => void vi.useRealTimers());

    it('is ready with nothing to ask (scans in memory, no Redis)', async () => {
        const response = await createApp(testContainer()).request('/v1/ready');
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'ready', checks: {} });
    });

    it('asks the database, and Redis when it is configured', async () => {
        const database = await testDatabase();
        const redis = { ping: () => Promise.resolve('PONG'), eval: () => Promise.resolve([0, 0]) } as unknown as NonNullable<ContainerOverrides['redis']>;
        const container = buildContainer(testConfig(), { clock: { now: () => FIXED_TIME }, fetcher: fakeFetcher(), database, redis });
        const response = await createApp(container).request('/v1/ready');
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'ready', checks: { database: 'ok', redis: 'ok' } });
        await database.close();
    });

    it('answers 503 and names the dependency that is down', async () => {
        const response = await appWith([
            { name: 'database', check: () => Promise.resolve() },
            { name: 'redis', check: () => Promise.reject(new Error('connection refused')) },
        ]).request('/v1/ready');
        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({ status: 'unavailable', checks: { database: 'ok', redis: 'failed' } });
    });

    it('counts a dependency that does not answer within 2 s as down', async () => {
        vi.useFakeTimers();
        const pending = appWith([{ name: 'database', check: () => new Promise(() => undefined) }]).request('/v1/ready');
        await vi.advanceTimersByTimeAsync(2000);
        const response = await pending;
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ checks: { database: 'failed' } });
    });

    it('leaves /v1/health as liveness: 200 even when a dependency is down', async () => {
        const response = await appWith([{ name: 'database', check: () => Promise.reject(new Error('down')) }]).request('/v1/health');
        expect(response.status).toBe(200);
    });
});

describe('the worker heartbeat', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sitehp-heartbeat-'));
    afterEach(() => rmSync(directory, { recursive: true, force: true }));

    it('writes the time at start and again on every beat, and stops when told', async () => {
        const file = join(directory, 'beat');
        const at = { time: FIXED_TIME.getTime() };
        const errors: unknown[] = [];
        const stop = startHeartbeat(file, { now: () => new Date(at.time) }, { error: (fields: unknown) => void errors.push(fields) } as never, 20);
        await vi.waitFor(() => expect(readFileSync(file, 'utf8')).toBe(`${FIXED_TIME.toISOString()}\n`));
        expect(Date.now() - statSync(file).mtimeMs).toBeLessThan(60_000);

        at.time += 15_000;
        await vi.waitFor(() => expect(readFileSync(file, 'utf8')).toBe(`${new Date(at.time).toISOString()}\n`));

        stop();
        await new Promise((resolve) => setTimeout(resolve, 30));
        at.time += 15_000;
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(readFileSync(file, 'utf8')).not.toBe(`${new Date(at.time).toISOString()}\n`);
        expect(errors).toEqual([]);
    });
});
