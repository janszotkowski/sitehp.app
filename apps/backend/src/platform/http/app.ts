import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { AppError, errorBody, statusOf } from '@platform/errors.ts';
import { clientIp, socketAddress } from '@platform/http/client-ip.ts';
import type { AppDeps, AppEnv } from './types.ts';

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** A report's id is the capability to read it, so a log keeps only its first 4 characters: enough to tell requests apart. */
const maskReportIds = (path: string): string => path.replace(/(\/scans\/[^/]{4})[^/]+/, '$1…');

/**
 * The HTTP shell every module plugs into: request context, access log, CORS,
 * security headers and one place that turns failures into the error contract.
 * Routes are mounted by the composition root, not here.
 */
export const createBaseApp = ({ config, logger }: AppDeps): Hono<AppEnv> => {
    const app = new Hono<AppEnv>();

    app.use(async (c, next) => {
        // A caller-supplied id is accepted only in a safe shape: it ends up in logs.
        const incoming = c.req.header('x-request-id');
        const requestId = incoming !== undefined && REQUEST_ID.test(incoming) ? incoming : randomUUID();
        c.set('requestId', requestId);
        c.set('logger', logger.child({ requestId }));
        c.header('X-Request-Id', requestId);

        const startedAt = performance.now();
        await next();
        const errorCode = c.get('errorCode');
        const userAgent = c.req.header('user-agent');
        const origin = c.req.header('origin');
        c.get('logger').info(
            {
                method: c.req.method,
                // Caller-controlled text is cut short: a 16 KB URL or header must not become a 16 KB log line.
                path: maskReportIds(c.req.path.slice(0, 200)),
                // `/*` is a middleware's pattern: no route matched (404) or a middleware answered (a body too large).
                route: c.req.routePath === '/*' ? null : c.req.routePath,
                status: c.res.status,
                durationMs: Math.round(performance.now() - startedAt),
                ...(errorCode === undefined ? {} : { errorCode }),
                ...(userAgent === undefined ? {} : { userAgent: userAgent.slice(0, 200) }),
                ...(origin === undefined ? {} : { origin: origin.slice(0, 200) }),
                // The raw inputs too, so a proxy chain can be checked against what `client` makes of it.
                ...(config.LOG_CLIENT_IP
                    ? {
                          client: clientIp(c, config),
                          peer: socketAddress(c),
                          forwardedFor: c.req.header('x-forwarded-for')?.slice(0, 200),
                          realIp: c.req.header('x-real-ip')?.slice(0, 64),
                      }
                    : {}),
            },
            'request',
        );
    });

    app.use(secureHeaders());

    app.use(
        cors({
            origin: (origin) => (config.CORS_ORIGINS.includes(origin) ? origin : null),
            // No cookies and no credentials until there is sign-in: a cross-origin caller gets exactly what an anonymous one gets.
            // Only the methods some route answers; widen both together with the routes that need them.
            allowHeaders: ['Content-Type', 'Last-Event-ID', 'X-Request-Id', 'Idempotency-Key'],
            allowMethods: ['GET', 'POST'],
            exposeHeaders: ['X-Request-Id', 'Retry-After'],
            maxAge: 600,
        }),
    );

    // Requests carry small JSON documents; anything bigger is refused before it is read.
    app.use(
        bodyLimit({
            maxSize: 16 * 1024,
            onError: (c) => {
                c.set('errorCode', 'VALIDATION_FAILED');
                return c.json(errorBody('VALIDATION_FAILED', 'The request body is too large.', c.get('requestId')), statusOf('VALIDATION_FAILED'));
            },
        }),
    );

    app.notFound((c) => {
        c.set('errorCode', 'NOT_FOUND');
        return c.json(errorBody('NOT_FOUND', 'No such route.', c.get('requestId')), statusOf('NOT_FOUND'));
    });

    app.onError((error, c) => {
        const requestId = c.get('requestId');
        if (error instanceof AppError) {
            c.set('errorCode', error.code);
            if (error.retryAfterSec !== undefined) c.header('Retry-After', String(error.retryAfterSec));
            return c.json(errorBody(error.code, error.message, requestId, error.details), statusOf(error.code));
        }
        // Framework-level client errors, such as malformed JSON, are the caller's mistake.
        if (error instanceof HTTPException && error.status < 500) {
            c.set('errorCode', 'VALIDATION_FAILED');
            return c.json(errorBody('VALIDATION_FAILED', 'The request is not valid.', requestId), statusOf('VALIDATION_FAILED'));
        }
        // Anything else is a bug: log it with the stack, tell the client nothing about it.
        c.set('errorCode', 'INTERNAL');
        c.get('logger').error({ err: error }, 'unhandled error');
        return c.json(errorBody('INTERNAL', 'Something went wrong.', requestId), statusOf('INTERNAL'));
    });

    return app;
};
