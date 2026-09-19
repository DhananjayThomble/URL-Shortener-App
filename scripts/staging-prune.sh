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
# This only touches BUILD CACHE (`docker builder prune`), and is BOUNDED BY
# AGE (`until=24h`), not a blanket `docker system prune -af`:
#   - a session that is still mid-build elsewhere on the same host keeps its
#     warm cache (anything touched in the last 24h survives);
#   - it only reclaims cache that is already unreferenced by any container —
#     `docker builder prune` never touches a layer a running container
#     depends on.
#
# Deliberately does NOT run `docker image prune`. `image prune`'s `until`
# filters on image *creation* time, not last-pulled/last-used time. For a
# pulled base image (e.g. `postgres:18-alpine`), creation time is when it was
# built upstream, so a 24h window would evict it the instant no container
# references it — which is exactly the state right after `down -v` — and the
# next `staging:up`/`db:up` would silently re-pull it. That is a real cost
# (network + time), not a bounded no-op, so it is out of scope for this
# script. Deciding whether one-off images (e.g. `zaproxy`) belong on the
# Factory at all is also out of scope — see docs/AGENTIC-DEV.md.
#
# Best-effort: a prune failure (unreachable daemon, lock contention with a
# concurrent session) must never fail the teardown that calls this script.
# package.json invokes this with `; ` rather than `&&` for the same reason;
# the `|| true` below is defense in depth if this script is ever run/sourced
# some other way.
#
# A stricter, unbounded, host-wide prune is a periodic job for the
# maintainer (systemd timer), not something a per-session teardown should do
# on an agent's behalf — see docs/AGENTIC-DEV.md.
set -uo pipefail

AGE="${STAGING_PRUNE_UNTIL:-24h}"

echo "[staging-prune] docker system df before:"
docker system df || true

echo "[staging-prune] docker builder prune -af --filter until=${AGE}"
docker builder prune -af --filter "until=${AGE}" || true

echo "[staging-prune] docker system df after:"
docker system df || true

exit 0
