import { Hono } from 'hono';
import { healthRoutes } from '@modules/health/http/routes.ts';
import { scansRoutes } from '@modules/scans/http/routes.ts';
import { createBaseApp } from '@platform/http/app.ts';
import type { AppEnv } from '@platform/http/types.ts';
import type { Container } from '@composition/deps.ts';

/**
 * The composition root of the HTTP side: the only place that knows every
 * module. Modules never import each other; they are mounted here, under the
 * version prefix of the public contract.
 */
export const createApp = ({ deps, scans, probes }: Container): Hono<AppEnv> => {
    const app = createBaseApp(deps);

    const v1 = new Hono<AppEnv>();
    v1.route('/', healthRoutes(deps, probes));
    v1.route('/', scansRoutes(deps, scans));

    app.route('/v1', v1);
    return app;
};
