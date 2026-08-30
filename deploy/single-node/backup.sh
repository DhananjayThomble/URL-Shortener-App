#!/usr/bin/env bash
#
# Back up the SnapURL Postgres database to a timestamped, gzipped SQL dump.
#
# Two ways to run it:
#
#   1. Against a plain connection string (used by CI's restore test, and by
#      anyone who can reach the database directly):
#
#        DATABASE_URL=postgres://user:pass@host:5432/db ./backup.sh
#
#   2. Against the running compose stack (the usual operator path): with no
#      DATABASE_URL set, it reads .env and runs pg_dump inside the postgres
#      container via `docker compose exec`.
#
#        ./backup.sh
#
# Output: $BACKUP_DIR/snapurl-YYYYmmdd-HHMMSS.sql.gz  (BACKUP_DIR defaults to
# ./backups). The dump is a plain SQL script that restore.sh replays with psql.
#
# Cron example (daily at 03:30; no secrets on the command line — they live in
# .env or the DATABASE_URL exported in the crontab environment):
#
#   30 3 * * * cd /opt/URL-Shortener-App/deploy/single-node && ./backup.sh >> backup.log 2>&1

set -euo pipefail

cd "$(dirname "$0")"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"
outfile="$BACKUP_DIR/snapurl-$timestamp.sql.gz"

if [ -n "${DATABASE_URL:-}" ]; then
	# Direct mode: dump over the connection string. pg_dump refuses to dump a
	# server NEWER than the client, and this project runs Postgres 18 (needed
	# for uuidv7()). The client must therefore be >= the server's major
	# version. PG_DUMP lets you point at a matching client (for example one
	# from a postgres:18 container) when the host pg_dump is older; it defaults
	# to whatever pg_dump is on PATH.
	PG_DUMP="${PG_DUMP:-pg_dump}"
	echo "Backing up via DATABASE_URL to $outfile"
	$PG_DUMP --no-owner --no-privileges "$DATABASE_URL" | gzip >"$outfile"
else
	# Compose mode: dump from inside the postgres container using its own
	# credentials from .env.
	if [ ! -f .env ]; then
		echo "error: no DATABASE_URL set and no .env found. Run ./init.sh first" >&2
		echo "       or export DATABASE_URL to back up a specific database." >&2
		exit 1
	fi
	# shellcheck disable=SC1091
	set -a; . ./.env; set +a
	: "${POSTGRES_USER:?POSTGRES_USER missing from .env}"
	: "${POSTGRES_DB:?POSTGRES_DB missing from .env}"
	echo "Backing up compose postgres ($POSTGRES_DB) to $outfile"
	docker compose exec -T postgres \
		pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB" \
		| gzip >"$outfile"
fi

echo "Wrote $outfile ($(du -h "$outfile" | cut -f1))"
