# @sitehp.app/core

A shared package for the frontend, the backend and, later, the CLI. It contains only **pure domain logic and contracts**, i.e. things that must be the same on every side.

## What belongs here

- **Types and Zod schemas** for the API and scan events (`scan.started`, `check.completed`, `scan.completed` …), so the frontend and the backend share one source of truth.
- **Check definitions** (`id`, category, severity, fix effort, layer `light` / `heavy`, the `run(ctx)` function) as pure functions `(context) → CheckResult`.
- **Score calculation:** `computeScore(results)` and `fixGain(results, checkId)` (with `simulateFix` in `scan/score.ts`) for "fix 3 things and gain +25 HP". It must be deterministic and explainable.
- **Templates of human explanations and guides** per platform (WordPress, Shopify, Next.js, nginx).
- **Constants and small pure utilities** needed on both sides (URL normalization, categories, weights, engine version).

## The scan domain

`normalizeUrl` (syntax only; resolving hosts and blocking internal addresses belongs to the fetching layer), the unified `CheckResult` / `CheckDefinition`, `runCheck` (a check that throws becomes `skipped`), the `CHECKS` registry, `computeScore` (provisional until F3-1), `FetchedPage` (what the checks of the light layer read), the scan failure reasons (`blocked_address`, `unreachable`, `timeout`, …), the scan events and the snapshot with `reduceScan`, the one reducer that the backend, the browser and the CLI all use to build the same state. Add a check by adding a file in `src/scan/checks/` and listing it in the registry; the frontend then needs its texts (a test fails until it has them).

## The API client

`createApiClient({ baseUrl, fetch?, credentials? })` is the one typed way to call the API (frontend SSR loader and browser, CLI, GitHub Action). Every response and event is validated against the contract schemas; `ApiError` carries the stable code. `streamEvents` follows an SSE stream over `fetch` with a pure parser, reconnects with `Last-Event-ID`, and stops at a terminal event. `core`'s tsconfig includes the DOM lib only for the web-standard `fetch` and streams; lint forbids `window`, `document`, `process` and the like in `src`.

## What does not belong here

- **No I/O:** no HTTP requests, DNS, TLS, file system, database, Redis or queue. A check receives its data in `context` and returns a result. Downloading a foreign site belongs in the backend (workers, egress proxy).
- **No frameworks:** nothing from Hono, TanStack, React, Playwright or BullMQ. The package must be usable in Node, in the browser and in the CLI.
- **No environment dependencies:** `process.env`, `window`, `document`, Node-only APIs. Configuration is passed as a parameter.
- **No UI logic:** components, hooks, styles.
- **No secrets or keys**, including users' BYOK keys.
- **Code used by only one side.** If only the backend or only the frontend needs it, it belongs there. A thing moves into `core` only when two sides really need it.

## Rules

- Functions are `const` arrows, never `function` declarations (enforced by lint).
- Inside `src` imports stay relative (same folder or a sub-folder), because other packages consume `core` as source and cannot resolve its aliases. Tests use `@src/…` and `@tests/…`.
- Keep dependencies to a minimum (Zod is fine). Every new dependency must work in both the browser and Node.
- Everything is covered by tests without infrastructure. A pure function is tested without Redis or a database.
- A change of weights or checks bumps `engine_version`, so HP history stays explainable.
- The package is imported directly from source (`exports` points to `src/index.ts`) and has no build of its own.
- **Two entries.** `@sitehp.app/core` is everything (the backend, the CLI). `@sitehp.app/core/browser` is what a page may load: the contract, the client, the score model, URL helpers and `CHECKS` as metadata only (`scan/catalog.ts`, without `run`), so the check runners and parse5 stay out of client bundles. Lint stops the frontend importing the root; `tests/catalog.test.ts` fails when the catalog and the registry disagree, so a new check is listed in both.
- **Schemas use `zod/mini`**, which tree-shakes; the classic `zod` API would pull all of Zod into the browser (lint forbids it in `src`). Mini schemas still have `.parse` / `.safeParse`, and the backend can mix them with its own classic schemas.
