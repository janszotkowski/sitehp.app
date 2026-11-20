# Changelog

Notable changes to sitehp.app: the checks, the score, the API and the site. A change that moves scores raises the score model version (`SCORE_MODEL_VERSION`), and stored reports keep the version they were computed with.

## Unreleased

### Added

- First public release of the source code under the [MIT License](../LICENSE).
- 57 checks in four categories: security (16), SEO (25), agent readiness (8) and speed (8). See [Checks and scoring](CHECKS.md).
- The HP score, score model version 5: weighted by severity and by category, held at 59 after a failed critical check.
- Live reports over Server-Sent Events, stored and shareable for 30 days, with JSON and Markdown exports, a print layout, share images and an HP badge.
- The public API: `POST /v1/scans`, `GET /v1/scans/{publicId}`, `GET /v1/scans/{publicId}/events`, `GET /v1/health` and `GET /v1/ready`. See the [API reference](API.md).
- The website in English and Czech, built to WCAG 2.2 AA, with a methodology page, a blog and a page for the owners of scanned sites.
- Self-hosting with Docker Compose: PostgreSQL, Redis, the API, a worker and the frontend.
