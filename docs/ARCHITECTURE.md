# How it's built

sitehp.app takes a URL, inspects the site from the outside, and returns an HP score with a ranked list of fixes. This page explains how the pieces fit together.

## The shape of it

```
                ┌──────────────────────────────────────────┐
                │                  Browser                  │
                │  React app (TanStack Start, SSR + client) │
                └──────┬────────────────────────┬──────────┘
          pages, assets│                        │ REST + Server-Sent Events
                       ▼                        ▼
            ┌───────────────────┐      ┌──────────────────────┐
            │  Frontend server  │─SSR─▶│     Backend API      │
            │  (Nitro, Node)    │      │  (Hono): scans · SSE │
            └───────────────────┘      └────┬────────────┬────┘
                                            │            │
                                ┌───────────▼──┐   ┌─────▼──────────┐
                                │  PostgreSQL  │   │     Redis      │
                                │ reports, log │   │ queue, wake-up │
                                └───────────▲──┘   │ rate limits    │
                                            │      └─────▲──────────┘
                                            │            │ jobs
                                       ┌────┴────────────┴────┐
                                       │        Worker        │──▶ the scanned site
                                       │  runs the checks     │   (public addresses only)
                                       └──────────────────────┘
```

One monorepo, three packages that share one contract:

```
packages/core    the pure domain: checks, scoring, the API contract, the typed and SSE clients
apps/backend     the API, the worker and a few maintenance commands: one codebase, several entry points
apps/frontend    the website: pages, the live report, Markdown twins, badges and share images
apps/e2e         browser tests of the built apps together
```

## Principles

