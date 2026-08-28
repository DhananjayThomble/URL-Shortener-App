# syntax=docker/dockerfile:1.7

# One Dockerfile, three images.
#
#   docker build --build-arg APP=api      -t snapurl-api .
#   docker build --build-arg APP=redirect -t snapurl-redirect .
#   docker build --build-arg APP=worker   -t snapurl-worker .
#
# The three apps share a workspace, a lockfile and most of their build, so
# three near-identical Dockerfiles would drift apart the first time one of them
# changed. The interesting part — pruning a pnpm workspace down to one
# deployable app — is identical for all three and is explained at each stage.

ARG NODE_VERSION=22-alpine


# ---------------------------------------------------------------------------
# base — pnpm, once, so every later stage shares this layer
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Pin the version the lockfile was written by. A different pnpm can quietly
# resolve a different tree, which is the whole thing a lockfile exists to stop.
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
WORKDIR /repo


# ---------------------------------------------------------------------------
# build — install everything, compile everything
# ---------------------------------------------------------------------------
FROM base AS build

# Manifests first, sources second. Dependencies change far less often than
# code, so this ordering means an ordinary code edit reuses the install layer
# instead of re-downloading the world.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json        apps/api/
COPY apps/redirect/package.json   apps/redirect/
COPY apps/worker/package.json     apps/worker/
COPY packages/contract/package.json  packages/contract/
COPY packages/domain/package.json    packages/domain/
COPY packages/database/package.json  packages/database/

# --frozen-lockfile fails if any manifest disagrees with the lockfile, so an
# image can never be built from a dependency set nobody committed.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts=false

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/ apps/

# `pnpm -r build` walks the workspace in dependency order, so contract and
# domain are compiled before the apps that import their type declarations.
RUN pnpm -r --filter "./packages/*" build
ARG APP
RUN pnpm --filter "@snapurl/${APP}" build


# ---------------------------------------------------------------------------
# prune — one app plus exactly the dependencies it actually uses
# ---------------------------------------------------------------------------
FROM build AS prune
ARG APP

# `pnpm deploy` rewrites the workspace links (@snapurl/contract and friends)
# into real directories, so the result runs with no knowledge that a workspace
# ever existed. --prod drops devDependencies; --legacy is required because
# pnpm 10+ otherwise expects `inject-workspace-packages=true`, which this
# workspace deliberately does not use.
RUN pnpm deploy --legacy --filter "@snapurl/${APP}" --prod /out


# ---------------------------------------------------------------------------
# runtime — no pnpm, no sources, no build tools
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production

# `node` (uid 1000) ships with the official image. Running as root inside a
# container is a needless escalation if anything else goes wrong.
WORKDIR /app
COPY --from=prune --chown=node:node /out ./
USER node

# Documentation only — publishing the port is the runtime's decision. The API
# and redirect service read PORT; the worker ignores it and serves no HTTP.
EXPOSE 3001

# No HEALTHCHECK here on purpose: the three apps have different probes (the API
# is /api/v1/health, the redirect service is /health, and the worker has no HTTP
# surface at all). Whatever runs these — compose, ECS, Kubernetes — is the right
# place to say so, and it already has to.
CMD ["node", "dist/main.js"]
