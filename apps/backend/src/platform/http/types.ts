import type { Config } from '@config/env.ts';
import type { Logger } from '@platform/logger.ts';
import type { Clock } from '@platform/ports.ts';

/** What every route may depend on. Modules receive it from the composition root. */
export type AppDeps = {
    config: Config;
    logger: Logger;
    clock: Clock;
    startedAt: Date;
    /** Aborted when the process shuts down: long-lived responses (SSE) end on it. */
    stopping: AbortSignal;
};

/** Per-request values set by the request-context middleware. */
export type AppEnv = {
    Variables: {
        requestId: string;
        logger: Logger;
        /** The API error code of a failed request, for the access log. */
        errorCode?: string;
    };
};
