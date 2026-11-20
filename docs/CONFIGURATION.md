# Configuration

Both apps are configured with environment variables. `pnpm env:init` creates `apps/backend/.env` and `apps/frontend/.env` from the `.env.example` files next to them (it never overwrites an existing file); the examples hold the development defaults and a comment for every variable. The backend validates its configuration at start-up and stops with a clear message when a value is wrong.

## Backend

### Server and logging

| Variable        | Default                 | Description                                                                                                              |
| --------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`      | `development`           | `production` turns on the production rules: `DATABASE_URL` and `REDIS_URL` are required and demo replay is refused.       |
| `HOST`, `PORT`  | `0.0.0.0`, `4000`       | Where the API listens.                                                                                                   |
| `LOG_LEVEL`     | `info`                  | `info`: every scan and request. `debug`: also every check and every request to the scanned site. `trace`: also every event. |
| `LOG_CLIENT_IP` | `false`                 | Put the caller's address in the logs. Off by default: an address is personal data.                                       |
| `CORS_ORIGINS`  | `http://localhost:3000` | Comma-separated origins allowed to call the API from a browser. Production must set it to the site's origin.             |
| `APP_VERSION`   | `dev`                   | Reported by the health endpoint and in the logs.                                                                         |

### Storage and queue

| Variable                | Default                         | Description                                                                                                                                         |
| ----------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | unset                           | PostgreSQL. Without it, scans live in memory and are lost on restart. Required in production.                                                       |
| `REDIS_URL`             | unset                           | Redis: the job queue, the live-stream wake-up and shared rate limits. With it the API only queues a scan and a worker runs it (needs `DATABASE_URL` too). Required in production. |
| `WORKER_HEARTBEAT_FILE` | `/tmp/sitehp-worker-heartbeat`  | The worker writes the time here at start and every 15 s; it is healthy while the file is under 60 s old.                                            |
| `SCAN_RETENTION_MS`     | `2592000000` (30 days)          | How long a report and its event log are kept. The list of scanned domains is kept for good.                                                          |
| `SCAN_MAX_STORED`       | `1000`                          | In memory only: how many scans are kept at most.                                                                                                    |

### Scanning

| Variable              | Default            | Description                                                                                                       |
| --------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `SCAN_STEP_DELAY_MS`  | `0` (`700` in the example) | A pause before each check, so a scan can be watched in development. Keep `0` in production. |
| `FETCH_TIMEOUT_MS`    | `10000`            | Timeout of one fetch of the scanned site.                                                                         |
| `FETCH_MAX_BYTES`     | `1048576` (1 MB)   | How much of a response is read.                                                                                   |
| `FETCH_MAX_REDIRECTS` | `5`                | Redirects followed, every hop checked again.                                                                      |
| `SCAN_DEADLINE_MS`    | `120000`           | The whole scan. One still running after this is stopped and reported as a timeout.                                |
| `SCAN_MAX_CONCURRENT` | `8`                | Scans run at once by one process; the rest wait in the queue.                                                     |
| `SCAN_REUSE_MS`       | `600000` (10 min)  | The same address scanned this recently gets that report back instead of a new scan. `0` turns reuse off.         |
| `BLOCKED_TLDS`        | `ru,su,xn--p1ai,ir,xn--mgba3a4f16a,cn,xn--fiqs8s,xn--fiqz9s` | Top-level domains (ASCII or punycode) that are never scanned, and to which no redirect is followed. Empty turns the block off. |
| `BLOCKED_DOMAINS`     | empty              | Single domains that are never scanned, comma-separated.                                                           |
| `NAT64_PREFIXES`      | empty              | NAT64 prefixes of the scanner's network beyond the well-known `64:ff9b::/96`, so their internal addresses are recognised too. |

### Rate limits and streams

