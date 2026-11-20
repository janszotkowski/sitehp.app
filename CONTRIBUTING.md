# Contributing to sitehp.app

Thank you for helping. Bug reports, wrong results, ideas and code are all welcome. By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug** in the app or the API: [open a bug report](https://github.com/janszotkowski/sitehp.app/issues/new?template=bug_report.yml).
- **Report a wrong result**: a check that passed or failed a site it should not have, or an explanation that is wrong. [Open a wrong result issue](https://github.com/janszotkowski/sitehp.app/issues/new?template=wrong_result.yml) with the report link and what the site really does.
- **Suggest a feature** or a new check: [open a feature request](https://github.com/janszotkowski/sitehp.app/issues/new?template=feature_request.yml).
- **Improve a translation**: the interface is in English and Czech (`apps/frontend/messages/`).
- **Report a vulnerability in sitehp.app** privately, as described in [SECURITY.md](SECURITY.md). Never in a public issue.

For anything larger than a small fix, please open an issue first so we can agree on the approach before you spend time on it.

## Development setup

You need Node 24.22.3 (`.node-version`) and pnpm 12. [Development](docs/DEVELOPMENT.md#getting-started) has the full steps:

```bash
pnpm install
pnpm env:init
pnpm dev
```

Scanning needs internet access, because it fetches the real site. To work without it, `pnpm --filter @sitehp.app/backend dev:demo` answers scans from the recorded demo sites in `apps/backend/demo-sites` instead of the network.

Before you open a pull request, run what CI runs:

```bash
pnpm verify
```

It runs the dependency policy, lint, format check, typecheck, tests, the production build, a smoke test of the built apps and the browser tests, and must pass.

## Project structure

| Path                                  | What lives there                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`                       | The pure domain: every check, the score, the API contract (zod/mini schemas), the typed client and SSE client. No I/O.    |
| `packages/core/src/scan/checks`       | One file per kind of check (HTTPS, security headers, cookies, SEO, site files, agent readiness, speed) and the registry   |
| `apps/backend/src/modules/scans`      | Starting scans, the queue and the worker, storage (PostgreSQL with Drizzle, or in memory), the HTTP routes and the stream |
| `apps/backend/src/platform`, `config` | HTTP shell, the guarded fetcher (no private addresses), rate limits, SSE, logging, environment validation                 |
| `apps/backend/demo-sites`             | Recorded sites the scanner can replay without the network, for tests and demos                                            |
| `apps/frontend/src/routes`            | Pages (TanStack Router file routes), every public one under `$locale`                                                     |
| `apps/frontend/src/components`        | UI components; `ui/` holds the primitives                                                                                 |
| `apps/frontend/src/lib`               | Report model, fix guides, SEO and Markdown twins, badge and share image, API queries and other helpers                    |
| `apps/frontend/messages`              | Every user-facing text, in English and Czech (Paraglide)                                                                  |
| `apps/e2e`                            | Playwright tests of the built frontend and backend together                                                               |

## Code style

Formatting and most rules are enforced by **oxfmt** and **oxlint** (`pnpm format`, `pnpm lint`); the configuration is in the repository root and covers the whole monorepo. A few conventions on top of that:

- **TypeScript only, strict.** No `any`, no casts to silence the compiler. `type`, not `interface`.
- **Functions are constants**: `export const parseSse = () => …`, never `function parseSse()`.
- **Imports use path aliases** (`@lib/…`, `@platform/…`, `@components/…`); only a sibling in the same folder may be imported relatively (`./name`).
- **React components** take one `props: ComponentNameProps` parameter, with the type declared by name above the component, and read `props.x`. No destructuring in the parameter list (enforced by the project's own lint rule).
- **`packages/core` runs in the browser and in Node**: no Node or browser globals there, and `zod/mini` instead of `zod`.
- **Backend modules never import each other**, and `application/` never imports HTTP or infrastructure code (`apps/backend/tests/architecture.test.ts`).
- **Dependencies** are pinned to exact versions, and a version must be at least 7 days old before pnpm installs it. Add a dependency only when the platform or an existing one cannot do the job.
- **Comments explain why**, not what. Match the density and tone of the code around them.
- **Code, comments and documentation are in English.** User-facing text is in both English and Czech.

## Accessibility

The site is built to WCAG 2.2 AA, checked with axe-core on every page in both themes and on a phone-sized screen. Keep it there:

- **Every control has a name and works from the keyboard.** Use real buttons, links and inputs; a custom widget follows its ARIA pattern.
- **Never color alone.** A check's status is always written next to its color or icon, and the score has a word next to its number.
- **Tables** have a caption, `scope` on headers and a row header per check.
- **Live changes are announced politely:** a scan's progress and its result.
- **Motion respects `prefers-reduced-motion`,** and states stay visible in forced-colors mode.

## Tests

Tests use Vitest and live next to each package in `tests/`; the browser tests use Playwright in `apps/e2e`.

- Every check is tested in `packages/core/tests` against small, hand-written pages and headers, with no network. A check must cope with missing and malformed input; add a case for anything you change.
- The backend is tested through `app.request` and with in-memory fakes; storage runs on PGlite, and the queue tests use a real Redis when one is available.
- `apps/backend/tests/demo-sites.test.ts` scans every recorded demo site and compares the result with a snapshot, so a change in a check shows up as a diff.
- A bug fix comes with a test that fails without it.

## Common changes

### Add a check

1. Write the check in `packages/core/src/scan/checks/` (a new file, or next to the checks of its kind). A check is a pure function of the fetched page and site files: it returns `pass`, `warn`, `fail` or `skipped`, with the evidence behind it.
2. List it in the registry (`checks/index.ts`) and in `CHECK_CATALOG` (`scan/catalog.ts`), with its category, group, severity and effort. `tests/catalog.test.ts` fails until both agree.
3. Add its title and explanation to `apps/frontend/messages/en.json` and `cs.json` (`check_<id>_title`, `check_<id>_explanation`), and a fix guide in `apps/frontend/src/lib/fixGuides.ts`.
4. A change that moves scores raises `SCORE_MODEL_VERSION` in `scan/score.ts`, and the methodology page and [docs/CHECKS.md](docs/CHECKS.md) say what changed.

### Add a page

A page is a file in `apps/frontend/src/routes/$locale/`, so it exists in every language. Its title, description, canonical, `hreflang` and structured data come from the shared head helper in `src/lib/pageHead.ts`. The checklist for a new public page or a new language is in [`.claude/skills/seo/SKILL.md`](.claude/skills/seo/SKILL.md).

### Change the database schema

Change the Drizzle schema in the backend and run `pnpm --filter @sitehp.app/backend db:generate`: it writes a new migration to `apps/backend/drizzle/`. Never edit an existing migration. Existing databases are migrated at start-up, and old and new code run side by side during a deploy, so a migration must not break the code before it.

## Pull requests

- Keep a pull request to one change, and describe what it does and why. Screenshots help for anything visible.
- Write commit messages in the imperative ("Add HSTS preload check"), with details in the body when they help.
- Make sure `pnpm verify` passes. CI runs the same checks.
- A maintainer reviews every pull request. Expect questions; they are about the code, never about you.

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
