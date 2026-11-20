# @sitehp.app/backend

The HTTP API of sitehp.app (Hono on Node), later also the workers and the scheduler. One codebase, several process types started from different entry points (`main.api.ts` today; `main.worker-light.ts`, `main.worker-heavy.ts`, `main.scheduler.ts` later).

## Architecture in one paragraph

A **modular monolith with a hexagonal layout**. The pure domain (checks, scoring, event and API contracts) lives in `@sitehp.app/core`. Here, each module has HTTP routes (the "controllers"), application use-cases, ports (interfaces) and infrastructure adapters. Everything that touches the outside world sits behind a port, so use-cases are tested with in-memory fakes. See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

```
src/
  main.api.ts              process entry: load config, build deps, serve, shut down gracefully
  config/                  environment schema (Zod); the only place that reads process.env
  platform/                cross-cutting: logger, errors, SSE helper, HTTP shell, ports (Clock)
  modules/<name>/
    http/                  routes: parse and validate → call a use-case → map the result
    application/           use-cases (no HTTP, no infrastructure imports)
    ports.ts               interfaces the use-cases depend on
    infrastructure/        adapters: Postgres, Redis, queue, fetcher, mailer, Paddle
    worker/                job handlers (workers only)
  composition/             the composition root: wires modules together, mounts routes under /v1
tests/                     route tests (app.request), use-case tests with fakes, architecture rules
```

## Rules (enforced by `tests/architecture.test.ts`)

- A module never imports another module. Modules are mounted, and wired together, only in `composition/`.
- `platform/` and `config/` never import a module or the composition root.
- `application/` never imports Hono, `http/` or `infrastructure/`. The test reads every kind of import: `from`, side-effect `import '…'` and dynamic `import(…)`.
- Inputs and outputs are Zod schemas from `@sitehp.app/core`. Routes validate with `validate(target, schema)`.
- Failures are `AppError`s with a stable code from the contract; the backend never returns user-facing prose. Unexpected errors are logged with the stack and answered as `INTERNAL`.
- Logs go to stdout as JSON through pino, never `console`; secrets are redacted by path.
- Imports use the aliases `@config`, `@platform`, `@modules`, `@composition`, `@src`, `@tests` (tsconfig `paths`); no `../`. The architecture test understands them, so the module rules still hold.
- Functions are `const` arrows (or `const f = async function* …` for generators), never `function` declarations; lint enforces it.

## API conventions

- Everything is under **`/v1`**. A breaking change to the contract is a new version, not an edit.
- Live data is **Server-Sent Events**: `sseResponse()` handles `Last-Event-ID` replay, heartbeat comments, no buffering and abort. Stream URLs use the unguessable `publicId`, never an internal id. One address holds at most `SSE_MAX_STREAMS_PER_IP` streams (more answer 429) and the process at most `MAX_OPEN_STREAMS` (500; more answer 503 with `Retry-After`).
- **`GET /v1/health` is liveness** (the process answers) and **`GET /v1/ready` is readiness**: 200 `{ status: "ready", checks }` when the database answers, and Redis too when it is configured, within 2 s each; otherwise 503 with the failed dependency in `checks`.
- Every response carries `X-Request-Id` (a safe caller-supplied id is echoed). CORS allows only `CORS_ORIGINS` and only the methods the API answers (`GET`, `POST`), without credentials until there is sign-in.
- Error shape: `{ error: { code, message, requestId?, details? } }`.

## Fetching a stranger's site

The scanner is an SSRF target by nature: it fetches whatever address a stranger types. `platform/net` is the protection, in layers, each with its own tests: `normalizeUrl` (scheme, port, credentials, IP literals, single-label hosts) on the first URL and on every redirect target; `isPublicIp` (what counts as the public internet); a guarded DNS lookup that the connection itself uses, so the address that was checked is the address connected to (A and AAAA asked from the DNS servers directly with a timeout, not `dns.lookup`, which blocks the libuv thread pool; a network with its own NAT64 prefix lists it in `NAT64_PREFIXES`, so an address inside it is judged by the IPv4 address it carries); manual redirects with every hop checked; one timeout, a byte cap (on the decompressed body, and 4× it on the compressed bytes read) and a redirect cap; a fixed User-Agent, no cookies. The side probes of a scan (robots.txt, llms.txt, the sitemaps and their sampled pages, the not-found probe, the `www` variant) follow a redirect only within the scanned registrable domain; one that leaves it gets no answer (`unreachable`), so a site cannot point the scanner at a third party. The page itself may redirect anywhere. A body is decoded in the charset of its `Content-Type`, else of a `<meta>` in its first 1024 bytes, else as UTF-8. An address typed without a scheme is tried as https; when https does not answer at all (`unreachable`, `tls_error`) it is tried once over http, and the report names the http address (the `url` column keeps the address as asked, for reuse). Test-only switches (`allowCustomPorts`, a custom `isAllowed`) exist only as options of `createSafeFetcher` and are never read from configuration. Scans reach the site only through the `SiteFetcher` port.

