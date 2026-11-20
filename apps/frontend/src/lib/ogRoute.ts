import { publicIdSchema, type ScanSnapshot } from '@sitehp.app/core/browser';

/** `/og/r/<publicId>.png`, the share preview of one report. */
export const ogImagePathOf = (publicId: string): string => `/og/r/${publicId}.png`;

/** The report id a share preview path asks for, or `undefined` for any other path (or an id that cannot exist). */
export const ogReportIdOf = (pathname: string): string | undefined => {
    const match = /^\/og\/r\/([^/]+)\.png$/.exec(pathname);
    const id = match?.[1];
    return id !== undefined && publicIdSchema.safeParse(id).success ? id : undefined;
};

/** A finished scan never changes, so its picture is cached for good; a running one only briefly, until it has its score. */
export const ogCacheControl = (status: 'running' | 'completed' | 'failed'): string => (status === 'running' ? 'public, max-age=60' : 'public, max-age=31536000, immutable');

/** What a share preview is drawn from, so a cached picture is reused only while it would come out the same. */
export const ogCacheKey = (snapshot: Pick<ScanSnapshot, 'publicId' | 'status' | 'score' | 'lastEventId'>): string =>
    `${snapshot.publicId}:${snapshot.status}:${snapshot.score ?? '-'}:${snapshot.lastEventId ?? '-'}`;

/** A small least-recently-used map: reading an entry makes it the newest, and past `max` entries the oldest goes. */
export const createLru = <Value>(max: number): { get: (key: string) => Value | undefined; set: (key: string, value: Value) => void } => {
    const entries = new Map<string, Value>();
    return {
        get: (key) => {
            const value = entries.get(key);
            if (value === undefined) return undefined;
            entries.delete(key);
            entries.set(key, value);
            return value;
        },
        set: (key, value) => {
            entries.delete(key);
            entries.set(key, value);
            for (const oldest of entries.keys()) {
                if (entries.size <= max) break;
                entries.delete(oldest);
            }
        },
    };
};