| Variable                 | Default            | Description                                                                                     |
| ------------------------ | ------------------ | ----------------------------------------------------------------------------------------------- |
| `SCAN_LIMIT_PER_IP`      | `20`               | Scans one caller may start per window.                                                          |
| `SCAN_LIMIT_PER_DOMAIN`  | `10`               | Scans of one domain per window, from all callers together.                                      |
| `SCAN_LIMIT_WINDOW_MS`   | `3600000` (1 hour) | The rate-limit window.                                                                          |
| `SSE_HEARTBEAT_MS`       | `15000`            | Heartbeat comment on every event stream.                                                        |
| `SSE_MAX_STREAMS_PER_IP` | `10`               | Event streams one address may hold open (more answer 429).                                      |
| `MAX_OPEN_STREAMS`       | `500`              | Event streams one process holds open in total (more answer 503 with `Retry-After`).            |
| `TRUSTED_PROXY_HOPS`     | `0`                | How many proxies of ours stand in front of the API. Must match the real chain.                  |
| `TRUSTED_PROXY_CIDRS`    | empty              | The ranges those proxies connect from; `X-Forwarded-For` is read only from a peer inside one. Required when `TRUSTED_PROXY_HOPS` is above 0. |

### Tests and demos

| Variable                  | Default | Description                                                                                                                       |
| ------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_FETCHER_REPLAY_DIR` | unset   | Answer scans from the recorded demo sites in this folder instead of the network. Refused in production. `pnpm --filter @sitehp.app/backend dev:demo` sets it to `demo-sites`. |

## Frontend

`VITE_*` variables are baked into the bundle at build time; the others are read by the frontend server at run time.

| Variable                     | Default                 | Description                                                                                                                                   |
| ---------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`               | required                | The backend's origin as the browser calls it. It must be in the backend's `CORS_ORIGINS`.                                                     |
| `VITE_SITE_URL`              | `https://sitehp.app`    | The canonical origin for canonical URLs, Open Graph and the sitemap.                                                                          |
| `VITE_ALLOW_INDEXING`        | `false`                 | `true` only in production. Anywhere else every page is `noindex` and every response carries `X-Robots-Tag: noindex`. A build for `https://sitehp.app` fails without it, on purpose. |
| `VITE_SHOW_BETA`             | `true`                  | Shows the Beta label by the logo and in the footer. `false` for the real launch.                                                              |
| `API_INTERNAL_URL`           | `VITE_API_URL`          | The backend's origin as the frontend server calls it during server rendering (inside Docker, for example `http://api:4000`). Never sent to the browser. |

## Running it with Docker Compose

[`docker-compose.yml`](../docker-compose.yml) runs everything from the one [`Dockerfile`](../Dockerfile): PostgreSQL 16, Redis 7, the API, the worker and the frontend. Every base image is pinned by digest.

```bash
pnpm stack          # build and start everything, in the foreground
pnpm stack:down     # stop and remove the containers (the data stays in its volumes)
```

| Service    | Address on your machine            | Notes                                                                     |
| ---------- | ---------------------------------- | ------------------------------------------------------------------------- |
| `frontend` | http://localhost:3000/en           | Built with `VITE_API_URL=http://localhost:4000`; renders through `http://api:4000`. |
| `api`      | http://localhost:4000/v1/health    | `NODE_ENV=production`, with PostgreSQL and Redis.                          |
| `worker`   | none                               | Runs the scans; healthy while its heartbeat file is fresh.                |
| `postgres` | `localhost:5433`                   | Bound to localhost only.                                                  |
| `redis`    | `localhost:6379`                   | Bound to localhost only, with `noeviction`.                               |

- The data services start without the app too: `docker compose up -d` starts only PostgreSQL and Redis, for development against them (see [Development](DEVELOPMENT.md#three-ways-to-run-it)).
- PostgreSQL and Redis have a password: `sitehp` unless `POSTGRES_PASSWORD` or `REDIS_PASSWORD` is set in the environment or in a `.env` file in the repository root. PostgreSQL takes its password only when its volume is first created.
- Run it in the background with `docker compose --profile app up -d --build`, read a log with `docker compose logs -f worker`, and add scanning capacity with `docker compose --profile app up -d --scale worker=3`.
- `docker compose down -v` also deletes the data volumes.

For a public deployment, put a reverse proxy with TLS in front of the frontend and the API, set `CORS_ORIGINS`, `VITE_SITE_URL`, `VITE_API_URL` and `VITE_ALLOW_INDEXING`, change the database and Redis passwords, set `TRUSTED_PROXY_HOPS` and `TRUSTED_PROXY_CIDRS` to match the proxy, and turn off response buffering for `/v1/scans/*/events`.
