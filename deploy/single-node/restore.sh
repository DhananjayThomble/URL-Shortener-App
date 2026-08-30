#!/usr/bin/env bash
#
# Restore a backup produced by backup.sh into the target database.
#
# The dump is a plain SQL script (gzipped), so restoring is replaying it with
# psql. Non-interactive by design so CI and cron can call it.
#
# Two ways to run it, mirroring backup.sh:
#
#   1. Against a plain connection string (used by CI's restore test):
#
#        DATABASE_URL=postgres://user:pass@host:5432/db ./restore.sh backups/snapurl-20240101-000000.sql.gz
#
#   2. Against the running compose stack (reads .env, replays inside the
#      postgres container):
#
#        ./restore.sh backups/snapurl-20240101-000000.sql.gz
#
# WARNING: this replays a dump on top of the existing database. Restore into a
# fresh/empty database, or be certain you want to merge, before running it in
# production.

set -euo pipefail

cd "$(dirname "$0")"

if [ "$#" -ne 1 ] || [ -z "${1:-}" ]; then
	echo "usage: $0 <backup-file.sql.gz>" >&2
	echo "  DATABASE_URL=... $0 <file>   restore over a connection string" >&2
	echo "  $0 <file>                    restore into the compose postgres" >&2
	exit 1
fi

backup_file="$1"
if [ ! -f "$backup_file" ]; then
	echo "error: backup file not found: $backup_file" >&2
	exit 1
fi

# gzip -dc streams the SQL out; keep the .gz on disk untouched.
if [ -n "${DATABASE_URL:-}" ]; then
	echo "Restoring $backup_file via DATABASE_URL"
	# ON_ERROR_STOP so a failed statement aborts with a non-zero exit rather
	# than silently leaving a half-restored database.
	gzip -dc "$backup_file" | psql -v ON_ERROR_STOP=1 "$DATABASE_URL"
else
	if [ ! -f .env ]; then
		echo "error: no DATABASE_URL set and no .env found. Run ./init.sh first" >&2
		echo "       or export DATABASE_URL to restore into a specific database." >&2
		exit 1
	fi
	# shellcheck disable=SC1091
	set -a; . ./.env; set +a
	: "${POSTGRES_USER:?POSTGRES_USER missing from .env}"
	: "${POSTGRES_DB:?POSTGRES_DB missing from .env}"
	echo "Restoring $backup_file into compose postgres ($POSTGRES_DB)"
	gzip -dc "$backup_file" | docker compose exec -T postgres \
		psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"
fi

echo "Restore complete."
