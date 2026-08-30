#!/usr/bin/env bash
#
# First-run bootstrap for the single-node profile.
#
#   ./init.sh
#
# What it does, idempotently and safely to re-run:
#   1. If .env does not exist, copies .env.example to .env.
#   2. For each of JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, POSTGRES_PASSWORD,
#      if the value in .env is EMPTY, generates one and writes it in place.
#      Values that are already set are never overwritten.
#   3. Ensures the two JWT secrets differ.
#
# It never prints the generated secret values. After it runs, edit .env to set
# APP_DOMAIN / SHORT_DOMAIN / ACME_EMAIL, then `docker compose up -d`.

set -euo pipefail

cd "$(dirname "$0")"

ENV_FILE=".env"
EXAMPLE_FILE=".env.example"

if [ ! -f "$EXAMPLE_FILE" ]; then
	echo "error: $EXAMPLE_FILE not found (run this from deploy/single-node/)." >&2
	exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
	echo "error: openssl is required to generate secrets but was not found." >&2
	exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
	cp "$EXAMPLE_FILE" "$ENV_FILE"
	echo "Created $ENV_FILE from $EXAMPLE_FILE."
else
	echo "$ENV_FILE already exists; filling only empty secret fields."
fi

# Read the current value of a KEY= line from .env (empty if unset/blank).
current_value() {
	# Match "KEY=..." at line start; strip the "KEY=" prefix. No value -> "".
	sed -n "s/^$1=//p" "$ENV_FILE" | head -n1
}

# Set KEY=VALUE in .env in place. Assumes a "KEY=" line already exists (it does,
# because .env is seeded from .env.example which lists every key).
set_value() {
	local key="$1" value="$2" tmp
	tmp="$(mktemp)"
	# Use awk with the value passed via -v so no regex-special or shell-special
	# characters in the value can break the substitution.
	awk -v key="$key" -v val="$value" '
		$0 ~ "^" key "=" { print key "=" val; next }
		{ print }
	' "$ENV_FILE" >"$tmp"
	# Preserve permissions/ownership by copying content back into the file.
	cat "$tmp" >"$ENV_FILE"
	rm -f "$tmp"
}

# Generate a value into a key only if it is currently empty. Returns nothing;
# never echoes the secret.
ensure_secret() {
	local key="$1" generator="$2" existing
	existing="$(current_value "$key")"
	if [ -z "$existing" ]; then
		set_value "$key" "$($generator)"
		echo "  generated $key"
	else
		echo "  $key already set, leaving as-is"
	fi
}

# 64 hex chars: comfortably over the API's 32-char minimum.
gen_jwt() { openssl rand -hex 32; }
# 48 hex chars: alphanumeric only, so it is safe inside a DATABASE_URL and
# needs no shell/url escaping.
gen_pw() { openssl rand -hex 24; }

echo "Ensuring secrets:"
ensure_secret "JWT_ACCESS_SECRET" gen_jwt
ensure_secret "JWT_REFRESH_SECRET" gen_jwt
ensure_secret "POSTGRES_PASSWORD" gen_pw

# The two JWT secrets must differ. If a re-run or hand-edit left them equal,
# rotate the refresh secret (the access secret is shared with the redirect
# service, so prefer to change the refresh one).
access="$(current_value JWT_ACCESS_SECRET)"
refresh="$(current_value JWT_REFRESH_SECRET)"
if [ -n "$access" ] && [ "$access" = "$refresh" ]; then
	set_value "JWT_REFRESH_SECRET" "$(gen_jwt)"
	echo "  JWT secrets were identical; regenerated JWT_REFRESH_SECRET"
fi

cat <<'EOF'

Done. Next steps:
  1. Edit .env and set APP_DOMAIN, SHORT_DOMAIN (and optionally ACME_EMAIL).
  2. Point public DNS records for both domains at this host.
  3. Apply migrations:  docker compose --profile migrate up migrate
  4. Start the stack:   docker compose up -d

Secrets were written to .env and are not printed here. Keep .env private.
EOF
