# Development

## Getting started

You need **Node 24.22.3** (the version in `.node-version`; use any version manager that reads it) and **pnpm 12**. pnpm checks its own version through `packageManager` and `devEngines`, and downloads the right one when it differs.

```bash
git clone https://github.com/janszotkowski/sitehp.app.git
cd sitehp.app
pnpm install
pnpm env:init     # creates apps/backend/.env and apps/frontend/.env from the .env.example files, once
pnpm dev
```

| What                                  | Address                         |
| ------------------------------------- | ------------------------------- |
| Landing page, with the scan form      | http://localhost:3000/en        |
| Backend API                           | http://localhost:4000/v1/health |
| Connection check (frontend → backend) | http://localhost:3000/en/status |

`pnpm env:init` never overwrites an existing `.env`. The development defaults slow every check by 0.7 s (`SCAN_STEP_DELAY_MS`) so a scan can be watched live; set it to `0` for instant scans. `pnpm dev` needs no database, Redis or Docker: scans are kept in memory and are lost when the backend restarts.

**Something does not start?** Ports 3000 and 4000 must be free (the backend allows requests from `http://localhost:3000` only; if Vite moves to another port, set `CORS_ORIGINS` in `apps/backend/.env`). Scanning needs internet access, because it fetches the real site; an address that resolves to a private network is refused on purpose.

### Demo sites

`apps/backend/demo-sites` holds recorded sites (a small static site, a WordPress blog, a shop, an SPA, a site behind a bot wall, an expired certificate…). `pnpm --filter @sitehp.app/backend dev:demo` starts the backend so that it answers scans from them instead of the network: scan the `url` written in a demo site's `site.json` (for example `https://acme-placeholder.example/`). The same recordings drive the backend tests and the browser tests.

## Three ways to run it

|     | Command | What runs | Use it for |
| --- | ------- | --------- | ---------- |
| 1   | `pnpm dev` | frontend (3000) and backend (4000) with reload; scans in memory, run inside the API | everyday work on the code |
| 2   | `docker compose up -d`, set `DATABASE_URL` and `REDIS_URL` in `apps/backend/.env`, `pnpm dev`, and in another terminal `pnpm --filter @sitehp.app/backend build && pnpm --filter @sitehp.app/backend start:worker` | the same, but scans are stored in PostgreSQL and run by a worker through the Redis queue | working on storage, the queue or the worker |
| 3   | **`pnpm stack`** | **everything in Docker the way production runs it**: PostgreSQL, Redis, API, worker and frontend | seeing the real thing; checking that it all starts together |

