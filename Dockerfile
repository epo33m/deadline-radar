# syntax=docker/dockerfile:1
# Production image for the API (Bun + Elysia).
#
# Railway does not auto-detect Bun, so a Dockerfile is mandatory (see
# railway.json). The build context is the repository root so the Bun workspace
# (apps/api + packages/*) installs from the real root lockfile.
#
# Only the API image lives here — the web app deploys to Vercel and is never
# built in this image.
FROM oven/bun:1-alpine

# curl is used by the scheduler trigger; see docs/DEPLOY-PROD.md.
RUN apk add --no-cache curl

WORKDIR /app

# Workspace manifests first: the dependency layer stays cached while only
# source files change.
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/e2e/package.json ./apps/e2e/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/domain/package.json ./packages/domain/package.json
COPY packages/validation/package.json ./packages/validation/package.json

# Deliberately NOT --production: @sentry/bun is declared in apps/api
# devDependencies and is imported by src/lib/sentry.ts at boot, so pruning
# dev dependencies would crash the process on start.
RUN bun install --frozen-lockfile

COPY apps/api ./apps/api
COPY packages ./packages

WORKDIR /app/apps/api

# The app reads API_PORT (apps/api/src/env.ts:47); the platform assigns PORT.
ENV NODE_ENV=production
ENV API_PORT=4025
EXPOSE 4025

# `exec` so bun replaces the shell and receives SIGTERM directly. The platform
# PORT wins when it is set; otherwise the image default applies.
CMD ["sh", "-c", "API_PORT=${PORT:-$API_PORT} exec bun run src/index.ts"]
