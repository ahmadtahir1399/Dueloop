# syntax=docker/dockerfile:1
# Two images from one Dockerfile (prompt 7 step 5; docs/self-hosting.md):
#   --target services  worker, inbound processor and webhooks: the same code and dependencies, different commands
#                      (one image keeps them on exactly the same build, so a version mismatch between them cannot happen)
#   --target web       the Next.js app as a traced standalone server (NEXT_PUBLIC_* values are inlined at build time,
#                      so this image is built per environment)
# Both run as the unprivileged `node` user (uid 1000) and contain no tests, fixtures, demo code, seed data or env files
# (.dockerignore; checked by `pnpm images:smoke`).
#
# Base image pinned by tag AND digest. To bump: `docker pull node:<version>-bookworm-slim`, then
# `docker image inspect --format '{{index .RepoDigests 0}}' node:<version>-bookworm-slim`, and update both parts here.
ARG NODE_IMAGE=node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df

# ---- shared: pnpm via corepack (version from package.json "packageManager") -------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
RUN corepack enable
WORKDIR /app
# Fetch pnpm once, keyed only on package.json, so a code change does not download it again (`corepack install`
# reads "packageManager"). A transient registry timeout at this point failed one clean-clone run.
COPY package.json ./
RUN corepack install

# ---- services: production dependencies of the worker, webhooks and ops packages only -----------------------------
FROM base AS services-build
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@dueloop/worker..." --filter "@dueloop/webhooks..." --filter "@dueloop/ops..."

FROM ${NODE_IMAGE} AS services
ENV NODE_ENV=production DUELOOP_SERVICE=worker
WORKDIR /app
# Owned by root, readable by everyone: the service user cannot modify its own code.
COPY --from=services-build /app /app
USER node
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 CMD ["node", "packages/ops/src/bin/healthcheck.ts"]
# Default command: the worker. Override per service (compose.selfhost.yml):
#   node packages/worker/src/bin/inbound.ts --loop      (DUELOOP_SERVICE=processor)
#   node packages/webhooks/src/bin/webhooks.ts          (DUELOOP_SERVICE=webhooks, PORT=8787)
CMD ["node", "packages/worker/src/bin/worker.ts", "--loop"]

# ---- web: Next.js standalone build ----------------------------------------------------------------------------
FROM base AS web-build
COPY . .
RUN pnpm install --frozen-lockfile --filter "@dueloop/web..."
# Public values only (they end up in the browser bundle). Secrets are runtime env, never build args.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @dueloop/web build

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=web-build /app/apps/web/.next/standalone ./
COPY --from=web-build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build /app/apps/web/public ./apps/web/public
# The only writable path: Next's cache directory.
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/web/server.js"]
