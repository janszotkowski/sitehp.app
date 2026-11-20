import { z } from 'zod';
import { parseBlockList } from '@platform/net/blocked-hosts.ts';
import { parseCidr, type Cidr } from '@platform/net/ip.ts';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/**
 * Every setting the backend reads from the environment, validated once at
 * start-up. Nothing else reads `process.env`: a missing or malformed value
 * stops the process with a readable message instead of failing later.
 */
/** A block list setting; an entry that is not a domain name is a configuration error, not an entry that silently never matches. */
const blockList = (value: string, ctx: z.RefinementCtx): string[] => {
    try {
        return parseBlockList(value);
    } catch (error) {
        ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) });
        return z.NEVER;
    }
};

/** A comma-separated list of address ranges; `nat64` takes IPv6 /96 prefixes only, the one size the embedded IPv4 address is read from. */
const cidrList =
    (kind: 'any' | 'nat64') =>
    (value: string, ctx: z.RefinementCtx): Cidr[] => {
        const entries = value
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry !== '');
        const cidrs: Cidr[] = [];
        for (const entry of entries) {
            const cidr = parseCidr(entry);
            if (cidr === undefined || (kind === 'nat64' && (cidr.family !== 6 || cidr.bits !== 96))) {
                ctx.addIssue({ code: 'custom', message: `${entry} is not ${kind === 'nat64' ? 'an IPv6 /96 prefix' : 'an address range (10.0.0.0/8, fd00::/8)'}` });
                return z.NEVER;
            }
            cidrs.push(cidr);
        }
        return cidrs;
    };

