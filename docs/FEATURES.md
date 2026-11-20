# Features

Everything sitehp.app offers. How the checks and the score work is in [Checks and scoring](CHECKS.md).

## Scanning

- **Enter a URL, get a score.** No account and no setup: type an address (with or without `https://`) on the landing page or in the scan field of the header (`⌘K` / `Ctrl K` focuses it from any page).
- **57 checks in four categories**: security, SEO, speed and agent readiness, each one passive, explained in plain language and ranked by what it is worth. See [every check](CHECKS.md#every-check).
- **Choose the checks.** A scan runs everything by default; the check picker runs only the ones you care about.
- **Live progress.** The report fills in check by check while the scan runs, with a preliminary score that settles at the end. Anyone with the link can watch the same scan; a dropped connection resumes where it stopped.
- **Fresh or reused.** The same address scanned in the last 10 minutes returns that report, which protects the site being scanned; **Scan again** asks for a new one, for example after a fix.
- **Clear failures.** A site that cannot be reached, times out, redirects too often, has a broken certificate or turns the scanner away gets a plain explanation instead of a score.

## The report

- **The HP score** in a ring colored by its band, the domain and one sentence that says what it means, plus a score per category and what share of the HP each one carries.
- **Fix first**: the few changes that bring back the most HP for the least work.
- **Every finding in one table**, filtered by area (HTTPS and certificate, security headers, cookies, page content, page basics, search visibility, site files, social sharing, agent access, content and discovery, server speed, page weight), with its status, severity and effort.
- **A detail for every finding**: what was found and the evidence behind it, why it matters, and a fix guide with steps for common platforms and servers.
- **Technical view**: the raw response headers of the scanned page and the technologies the site was recognised to use.
- **A stored, shareable report**: every report has a permanent, unguessable link, is kept for 30 days and is not indexed by search engines.

## Taking it with you

- **Export** the report as JSON or Markdown, copied or downloaded.
- **Print or save as PDF** from a print layout made for paper.
- **Share image**: a report link shared on social media or in a chat shows a preview card with the score.
- **HP badge**: `/badge/r/<report id>.svg`, in a light or dark theme, for a README or a status page. It shows the score only, never the domain or a finding.
- **Markdown for agents**: every public page has a `.md` twin (or answers `Accept: text/markdown`), and the site has an `llms.txt`.

## Content

- **Methodology**: how a scan runs and how the score is calculated, in plain language.
- **Blog**: articles about the checks and how the product works.
- **For website owners**: what the scanner requests from a site, its user agent, and what it never does.
- **About, status and legal pages**: the operator, a connection check between the frontend and the API, terms, privacy, cookies and the accessibility statement.

## For everyone

- **Two languages**: English and Czech, with the language in every public address (`/en/…`, `/cs/…`) and `hreflang` between them.
- **Accessible**: built to WCAG 2.2 AA and checked with axe-core on every page, in both themes and on a phone-sized screen. Keyboard and screen reader friendly, and motion respects `prefers-reduced-motion`.
- **Dark and light themes**: dark by default, switched with one button and remembered.
- **Works on a phone**: the report and the finding details are laid out for small screens.
- **Private by default**: no account, no cookies and no analytics or tracking; a report stores the findings, never cookie values or page bodies, and the caller's address is not logged unless configured.

## For developers

- **A public HTTP API** to start a scan, read a report and follow a scan as Server-Sent Events. See the [API reference](API.md).
- **Self-hostable**: one Dockerfile and one Docker Compose file run the whole product (API, worker, frontend, PostgreSQL and Redis). See [Configuration](CONFIGURATION.md#running-it-with-docker-compose).
- **A typed client** in `@sitehp.app/core`: the API contract as zod schemas, an API client and an SSE client that resumes with `Last-Event-ID`.
