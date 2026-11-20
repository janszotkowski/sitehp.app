import type { ErrorCode, ErrorResponse } from '@sitehp.app/core';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type ErrorDetail = { path: string; message: string };

/** A failure the API reports on purpose, with a stable code from the contract. */
export class AppError extends Error {
    readonly code: ErrorCode;
    readonly details: ErrorDetail[] | undefined;
    /** For `RATE_LIMITED`: seconds until a retry can succeed, sent as `Retry-After`. */
    readonly retryAfterSec: number | undefined;

    constructor(code: ErrorCode, message: string, details?: ErrorDetail[], retryAfterSec?: number) {
        super(message);
        this.name = 'AppError';
        this.code = code;
        this.details = details;
        this.retryAfterSec = retryAfterSec;
    }
}

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
    VALIDATION_FAILED: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    DOMAIN_BLOCKED: 403,
    RATE_LIMITED: 429,
    INTERNAL: 500,
};

export const statusOf = (code: ErrorCode): ContentfulStatusCode => {
    return STATUS[code];
};

export const errorBody = (code: ErrorCode, message: string, requestId: string | undefined, details?: ErrorDetail[]): ErrorResponse => {
    return {
        error: {
            code,
            message,
            ...(requestId === undefined ? {} : { requestId }),
            ...(details === undefined ? {} : { details }),
        },
    };
};
