#!/usr/bin/env bash
# staging-prune.sh — bounded Docker build-cache reclaim, run after every
# staging teardown (see package.json's staging:down).
#
# Why this exists: `pnpm staging:up` runs `docker compose ... up -d --build`
# on every QA/cloud session. `docker compose down -v` removes the staging
# stack's containers and volume but NEVER touches build cache or images, so
# the cache grows without bound across sessions until the host disk fills
# (see issue #485 — 82% and climbing, 0 of 254 build-cache records active).
#
# This is deliberately BOUNDED BY AGE (`until=24h`), not a blanket
# `docker system prune -af`:
#   - a session that is still mid-build elsewhere on the same host keeps its
#     warm cache (anything touched in the last 24h survives);
#   - it only reclaims cache/images that are already unreferenced by any
#     container — `docker builder prune`/`image prune` never touch a layer a
#     running container depends on.
# A stricter, unbounded, host-wide prune is a periodic job for the
# maintainer (systemd timer), not something a per-session teardown should do
# on an agent's behalf — see docs/AGENTIC-DEV.md.
set -euo pipefail

AGE="${STAGING_PRUNE_UNTIL:-24h}"

echo "[staging-prune] docker system df before:"
docker system df

echo "[staging-prune] docker builder prune -af --filter until=${AGE}"
docker builder prune -af --filter "until=${AGE}"

echo "[staging-prune] docker image prune -af --filter until=${AGE}"
docker image prune -af --filter "until=${AGE}"

echo "[staging-prune] docker system df after:"
docker system df
