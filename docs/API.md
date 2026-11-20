# sitehp.app API

The backend is a small HTTP API: start a scan, read its report and follow it live. The website uses exactly this API; nothing here needs a key. The examples use a local backend (`pnpm dev`) at `http://localhost:4000`.

The contract is defined once, as zod schemas, in [`packages/core/src/contract`](../packages/core/src/contract), and `@sitehp.app/core` ships a typed client for it (`createApiClient`, and `streamEvents` for the live stream).

## Quick start

```bash
# Start a scan
curl -X POST http://localhost:4000/v1/scans \
  -H 'content-type: application/json' \
  -d '{"url":"example.com"}'

# Read the report (use the publicId from the answer)
curl http://localhost:4000/v1/scans/<publicId>

# Follow it live
curl -N http://localhost:4000/v1/scans/<publicId>/events
```

## Conventions

- Everything is under **`/v1`**. A breaking change to the contract is a new version, not an edit.
- Requests and responses are JSON (`content-type: application/json`), except the event stream.
- A report is reachable only by its **public id**: 128 random bits as 22 URL-safe characters. Nothing lists, searches or enumerates reports.
- Every response carries `X-Request-Id` (a safe id you send in the same header is echoed back), and every `/v1/scans` response carries `X-Robots-Tag: noindex, nofollow`.
- A browser may call the API only from the origins in `CORS_ORIGINS`, with `GET` and `POST`, without credentials.

## Rate limits

`POST /v1/scans` is limited per caller and per scanned domain (by default 20 scans an hour per address, IPv6 counted by network, and 10 an hour per domain from all callers together). The event stream is limited to 10 open streams per address. A refused request answers `429` with `RATE_LIMITED` and a `Retry-After` header in seconds.

## Errors

Every error has the same shape, with a stable code; `message` is English for developers, never meant for end users.

```json
{
    "error": {
        "code": "VALIDATION_FAILED",
        "message": "Invalid request.",
        "requestId": "9f1c…",
        "details": [{ "path": "url", "message": "Too small: expected string to have >=1 characters" }]
    }
}
```

| Code                | HTTP | When                                                                     |
| ------------------- | ---- | ------------------------------------------------------------------------ |
| `VALIDATION_FAILED` | 400  | The body, a parameter or a header is not valid; `details` says which.    |
| `NOT_FOUND`         | 404  | No report with that id (never existed, or deleted after its retention).  |
| `DOMAIN_BLOCKED`    | 403  | The address is on a blocked top-level domain or domain.                  |
| `RATE_LIMITED`      | 429  | Too many scans or streams; wait for `Retry-After`.                       |
| `INTERNAL`          | 500  | Something failed on our side; the `requestId` helps find it in the logs. |

`UNAUTHORIZED`, `FORBIDDEN` and `CONFLICT` are reserved in the contract and not answered today.

## Endpoints

### `POST /v1/scans`

Starts a scan, or returns a recent one of the same address.

