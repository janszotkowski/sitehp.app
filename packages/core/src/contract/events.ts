import * as z from 'zod/mini';

/**
 * The id of an event: its 1-based position in the log of its stream, as a decimal string.
 * Ordering and resuming (`Last-Event-ID`, `reduceScan`) compare ids as numbers, so an id of
 * any other shape (such as a Redis Streams id) is a contract violation, not an id to adopt.
 */
export const eventIdSchema = z.string().check(z.regex(/^[1-9]\d{0,14}$/));

/**
 * Envelope shared by every server-sent event: `{ id, type, ts, data }`.
 * `id` is the SSE event id, so a reconnect resumes with `Last-Event-ID`.
 * Scan events (`scan.started`, `check.completed`, …) are built with this
 * factory; the contract of each one lives next to the others in `core`.
 */
export const eventEnvelope = <Type extends string, Data extends z.ZodMiniType>(type: Type, data: Data) => {
    return z.object({
        id: eventIdSchema,
        type: z.literal(type),
        /** ISO 8601 time the event was produced. */
        ts: z.iso.datetime(),
        data,
    });
};
