# One Dockerfile, three images built from the same install: `api` and `worker` (the backend, started with different commands) and `frontend`.
# Build with docker-compose.yml (`pnpm stack`), or by hand: `docker build --target backend -t sitehp-api .` (`--target frontend` for the other).
#
# The Node and pnpm versions are the ones in .node-version and package.json: change them together (`pnpm policy` fails when they differ).
# The base image is pinned by digest (the multi-arch index): a re-pushed tag cannot change what is built. A new Node version needs a new
# digest: `docker buildx imagetools inspect node:<version>-bookworm-slim`.

FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS base
ENV PNPM_HOME=/pnpm CI=true
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@12.11.2
WORKDIR /repo

# The manifests only: copying them first keeps the install layers when only source changes.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY apps/e2e/package.json apps/e2e/
COPY packages/core/package.json packages/core/

# Each image installs only its own app and what it depends on (core), from the lockfile, so a frontend dependency does not rebuild the backend.
FROM manifests AS backend-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store --filter @sitehp.app/backend...

FROM manifests AS frontend-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store --filter @sitehp.app/frontend...

# ---- backend ----
FROM backend-deps AS backend-build
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/backend apps/backend
# Only the production dependencies, with the built files and the migrations, in one folder; from the same store cache (the network only for what it lacks).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter @sitehp.app/backend build \
    && pnpm --filter @sitehp.app/backend deploy --prod --prefer-offline --store-dir /pnpm/store /out/backend

FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS backend
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000
WORKDIR /app
COPY --from=backend-build --chown=node:node /out/backend/package.json ./
COPY --from=backend-build --chown=node:node /out/backend/node_modules node_modules
COPY --from=backend-build --chown=node:node /out/backend/dist dist
COPY --from=backend-build --chown=node:node /out/backend/drizzle drizzle
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.api.mjs"]

# ---- frontend ----
FROM frontend-deps AS frontend-build
# The browser calls the API at this address, and it is baked into the bundle: it is a build argument, not a runtime setting.
ARG VITE_API_URL=http://localhost:4000
ARG VITE_SITE_URL=http://localhost:3000
ARG VITE_ALLOW_INDEXING=false
# The pages say the product is in beta; turn it off for the real launch.
ARG VITE_SHOW_BETA=true
ENV VITE_API_URL=$VITE_API_URL VITE_SITE_URL=$VITE_SITE_URL VITE_ALLOW_INDEXING=$VITE_ALLOW_INDEXING VITE_SHOW_BETA=$VITE_SHOW_BETA
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/frontend apps/frontend
RUN pnpm --filter @sitehp.app/frontend build

FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS frontend
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
# Nitro's output carries its own dependencies.
COPY --from=frontend-build --chown=node:node /repo/apps/frontend/.output .output
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/en').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", ".output/server/index.mjs"]
