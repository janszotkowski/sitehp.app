import { pino, type DestinationStream, type Logger } from 'pino';
import type { Config } from '@config/env.ts';

export type { Logger };

/**
 * Structured JSON to stdout, nothing else: no files, no shipping from the
 * application (Alloy collects container logs). `level` is written as a word so
 * it filters well in Loki. Secrets are redacted by path and tests keep it that way.
 */
export const createLogger = (config: Pick<Config, 'LOG_LEVEL'>, service = 'api', destination?: DestinationStream): Logger => {
    return pino(
        {
            level: config.LOG_LEVEL,
            base: { service },
            messageKey: 'msg',
            timestamp: pino.stdTimeFunctions.isoTime,
            formatters: { level: (label) => ({ level: label }) },
            redact: {
                paths: ['req.headers.authorization', 'req.headers.cookie', 'headers.authorization', 'headers.cookie', '*.apiKey', '*.token', '*.password', '*.email'],
                censor: '[redacted]',
            },
        },
        destination,
    );
};

/**
 * An address as a log shows it: the host and the length of the path. Never the path itself (it can carry a token, `/magic/<token>`, or a
 * session, `;jsessionid=`), the query or the fragment: the report with the full address is deleted after 30 days, a log line may not be.
 */
export const urlForLog = (href: string): { host: string; pathLength: number } => {
    try {
        const url = new URL(href);
        return { host: url.hostname, pathLength: url.pathname.length };
    } catch {
        return { host: '(invalid)', pathLength: 0 };
    }
};
