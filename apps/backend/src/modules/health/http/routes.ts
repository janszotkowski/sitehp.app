import type { HealthResponse } from '@sitehp.app/core';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '@platform/http/types.ts';
import type { ReadinessProbe } from '@modules/health/ports.ts';

/** A dependency that has not answered by then counts as down: a readiness check must answer quickly, not hang with it. */
const PROBE_TIMEOUT_MS = 2000;

type ProbeResult = 'ok' | 'failed';

const withTimeout = async (check: () => Promise<unknown>): Promise<void> => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${PROBE_TIMEOUT_MS} ms`)), PROBE_TIMEOUT_MS);
    });
    try {
        await Promise.race([check(), timeout]);
    } finally {
        clearTimeout(timer);
    }
};

/**
 * `/health` is liveness: the process answers, nothing else is asked. `/ready` is readiness: 200 when every dependency answers
 * (the database, and Redis when it is configured), 503 otherwise, so a load balancer stops sending traffic while one is away.
 */
export const healthRoutes = ({ config, clock, startedAt }: AppDeps, probes: ReadonlyArray<ReadinessProbe> = []): Hono<AppEnv> => {
    const routes = new Hono<AppEnv>();

    routes.get('/health', (c) => {
        const now = clock.now();
        const body: HealthResponse = {
            status: 'ok',
            service: 'backend',
            version: config.APP_VERSION,
            uptimeSeconds: Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000)),
            time: now.toISOString(),
        };
        return c.json(body);
    });

    routes.get('/ready', async (c) => {
        const results = await Promise.all(
            probes.map(async ({ name, check }): Promise<[string, ProbeResult]> => {
                try {
                    await withTimeout(check);
                    return [name, 'ok'];
                } catch (error) {
                    c.get('logger').warn({ err: error, dependency: name }, 'not ready');
                    return [name, 'failed'];
                }
            }),
        );
        const ready = results.every(([, result]) => result === 'ok');
        c.header('Cache-Control', 'no-store');
        return c.json({ status: ready ? 'ready' : 'unavailable', checks: Object.fromEntries(results) }, ready ? 200 : 503);
    });

    return routes;
};
