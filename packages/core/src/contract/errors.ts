import * as z from 'zod/mini';

/**
 * Stable error codes of the HTTP API. The backend never returns user-facing
 * prose: clients map the code to a localized message. Adding a code is a
 * contract change; renaming or removing one is a breaking change (new `/v` version).
 */
export const ERROR_CODES = ['VALIDATION_FAILED', 'NOT_FOUND', 'RATE_LIMITED', 'UNAUTHORIZED', 'FORBIDDEN', 'CONFLICT', 'DOMAIN_BLOCKED', 'INTERNAL'] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorResponseSchema = z.object({
    error: z.object({
        code: errorCodeSchema,
        /** English, for logs and developers. Never shown to end users as is. */
        message: z.string(),
        requestId: z.optional(z.string()),
        /** Field-level problems for `VALIDATION_FAILED`. */
        details: z.optional(z.array(z.object({ path: z.string(), message: z.string() }))),
    }),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