1. **Checks are pure functions.** A check reads the fetched page and site files and returns a result. It does no I/O of its own, so it is tested in milliseconds and runs the same in the backend, the browser and the tests.
2. **The API never scans when there is a worker.** With Redis configured, the API validates, queues and streams; a worker process does everything that touches a foreign site, and can be scaled or restarted on its own.
3. **Everything that touches a foreign site is hostile by default.** Foreign sites are untrusted input and a possible path into our network. See [Security](#security).
4. **The score is explainable and deterministic.** One pure function computes it; every lost point has a check, a reason and evidence. See [Checks and scoring](CHECKS.md).
5. **A failing check never fails a scan.** A check that throws becomes `skipped` with a reason, and the score is computed from what ran.
6. **Server-side truth, thin clients.** The browser renders the events it receives; it never computes a score of its own.
7. **Boring, replaceable infrastructure.** Containers, PostgreSQL, Redis, HTTP and SSE. Nothing is tied to one cloud provider.

## Tech stack

| Part             | Technology                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| Language         | TypeScript 7 (strict), Node 24, pnpm workspaces and Turborepo                                                   |
| Shared domain    | `@sitehp.app/core`: zod/mini schemas, parse5 for HTML                                                           |
| Backend          | Hono on Node, undici for fetching, pino for logs, tldts for registrable domains                                 |
| Storage          | PostgreSQL with Drizzle ORM (PGlite in tests); in memory when no database is configured                         |
| Queue            | BullMQ on Redis, with a Redis pub/sub channel to wake live streams                                              |
| Frontend         | TanStack Start (React, SSR on Nitro), TanStack Router, Query and Table, Tailwind CSS 4, Base UI, Motion          |
| Translations     | Paraglide JS (English and Czech)                                                                                |
| Images           | Satori and resvg for share images; hand-drawn SVG for badges                                                    |
| Quality          | oxlint and oxfmt, Vitest, Playwright, axe-core                                                                  |
| Delivery         | One Dockerfile for every image, Docker Compose, GitHub Actions                                                  |

## The scan pipeline

1. **Request.** `POST /v1/scans` normalizes the address (only `http` and `https`, no IP literals, credentials or custom ports), refuses blocked domains, and applies the rate limits per caller and per domain.
2. **Reuse.** When the same address was scanned in the last 10 minutes, that report is returned. When a scan of it is already running, the new caller follows that one.
3. **Create and queue.** A scan is stored as `running` with an unguessable public id (128 random bits), and a job is queued. Without Redis, the API runs the scan in its own process.
4. **Fetch.** The worker fetches the page and the site files it needs (about twenty requests) through the guarded fetcher.
5. **Check.** Every check runs on what was fetched. After each one, its result is stored and published as an event, and the preliminary score is updated.
6. **Complete.** After the last check the final score is computed, `scan.completed` is published, and the stored snapshot is final.

A whole scan has a deadline (2 minutes by default). A reaper in the worker fails a scan that has gone quiet and whose job is gone (a lost Redis, a worker killed for good), so no report stays `running` forever.

## Live reports

Every change to a scan is an **event** with the shape `{ id, type, ts, data }`, defined once as zod schemas in `core` and shared by the worker, the API and the browser. The live report, the stored report and the tests all read the same events: there is no second code path for "live" and "finished".

- **Transport: Server-Sent Events.** The flow is one-way, SSE is plain HTTP (it passes proxies and firewalls), and a dropped connection resumes with `Last-Event-ID` without loss.
- **Durability: the event log in PostgreSQL.** Each event is appended in the same transaction that updates the scan's snapshot, and its position in the log is its SSE id. On connect the API replays everything after `Last-Event-ID`, then waits for new events.
- **Wake-up through Redis.** A worker that writes an event rings a pub/sub channel for that scan. The signal carries no data; it only wakes the API process serving the stream, which reads the event from the database. A missed signal costs a short delay, never an event.
- **The client** is `streamEvents` in `core`, built on `fetch` and a pure SSE parser rather than the browser's `EventSource`, so it runs unchanged in Node and in tests. A reducer (`reduceScan`) folds the events into the snapshot the page draws.

## Data

PostgreSQL is the source of truth; Redis only coordinates and holds nothing that cannot be lost.

- **Scans**: one row per scan with its snapshot (the check results as JSON) and its event log. A report is deleted, with its log, after 30 days.
- **Sites**: one row per scanned domain with counts and the last score, kept as an overview of which sites the product scores. It holds the host only.
- **Redis**: the BullMQ job queue (finished jobs removed after minutes), the wake-up channels, and the rate-limit counters shared by every API process. It runs with `noeviction`, so it refuses writes when full instead of silently dropping jobs. A lost Redis loses queued scans (the reaper fails them), never a report.

Migrations are Drizzle SQL files in `apps/backend/drizzle`, applied at start-up under a lock. Old and new code run side by side during a deploy, so a migration never breaks the code before it.

## The backend

A **modular monolith with a hexagonal layout**. Each module has HTTP routes, application use-cases, ports (interfaces) and infrastructure adapters; everything that touches the outside world sits behind a port, so use-cases are tested with in-memory fakes. `tests/architecture.test.ts` enforces the rules: a module never imports another module, and `application/` never imports HTTP or infrastructure code.

The same codebase starts as different processes:

| Entry point      | What it does                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `main.api.ts`    | The HTTP API: starts scans, serves reports and streams. Runs scans itself when there is no Redis. |
| `main.worker.ts` | Takes scan jobs from the queue and runs them; reaps scans that went quiet. Healthy while its heartbeat file is fresh. |
| `main.sites.ts`  | A maintenance command: prints the domains that were scanned, how often and how they did.         |

Configuration is read in one place (`config/env.ts`) and validated at start-up; an invalid value stops the process with a clear message. Logs are JSON lines on stdout, with secrets redacted.

## The frontend

TanStack Start renders every page on the server (Nitro, Node) and hydrates it in the browser. Public pages live under `/$locale/…`, so every page exists in English and Czech, with `hreflang` between them; the content pages are prerendered.

- **The report** loads its snapshot on the server (so a shared link shows the result at once, also to crawlers), then follows the event stream in the browser while the scan runs.
- **The server entry** (`src/server.ts`) also answers the badges, the share images, the Markdown twins (`.md`, or `Accept: text/markdown`), and sets the security headers, including a Content-Security-Policy built per response from the hashes of the page's inline scripts.
- **Indexing** is off unless the build says otherwise (`VITE_ALLOW_INDEXING`): every other build answers `noindex` everywhere, so a staging site never reaches search engines. Reports are never indexed.

## Security

A tool that fetches arbitrary URLs is a gift to an attacker, so the defence is structural:

| Threat                                              | Control                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requests to internal services or cloud metadata (SSRF) | Only public addresses, checked inside the connection's own DNS lookup so there is no gap for DNS rebinding; a host with even one internal address refused; IP literals and unusual ports refused; redirects followed one hop at a time, every hop checked again. |
| Abuse of the service to load a third-party site     | Rate limits per caller (IPv6 counted by network) and per registrable domain, a 10-minute reuse window, a whole-scan deadline, about twenty requests per scan.                                                                            |
| Malicious page content                              | Passive checks only; response size, redirect and time limits; no JavaScript is run.                                                                                                                                                       |
| Exhausting the API                                  | Limits on open event streams per address and per process, request validation at every boundary.                                                                                                                                         |
| Leaking data through reports                        | Unguessable report ids, `noindex` everywhere, no cookie values or page bodies stored, `set-cookie` never shown.                                                                                                                          |

Dependencies are pinned to exact versions and must be at least 7 days old before they are installed; every GitHub Action is pinned to a commit; `pnpm policy` fails the build if any of this is weakened. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Privacy

- No account and no sign-in.
- A report stores the findings and the evidence for them, never cookie values or page bodies, and is deleted after 30 days.
- The caller's address is used for rate limits only, and is not logged unless `LOG_CLIENT_IP` is turned on.
- No analytics, advertising or tracking tools, and no cookies.

## Running it yourself

`pnpm stack` starts the whole product in Docker the way production runs it: PostgreSQL, Redis, the API, the worker and the frontend, built from the [Dockerfile](../Dockerfile). See [Configuration](CONFIGURATION.md#running-it-with-docker-compose).
