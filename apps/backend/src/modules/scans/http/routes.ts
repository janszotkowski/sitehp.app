import { createScanRequestSchema, publicIdSchema, type CreateScanResponse } from '@sitehp.app/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '@platform/http/types.ts';
import { AppError } from '@platform/errors.ts';
import { clientIp } from '@platform/http/client-ip.ts';
import { callerLimits } from '@platform/net/ip.ts';
import { validate } from '@platform/http/validate.ts';
import { sseResponse } from '@platform/sse.ts';
import type { ScansService } from '@modules/scans/application/scans-service.ts';

const paramsSchema = z.object({ publicId: publicIdSchema });
/** A UUID from the frontend, or any similar opaque token: the shape is kept narrow because the key is held in memory. */
const idempotencyKeySchema = z.object({
    'idempotency-key': z
        .string()
        .regex(/^[A-Za-z0-9_-]{8,128}$/)
        .optional(),
});

/**
 * Starts a scan, reads its state and follows it live. A report is reachable only
 * by its unguessable id, so nothing here lists, searches or enumerates scans, and
 * every response asks search engines to stay away.
 */
export const scansRoutes = ({ config, stopping }: AppDeps, scans: ScansService): Hono<AppEnv> => {
    const routes = new Hono<AppEnv>();
    // Event streams each caller (and each IPv6 /48) holds open: every one is a socket and a follower, so one address cannot hold thousands.
    const openStreams = new Map<string, number>();
    // Every stream of this app, for MAX_OPEN_STREAMS.
    const streams = { open: 0 };

    routes.use('/scans/*', async (c, next) => {
        await next();
        c.header('X-Robots-Tag', 'noindex, nofollow');
    });

    routes.post('/scans', validate('header', idempotencyKeySchema), validate('json', createScanRequestSchema), async (c) => {
        const { url, fresh, checks } = c.req.valid('json');
        const snapshot = await scans.create(url, clientIp(c, config), c.req.valid('header')['idempotency-key'], fresh === true, checks);
        const body: CreateScanResponse = { publicId: snapshot.publicId, snapshot };
        return c.json(body, 201);
    });

    routes.get('/scans/:publicId', validate('param', paramsSchema), async (c) => {
        const snapshot = await scans.get(c.req.valid('param').publicId);
        // The state changes while a scan runs, so it must never be cached.
        c.header('Cache-Control', 'no-store');
        return c.json(snapshot);
    });

    routes.get('/scans/:publicId/events', validate('param', paramsSchema), async (c) => {
        const { publicId } = c.req.valid('param');
        // Unknown id: a plain 404 before any stream starts.
        await scans.get(publicId);
        const client = clientIp(c, config);
        const keys = callerLimits(client, config.SSE_MAX_STREAMS_PER_IP);
        const open = openStreams.get(client) ?? 0;
        if (keys.some(({ key, limit }) => (openStreams.get(key) ?? 0) >= limit)) {
            c.get('logger').warn({ publicId, open, ...(config.LOG_CLIENT_IP ? { client } : {}) }, 'stream refused');
            throw new AppError('RATE_LIMITED', 'Too many open event streams from your address. Close one and try again.', undefined, 5);
        }
        for (const { key } of keys) openStreams.set(key, (openStreams.get(key) ?? 0) + 1);
        const resumeFrom = c.req.header('last-event-id');
        // Only an id in the shape the stream gives out is logged; anything else a caller sends is not copied into the log.
        c.get('logger').info(
            { publicId, resumeFrom: resumeFrom === undefined ? null : /^\d{1,12}$/.test(resumeFrom) ? resumeFrom : '(invalid)', openFromCaller: open + 1, ...(config.LOG_CLIENT_IP ? { client } : {}) },
            'stream opened',
        );
        const release = () => {
            for (const { key } of keys) {
                const left = (openStreams.get(key) ?? 1) - 1;
                if (left > 0) openStreams.set(key, left);
                else openStreams.delete(key);
            }
        };
        return sseResponse(
            c,
            async function* ({ lastEventId, signal }) {
                for await (const event of scans.follow(publicId, lastEventId, signal)) {
                    yield { id: event.id, event: event.type, data: event };
                }
            },
            { heartbeatMs: config.SSE_HEARTBEAT_MS, signal: stopping, logger: c.get('logger'), onClose: release, maxOpen: config.MAX_OPEN_STREAMS, streams },
        );
    });

    return routes;
};