**Rate limits and callers.** `POST /v1/scans` is limited per caller (`SCAN_LIMIT_PER_IP`; an IPv6 caller is its /64, and its /48 gets ten times that) and per registrable domain across all callers (`SCAN_LIMIT_PER_DOMAIN`; `a.x.com` and `b.x.com` share `x.com`, while `x.github.io` and `y.github.io` are apart, by the Public Suffix List). When a domain is full and the same URL finished a scan within the window, that report is handed out again instead of a refusal. The caller is the socket address; `X-Forwarded-For` is read only from a peer inside `TRUSTED_PROXY_CIDRS`, taking the entry `TRUSTED_PROXY_HOPS` from the right. With no ranges listed no peer is trusted, and counting hops without listing ranges is a configuration error.

## Contract test

`tests/contract.test.ts` runs the client from `@sitehp.app/core` against the real Hono app (no network), including a connection cut after two events that must resume through `Last-Event-ID`. A change to the contract on one side only fails there.

## Commands

```bash
pnpm --filter @sitehp.app/backend dev      # tsdown --watch, restarts the server on every change; reads .env if present
pnpm --filter @sitehp.app/backend dev:demo # the same, but scans answer from the demo sites below, never the network
pnpm --filter @sitehp.app/backend test
pnpm --filter @sitehp.app/backend build    # tsdown → dist/main.api.mjs
pnpm --filter @sitehp.app/backend start
pnpm --filter @sitehp.app/backend start:worker # the worker process: takes scans off the Redis queue (needs REDIS_URL and DATABASE_URL)
pnpm --filter @sitehp.app/backend db:generate # a new migration in drizzle/ after a change to the schema
pnpm --filter @sitehp.app/backend sites    # the domains that were ever asked to scan (needs DATABASE_URL)
```

Configuration: see [`.env.example`](.env.example).

## The scans module

`POST /v1/scans` validates the address (`normalizeUrl` from core), creates a scan with a fresh unguessable public id, publishes `scan.started` and hands the job to a queue; the runner executes the checks of the registry and publishes `check.completed` after each (with the preliminary `score.updated` in the same write), ending with `scan.completed`. An optional `Idempotency-Key` header (8 to 128 of `A-Z a-z 0-9 _ -`; the frontend sends a fresh UUID per submit) makes a repeat of the same request from the same caller within 10 minutes return the scan the first one started, without spending the rate limit; the keys live in the API process (the rate limits live in Redis when `REDIS_URL` is set, in memory otherwise). The stored snapshot is always `reduceScan` over the events, so what the API returns, what the stream sends and what the browser builds agree. With `DATABASE_URL` set, scans, their event log and the list of domains live in PostgreSQL (Drizzle, `infrastructure/postgres/`; the migrations in `drizzle/` run at start-up); without it they live in memory. With `REDIS_URL` set, the API only queues a scan on BullMQ and a worker process runs it, waking live streams over Redis pub/sub; without it the API runs scans itself with an in-process queue. The choice is made in `main.api.ts` and `composition/deps.ts` only. `SCAN_STEP_DELAY_MS` slows each check so a scan can be watched in development.

## Logging

