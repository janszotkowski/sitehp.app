import * as z from 'zod/mini';

export const healthResponseSchema = z.object({
    status: z.literal('ok'),
    service: z.literal('backend'),
    version: z.string(),
    uptimeSeconds: z.int().check(z.nonnegative()),
    time: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