const envSchema = z
    .object({
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
        HOST: z.string().min(1).default('0.0.0.0'),
        PORT: z.coerce.number().int().min(1).max(65535).default(4000),
        LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
        /** Write the caller's address into the access log, the scan log and the stream log. Off by default: an address is personal data, and the privacy policy must say so when this is on. */
        LOG_CLIENT_IP: z
            .enum(['true', 'false'])
            .default('false')
            .transform((value) => value === 'true'),
        /** Comma-separated origins allowed to call the API from a browser (CORS). `http://localhost:3000` when unset, except in production, which must name them. */
        CORS_ORIGINS: z
            .string()
            .optional()
            .transform((value) =>
                value
                    ?.split(',')
                    .map((origin) => origin.trim())
                    .filter((origin) => origin !== ''),
            ),
        APP_VERSION: z.string().min(1).default('dev'),
        /** Fetching a stranger's site: the whole fetch, redirects included. */
        FETCH_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(10_000),
        /** Bytes read from the final response; the rest is dropped. */
        FETCH_MAX_BYTES: z.coerce.number().int().min(1024).max(10_485_760).default(1_048_576),
        FETCH_MAX_REDIRECTS: z.coerce.number().int().min(0).max(10).default(5),
        /** Pause before each check, so a person can watch a scan fill in during development. Keep 0 in production. */
        SCAN_STEP_DELAY_MS: z.coerce.number().int().min(0).max(10_000).default(0),
        /** Scans one address may start per window. Each one makes the scanner fetch a stranger's site, so this is also what protects that site. */
        SCAN_LIMIT_PER_IP: z.coerce.number().int().min(1).max(100_000).default(20),
        /** Scans of one domain per window, from anyone: the cap on how hard the scanner can hit a single site. */
        SCAN_LIMIT_PER_DOMAIN: z.coerce.number().int().min(1).max(100_000).default(10),
        SCAN_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(86_400_000).default(3_600_000),
        /** A scan of the same address started this recently is handed out again instead of fetching the site anew (unless asked `fresh`); 0 turns it off. */
        SCAN_REUSE_MS: z.coerce.number().int().min(0).max(86_400_000).default(600_000),
        /** The whole scan, from the first fetch to the last check: one still going after this long is stopped and failed as `timeout`, so no report waits for ever. */
        SCAN_DEADLINE_MS: z.coerce.number().int().min(10_000).max(600_000).default(120_000),
        /** Scans run at once in this process; the rest wait their turn in the queue. */
        SCAN_MAX_CONCURRENT: z.coerce.number().int().min(1).max(100).default(8),
        /** How long a report stays readable before it is deleted with its log: 30 days. The list of scanned domains is kept for good. */
        SCAN_RETENTION_MS: z.coerce
            .number()
            .int()
            .min(60_000)
            .max(90 * 86_400_000)
            .default(30 * 86_400_000),
        /** In memory only (no `DATABASE_URL`): how many scans are kept at most, the oldest finished going first. */
        SCAN_MAX_STORED: z.coerce.number().int().min(10).max(1_000_000).default(1000),
        /** PostgreSQL connection string. Without it scans live in memory and are lost on restart; production requires it. */
        DATABASE_URL: z.string().min(1).startsWith('postgres').optional(),
        /**
         * Redis: the job queue (BullMQ) and the wake-up channel for live scans. With it the API only queues a scan and a worker process
         * (`pnpm start:worker`) runs it; without it the API runs scans itself, in memory (development and tests). Production requires it.
         */
        REDIS_URL: z
            .string()
            .min(1)
            .regex(/^rediss?:\/\//)
            .optional(),
        /**
         * Top-level domains no scan is made of, with everything under them (comma-separated, ASCII/punycode form). Default: Russia (.ru, .su, .рф),
         * Iran (.ir, .ایران) and China (.cn, .中国, .中國). Judged by the name only, not by where the server stands.
         */
        BLOCKED_TLDS: z.string().default('ru,su,xn--p1ai,ir,xn--mgba3a4f16a,cn,xn--fiqs8s,xn--fiqz9s').transform(blockList),
        /** Single domains (and their subdomains) no scan is made of, comma-separated. */
        BLOCKED_DOMAINS: z.string().default('').transform(blockList),
        /** Proxies of ours in front of the API (0 = none). Raise it only to match the real chain: a wrong value lets a caller forge its address. */
        TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
        /** Address ranges our proxies connect from (comma-separated CIDRs). X-Forwarded-For is read only from a peer inside one; empty trusts no peer. */
        TRUSTED_PROXY_CIDRS: z.string().default('').transform(cidrList('any')),
        /** NAT64 prefixes of the network the scanner runs in, beyond the well-known 64:ff9b::/96 (comma-separated /96s). An address inside one is judged by the IPv4 address it carries. */
        NAT64_PREFIXES: z.string().default('').transform(cidrList('nat64')),
        /** Heartbeat comment on every SSE stream, so proxies do not close an idle connection. */
        SSE_HEARTBEAT_MS: z.coerce.number().int().min(10).max(120_000).default(15_000),
        /** Event streams one address (an IPv6 /64) may hold open at once; an IPv6 /48 may hold ten times as many. */
        SSE_MAX_STREAMS_PER_IP: z.coerce.number().int().min(1).max(1000).default(10),
        /** Event streams this process holds open at once, from everyone; one more is answered 503 with `Retry-After`. */
        MAX_OPEN_STREAMS: z.coerce.number().int().min(1).max(100_000).default(500),
        /** The worker writes the time to this file at start and every 15 s; a health check calls it healthy while the file is under 60 s old. */
        WORKER_HEARTBEAT_FILE: z.string().min(1).default('/tmp/sitehp-worker-heartbeat'),
        /** A folder of demo sites (subfolders with a `site.json`): the scanner answers from them and never touches the network. For tests and `dev:demo` only, refused in production. */
        SITE_FETCHER_REPLAY_DIR: z.string().min(1).optional(),
    })
    .refine((env) => env.TRUSTED_PROXY_HOPS === 0 || env.TRUSTED_PROXY_CIDRS.length > 0, {
        path: ['TRUSTED_PROXY_CIDRS'],
        message: 'proxies are counted (TRUSTED_PROXY_HOPS) but none is trusted: list the ranges they connect from',
    })
    .refine((env) => env.REDIS_URL === undefined || env.DATABASE_URL !== undefined, {
        path: ['REDIS_URL'],
        message: 'a queue with workers in other processes needs the shared database: set DATABASE_URL too',
    })
    .refine((env) => env.NODE_ENV !== 'production' || env.REDIS_URL !== undefined, {
        path: ['REDIS_URL'],
        message: 'production runs scans in a worker process: set REDIS_URL',
    })
    .refine((env) => env.NODE_ENV !== 'production' || env.DATABASE_URL !== undefined, {
        path: ['DATABASE_URL'],
        message: 'production needs a database: scans are kept for 30 days',
    })
    .refine((env) => env.NODE_ENV !== 'production' || env.SITE_FETCHER_REPLAY_DIR === undefined, {
        path: ['SITE_FETCHER_REPLAY_DIR'],
        message: 'replaying recorded scans is for tests only, not production',
    })
    .refine((env) => env.NODE_ENV !== 'production' || (env.CORS_ORIGINS?.length ?? 0) > 0, {
        path: ['CORS_ORIGINS'],
        message: 'production must name the origins of its frontend: the development default (http://localhost:3000) does not apply',
    })
    .transform((env) => ({ ...env, CORS_ORIGINS: env.CORS_ORIGINS ?? ['http://localhost:3000'] }));

export type Config = z.infer<typeof envSchema>;

export type LoadConfigResult = { ok: true; config: Config } | { ok: false; problems: string[] };

export const loadConfig = (env: Record<string, string | undefined> = process.env): LoadConfigResult => {
    const parsed = envSchema.safeParse(env);
    if (parsed.success) return { ok: true, config: parsed.data };
    return { ok: false, problems: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`) };
};