`pnpm stack` uses ports 3000 and 4000, so stop `pnpm dev` first. Details in [Configuration](CONFIGURATION.md#running-it-with-docker-compose).

## Repository layout

```
apps/backend     the API, the worker and maintenance commands (Hono on Node)
apps/frontend    the website (TanStack Start on Nitro, Paraglide for translations)
apps/e2e         Playwright tests of the built apps together
packages/core    the shared, pure domain: checks, scoring, the API contract (@sitehp.app/core)
docs/            this documentation
tools/           repository scripts: the dependency policy, env:init, the smoke test, the lint plugin
```

[CONTRIBUTING.md](../CONTRIBUTING.md#project-structure) maps the folders inside each package.

## Commands

```bash
pnpm install
pnpm env:init     # local .env files from the .env.example files (never overwrites)
pnpm dev          # backend (4000) and frontend (3000), with reload
pnpm build
pnpm start        # the built backend and frontend
pnpm stack        # everything in Docker; pnpm stack:down stops it
pnpm smoke        # starts the built apps and tests them together (after pnpm build)
pnpm e2e          # Playwright tests of the built apps (after pnpm build)
pnpm lint         # oxlint (pnpm lint:fix fixes what it can)
pnpm format       # oxfmt (pnpm format:check only checks)
pnpm typecheck
pnpm test
pnpm policy       # exact versions, pinned actions, pnpm settings
pnpm verify       # everything CI runs
```

In the backend: `pnpm --filter @sitehp.app/backend db:generate` writes a migration after a schema change, and `pnpm --filter @sitehp.app/backend sites` lists the scanned domains of a database.

## Checks and CI

`pnpm verify` runs everything CI runs, in the same order: the dependency and workflow policy (`pnpm policy`), lint, formatting, types, tests, the build, a smoke test (the built backend and frontend started and tested together, with no internet needed) and the browser tests. If it passes locally it passes in CI.

GitHub Actions ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs it on every push to `main` and every pull request, with a real PostgreSQL and Redis for the tests that need them, and then checks that the build changed no committed file (the generated route tree). The actions are pinned to full commit SHAs, and `pnpm policy` fails if one is not.

## Dependency rules

- pnpm, workspaces and Turborepo only.
- Every version in every `package.json` is exact (no `^` or `~`); `savePrefix: ''` in `pnpm-workspace.yaml`.
- `minimumReleaseAge: 10080`: only versions older than 7 days are installed.
- `pnpm policy` (`tools/check-policy.js`) fails on a range in any `package.json`, an unpinned package manager or runtime, a weakened `pnpm-workspace.yaml` or a GitHub Action that is not pinned to a full SHA.

## Lint and format

One configuration for the whole monorepo in the root: `oxlint.config.ts` and `oxfmt.config.ts` (oxlint and oxfmt; no ESLint, Prettier or Biome). React and accessibility rules apply to `apps/frontend` only.

### Code style rules enforced by lint

- **Functions are `const`**, never declarations: `export const parseSse = (body: string) => { … }`, not `export function parseSse(body: string) { … }`. Generators are the one shape an arrow cannot take, so they are function expressions: `const demoStream = async function* (…) { … }`.
- **React components take one `props` parameter and read `props.x`**, never a destructured parameter list: `const ErrorState = (props: ErrorStateProps) => …`. A component that forwards the rest to a primitive splits it off inside the body (`const { className, ...rest } = props`). Enforced by the project's own rule `sitehp/no-destructured-component-props` (`tools/oxlint-plugin.js`).
- **Imports use path aliases, never `../`** and never `./folder/…`: `import type { SseMessage } from '@platform/sse.ts'`. Only a sibling in the same folder (`./name`) may be relative. Every top-level folder of a package is an alias of the same name:

    | Package         | Aliases (tsconfig `paths`)                                                                       |
    | --------------- | ------------------------------------------------------------------------------------------------ |
    | `apps/backend`  | `@config` `@platform` `@modules` `@composition` `@src` `@tests`                                  |
    | `apps/frontend` | `@components` `@config` `@lib` `@paraglide` `@routes` `@styles` `@hooks` `@src` `@tests` `@vite` |
    | `packages/core` | `@src` `@tests`, for tests only                                                                  |

    Vite, Vitest, tsdown and `tsc` resolve them from `tsconfig.json`. Exceptions (the rule is off there): the config-time files (`vite.config.ts`, `vitest.config.ts`, `tsdown.config.ts`, `apps/frontend/vite/**`, `apps/frontend/scripts/**`), which run before aliases exist, and `packages/core/src`, which other packages consume as source and which therefore keeps relative imports.

- A `const` function is not hoisted: define it above the code that uses it at module load (for example a route component above `createFileRoute(...)`).
- No `console` (use the logger), no `any`, `type` instead of `interface`, no unused variables or empty functions.

## Localization

The interface is in English and Czech. The frontend uses Paraglide JS (`apps/frontend/messages/en.json`, `cs.json`), and the language is part of every public URL (`/en/...`, `/cs/...`). Legal texts (`src/content/legal/<locale>/`), fix guides (`src/lib/fixGuides.ts`) and blog posts (`src/content/blog/<locale>/`) carry both languages too. SEO rules and the checklist for adding a page or a language: [`.claude/skills/seo/SKILL.md`](../.claude/skills/seo/SKILL.md).