JSON lines on stdout (pino); every line has `level`, `time`, `service`, `msg`. Request lines carry `requestId`, scan lines carry `publicId`, so one scan or one request can be followed through the log. **Never in a log:** the path, query string or fragment of any address (only its host and the path's length), what a visitor typed, cookie values, page bodies, secrets (redacted by path). The caller's address only with `LOG_CLIENT_IP=true`.

| Level | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| info  | `configuration` at start (no secrets) and `database ready`; every `request` (method, path with a report id cut to its first 4 characters, route, status, duration, user agent, origin, API `errorCode`; caller-sent text cut to 200 characters; `route` is null when no route answered; for an event stream the line marks its start, and `stream closed` carries how long it ran); `scan created` (host, path length, whether it had a query); `scan refused` for an invalid address (info, not warn: bad input is noise); `scan started` (queue wait); `site contacted` (the page's status, redirects, bytes, timing; the http entry; the certificate; the status of robots.txt, sitemap, llms.txt, the Markdown probe, the not-found probe, the other host name); `scan completed` (score, whether the cap held it, score per category, counts, the failed and warned ids, the skipped with reasons, duration); `stream opened`/`closed`; `deleted expired scans` |
| warn  | `scan refused` (domain blocked with the rule, rate limited with which limit and for how long); `scan failed` with the reason; `fetch refused` (a host on the block list, an address rule, a name that resolves to an internal address); `stream refused`; a failed write to the list of domains                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| error | `scan job failed` and `unhandled error` with the stack; `event stream failed`; purge failures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| debug | `check completed` for each check (verdict, severity, points lost, skip reason, duration); `fetch` / `fetch failed` for each request to a scanned site (host, path length, status, redirects, bytes, timing); `no expired scans to delete`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| trace | `event published` for every event of a scan with its id                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Queue and worker

With `REDIS_URL` set, the API **only queues** a scan (BullMQ, queue `light`, job id = the scan's public id) and a separate worker process (`start:worker`, `src/main.worker.ts`) runs it, `SCAN_MAX_CONCURRENT` at once; run as many workers as the load needs. They share only PostgreSQL (the scans) and Redis (the queue and a pub/sub channel that wakes the API's live streams the moment a worker publishes an event; the stream also looks again every 15 s, so a lost signal costs a delay and nothing else; without Redis it looks every second). Without `REDIS_URL` the API runs scans itself in memory, as in development and in the tests. Production requires both.

- **A worker that dies** leaves its job locked for 60 s; another worker then takes it (at most twice) and starts the scan over, and the log says so. A scan that already ended is skipped if its job comes back. Every run has its own id (`runId` in `scan.started`, kept in the stored snapshot, never sent to clients): once a run takes a scan over, the store refuses the events of the earlier one (`RunTakenOverError`), so a worker that only stalled cannot mix its results into the new run. A job BullMQ gives up on (stalled too often, or the run threw) fails its scan at once (`internal_error`).
- **A scan is never retried for a failure**: it records its own failure (`scan.failed`) and the job ends normally.
- **A lost job** (Redis restarted without it, a job out of attempts) is caught by the reaper in each worker: a scan still `running` with no event for `SCAN_DEADLINE_MS` + 1 min (3 min by default) whose job is no longer waiting or running is failed with `internal_error`. A scan waiting in a long queue, or one the queue cannot answer for while Redis is away, is left alone.
- **An ended scan takes no more events**: the store refuses them (`ScanFinishedError`), so a worker still running a reaped scan stops. A scan that cannot be queued is failed at once and the API answers `INTERNAL`.
- **Shutdown** (`SIGTERM`): a worker stops taking scans and finishes the ones in progress (up to 60 s).
- **What is in Redis, and for how long:** queued and running jobs until they finish; a finished job for 5 minutes or above 1000 of them, a failed one for an hour or above 1000 (a job holds the address as typed, query values included) (trimmed as new jobs finish, not on a timer); the pub/sub channels hold nothing. Docker Compose caps Redis at 256 MB with `noeviction`: at the cap it refuses new writes rather than dropping a job, which is far away at these sizes.
- **Rate limits** live in Redis when it is configured (one Lua script: INCR + PEXPIRE per key, every key or none), so every API process counts against the same limits; without Redis they live in the process's memory.
- **Worker health**: the worker has no HTTP, so it writes the time to `WORKER_HEARTBEAT_FILE` (`/tmp/sitehp-worker-heartbeat`) at start and every 15 s. It is healthy while the file's mtime is under 60 s old.
- Redis may be wiped at any time: it holds only queued work, wake-ups and rate-limit counters, never a report.
- Tests: `tests/queue.test.ts` (no Redis needed) and `tests/redis.test.ts`, which runs BullMQ, the channel and a whole scan through API container, queue, worker container and stream against a real Redis; it is skipped without `REDIS_URL` (`REDIS_URL=redis://:sitehp@localhost:6379 pnpm test` against the compose Redis, whose password is `REDIS_PASSWORD`, default `sitehp`) and always runs in CI, where a missing `REDIS_URL` fails the run instead of skipping.

## Deploying a new version

What happens to scans in progress, and the rules that keep the old and the new version working side by side for a while.

- **Worker.** On `SIGTERM` it takes no new job and finishes the scans it runs (up to 60 s; Compose gives it 70 s). Queued scans wait in Redis for the new worker. A worker cut off sooner leaves its job locked for 60 s; then another worker takes it and runs the scan again from the start (a new `scan.started` clears the earlier results); after two such losses the job fails and the reaper fails the scan.
- **API.** It runs no scans. On `SIGTERM` it ends the live streams; the browser reconnects with `Last-Event-ID` and the new API replays the rest from the database. Then the server stops taking connections and answers the requests in flight; the database, the queue and Redis close only after the last one. With a single API process new scans cannot be created for the seconds of the restart.
- **Old and new together.** The new API migrates the database at start-up while old workers still run, and a scan queued by the old API may be run by a new worker. So:
    - A migration only adds (a table, a nullable column or one with a default, an index). Removing, renaming, changing a type or adding NOT NULL to an existing column is a separate, later migration marked `-- contract: <why>`, released once no running version uses what it removes. `tests/migrations.test.ts` refuses an unmarked breaking statement.
    - The stored snapshot (jsonb) and the events change the same way: a new field is optional for at least one release, an old one is kept until no running version reads it.
    - A worker that runs a scan queued by another version with another set of checks starts it again with its own number of checks; `engine_version` is written by the worker that completes a scan, so it names the score model that produced the score.
- **Without Redis** (development only) the API runs scans itself; after a restart it fails, at once, every scan still stored as `running` from before.

## Storage, retention and the list of domains

- **Database.** `docker compose up -d` (repository root) starts Postgres 16; set `DATABASE_URL=postgres://sitehp:sitehp@localhost:5433/sitehp` in `.env` (the password is `POSTGRES_PASSWORD`, default `sitehp`; Redis likewise needs `REDIS_URL=redis://:sitehp@localhost:6379`). Production refuses to start without it. Tests run the same queries against PGlite (PostgreSQL in the test process), so they need no server; `tests/scan-store.test.ts` holds the one contract both stores must keep.
- **Retention.** A report and its event log are deleted 30 days after they were created (`SCAN_RETENTION_MS`); the job runs at start-up and hourly, in the worker (in the API only when it runs the scans itself, without Redis). The caller's address is never stored.
- **The scanned address.** A report is public, so the stored URL keeps the query keys and replaces their values with `…` (`?token=…&lang=…`). The address as typed travels only in the queued job, so the worker fetches the right page.
- **Scanned domains.** Every domain someone asks to scan is recorded for good in `sites`, one row per domain (an upsert, so concurrent requests each add their count): first and last seen, `request_count` (every request that was not blocked, including a recent scan handed out again and a request over the rate limit), `scan_count` (scans actually started), how many refusals, and the latest score (of the most recently started scan, whatever order scans finish in). Only the registrable domain (`x.com` for `a.b.x.com`), so made-up subdomains do not each add a row: no path, no query, nobody's address. A refused request is counted under the rule that refused it (`*.ru`, or the listed domain), so made-up subdomains cannot grow the table, and it counts against the caller's rate limit. `pnpm sites` prints it.
- **Block list settings** (`BLOCKED_TLDS`, `BLOCKED_DOMAINS`) take names in any script (`рф` works like `xn--p1ai`); an entry that is not a plain name (`*.x.com`, `https://x.com`) stops the start-up with a configuration error.
- **Migrations** run at start-up under a PostgreSQL advisory lock, so the API and workers starting together apply them once. `tests/postgres.test.ts` checks that and the row lock against a real server (skipped without `DATABASE_URL`; in CI a missing one fails the run).
- **Block list.** `BLOCKED_TLDS` and `BLOCKED_DOMAINS` refuse a scan with `DOMAIN_BLOCKED` (403) before anything is fetched, and the fetcher refuses a redirect to a blocked host. The default is Russia, Iran and China (their country domains and non-Latin ones). It judges the name only: a `.com` hosted in one of those countries is not caught (that would need an IP geolocation database).

## Demo sites

`demo-sites/` holds synthetic websites: the structure of common real sites (markup patterns, headers, redirects, robots.txt, sitemaps, certificates) with made-up content (fictional brands, lorem text, no real images). With `SITE_FETCHER_REPLAY_DIR` pointing at the folder the scanner answers from them instead of the network (refused in production): `dev:demo` sets it, so they can be scanned from the UI; the browser tests use `e2e-good` and `e2e-bad`; `tests/demo-sites.test.ts` scans each one through the whole pipeline, checks its `expect` and compares the result with `tests/__snapshots__/demo-sites/<slug>.json` (`vitest run -u` rewrites the snapshots).

| Slug                  | Type in                                                                | Shows                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `wordpress-blog`      | `acme-coffee.example`                                                  | WordPress: generator, wp-json link, Yoast-style JSON-LD, wp-sitemap index, PHP version in X-Powered-By                  |
| `shop-product`        | `www.acme-outdoor.example/products/trail-jacket`                       | Hosted e-shop product: Product JSON-LD, og:product, sitemap index, 91-day HSTS, partial CSP, cookies without HttpOnly   |
| `nextjs-spa`          | `acme-analytics.example`                                               | Next.js app: thin markup, big `__NEXT_DATA__`, no h1 or canonical, edge headers, 308 redirects                          |
| `news-consent-wall`   | `www.zpravy-acme.example/domaci/zastupitele-schvalili-novy-park-41234` | Article 302 → 302 → consent page (`/nastaveni-souhlasu?url=…`) without lang                                             |
| `bot-wall`            | `www.acme-tickets.example`                                             | 403 challenge page with full security headers: blocked, no score                                                        |
| `government`          | `www.mesto-acmeves.example`                                            | http not redirected, bare domain to another host, canonical on http, IIS headers                                        |
| `corporate`           | `acme-group.example`                                                   | bare → www, soft 404 redirecting home, 202-address sitemap, CSP with unsafe-inline                                      |
| `wiki-article`        | `cs.acmepedia.example/wiki/Hvězdná_mapa`                               | Pod-name Server header, 17 hreflang alternates, clean outline, no description                                           |
| `docs-site`           | `docs.acme-cloud.example/en/getting-started/`                          | Strict CSP, every header, hreflang: scores 100                                                                          |
| `tiny-static`         | `acme-placeholder.example`                                             | One-file placeholder: no robots.txt, no sitemap, same page on www and http                                              |
| `legacy-site`         | `www.stavebniny-acme.example`                                          | Table layout, `<font>`, entity title, no viewport or lang, images without alt over http, certificate 5 days from expiry |
| `czech-eshop`         | `www.acme-obchod.example`                                              | lang cs, hreflang cs/sk, cookies without any flag, sitemap addresses that redirect                                      |
| `forgotten-staging`   | `staging.acme-studio.example`                                          | meta noindex, X-Robots-Tag noindex, robots `Disallow: /`                                                                |
| `news-aria-images`    | `news.acme-daily.example/2026/10/09/council-approves-riverside-park`   | Images without alt but with aria-label, aria-labelledby, role=presentation/none, aria-hidden                            |
| `e2e-good`, `e2e-bad` | `example.com`, `example.org`                                           | The browser tests' good and bad site (`example.net` stays unanswered on purpose)                                        |

**Adding one:** make `demo-sites/<slug>/` with the files (`index.html`, `robots.txt`, `sitemap.xml`, …) and a `site.json`:

```json
{
    "url": "https://www.acme-shop.example/",
    "note": "the real-world pattern it mimics and what it tests",
    "certificate": { "daysLeft": 80 },
    "responses": {
        "https://www.acme-shop.example/": { "headers": { "server": "nginx" }, "file": "index.html", "cookies": ["id=1; Secure; HttpOnly"] },
        "http://www.acme-shop.example/": { "redirect": "https://www.acme-shop.example/" },
        "https://www.acme-shop.example/robots.txt": { "file": "robots.txt" },
        "https://www.acme-shop.example/sitehp-check-*": { "status": 404 }
    },
    "expect": { "http_redirect": "pass", "soft_404": "pass", "score": 90 }
}
```

- A response is a file (status 200 unless given; content type from the extension, size from the file) or a `redirect` hop (status 301 unless given). Hops chain: the scanner sees the final answer, with every hop in `redirects`, like the real fetcher. An address not listed does not answer.
- `/sitehp-check-*` is the scanner's random not-found probe. `certificate` defaults to a trusted one with 90 days left; `null` means no TLS. Every field of a certificate can be given.
- A scan asks for: the page, `http://<host>/`, the other host name (`www` added to a two-label name or removed), `/robots.txt`, the probe, the sitemap (from robots.txt, else `/sitemap.xml`), the first child of a sitemap index, and three of the sitemap's addresses (first, middle, last).
- `expect` takes `pass`, `warn`, `fail`, `skipped` or `skipped:<reason>` per check id, and `score`. Use `.example` host names, never a real site's, and write the content yourself.
- Run `pnpm --filter @sitehp.app/backend test -- -u demo-sites` to write the snapshot, and read it.

## Today

`GET /v1/health`, `GET /v1/ready` and the scans endpoints above.