| Field    | Type     | Description                                                                                                                            |
| -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `url`    | string   | The address to scan, 1–2048 characters. `https://` is assumed when the scheme is missing; only `http` and `https` are accepted.        |
| `fresh`  | boolean  | Optional. `true` scans anew even when the same address was scanned in the last 10 minutes.                                            |
| `checks` | string[] | Optional. Run only these checks, by id ([every check](CHECKS.md#every-check)). Checks that must always run are added; an unknown id is refused. |

An optional `Idempotency-Key` header (8–128 characters of `A–Z a–z 0–9 _ -`) makes a retried request return the scan it already started.

Answers `201` with the public id and the current snapshot:

```json
{
    "publicId": "V1StGXR8_Z5jdHi6B-myTq",
    "snapshot": { "publicId": "V1StGXR8_Z5jdHi6B-myTq", "status": "running", "url": "https://example.com/", "domain": "example.com", "...": "..." }
}
```

An address that is not valid (another scheme, credentials in it, an IP address instead of a name) is refused with `VALIDATION_FAILED`. An address whose name resolves to a private or internal network is not refused here: the scan starts and fails with the reason `blocked_address`, the same way as one that cannot be reached.

### `GET /v1/scans/{publicId}`

The report as it is right now: a **snapshot**. It is never cached (`Cache-Control: no-store`), because it changes while a scan runs.

| Field               | Type              | Description                                                                                         |
| ------------------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| `publicId`          | string            | The report's id.                                                                                    |
| `status`            | string            | `running`, `completed` or `failed`.                                                                 |
| `url`, `domain`     | string            | The normalized address and its host.                                                                |
| `createdAt`         | string            | ISO 8601.                                                                                           |
| `totalChecks`       | integer           | How many checks this scan runs.                                                                     |
| `checks`            | CheckResult[]     | The results so far, in registry order (see below).                                                  |
| `score`             | integer \| null   | The HP, 0–100. `null` before the first check, and when the site turned the scanner away.            |
| `preliminary`       | boolean           | `true` while checks are still running and the score may change.                                     |
| `failureReason`     | string \| null    | Why a `failed` scan failed (below).                                                                 |
| `responseHeaders`   | object \| null    | The response headers of the scanned page, never `set-cookie`. `null` until the page is fetched.    |
| `technologies`      | string[]          | What the site was recognised to be built with or served by.                                         |
| `selectedChecks`    | string[]          | The checks chosen for this scan; absent for a full scan.                                            |
| `lastEventId`       | string \| null    | The last event folded into this snapshot: resume the stream after it.                               |
| `scoreModelVersion` | integer \| null   | The score model the score was computed with; scores compare only within one version.               |

A **CheckResult** is:

| Field           | Type   | Description                                                                         |
| --------------- | ------ | ----------------------------------------------------------------------------------- |
| `checkId`       | string | The check's id, such as `hsts`.                                                     |
| `category`      | string | `security`, `seo`, `speed` or `agent`.                                              |
| `layer`         | string | `light` today.                                                                      |
| `status`        | string | `pass`, `warn`, `fail` or `skipped`.                                                |
| `severity`      | string | `critical`, `high`, `medium` or `low`.                                              |
| `effort`        | string | `minutes`, `hours` or `days`.                                                       |
| `evidence`      | object | What the check judged (a header value, a count, the elements it found).            |
| `pointsLost`    | number | The weighted points this result costs.                                              |
| `skippedReason` | string | Why a `skipped` check did not run.                                                  |

**Failure reasons**: `blocked_address` (the address resolves to a private or internal network), `unreachable` (the name does not resolve or the connection fails), `timeout`, `too_many_redirects`, `tls_error`, `invalid_response` and `internal_error`.

### `GET /v1/scans/{publicId}/events`

Follows a scan live as [Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html). The stream first replays every event of the scan (or every event after the one named in a `Last-Event-ID` header), then sends new ones as they happen, and closes after `scan.completed` or `scan.failed`. A finished scan replays and closes at once. A comment is sent every 15 seconds to keep the connection open.

Every event's data has the shape `{ "id", "type", "ts", "data" }`, and its SSE id is its position in the scan's log, so a client that reconnects with `Last-Event-ID` loses and repeats nothing.

| Type              | `data`                                                                       |
| ----------------- | ---------------------------------------------------------------------------- |
| `scan.started`    | `{ url, domain, totalChecks }`                                               |
| `page.fetched`    | `{ headers, technologies }`: the response headers of the page (no cookies). |
| `check.completed` | A CheckResult.                                                               |
| `score.updated`   | `{ score, preliminary: true }`                                               |
| `scan.completed`  | `{ score, scoreModelVersion }`                                               |
| `scan.failed`     | `{ reason }`: one of the failure reasons above.                              |

Folding the events in order gives the snapshot; `reduceScan` in `@sitehp.app/core` does exactly that.

### `GET /v1/health`

Liveness: `200` while the process answers.

### `GET /v1/ready`

Readiness: `200` `{ "status": "ready", "checks": … }` when the database (and Redis, when configured) answer within 2 seconds each; otherwise `503` with the failed dependency in `checks`.

## Beyond the JSON API

The frontend serves a few more public addresses built on the same reports:

- **`/badge/r/{publicId}.svg`**: the report's HP badge (`?theme=light` or `dark`). It shows the score and a word for it, never the domain or a finding.
- **Markdown**: every public page has a `.md` twin, and any page answers in Markdown to `Accept: text/markdown`. The report page's **Export** menu gives the report itself as Markdown or JSON.
- **`/llms.txt`**, **`/sitemap.xml`** and **`/robots.txt`** for agents and search engines.
