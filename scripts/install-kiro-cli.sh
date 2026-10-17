#!/usr/bin/env bash
# Install kiro-cli for the QA-lab workflow, with a PINNED version and a
# PINNED sha256 that is verified before any code from the archive runs.
#
# Previously the workflow ran `curl -fsSL https://cli.kiro.dev/install | bash`,
# which pipes remote content straight into a shell with no integrity check at
# all (issue #631). This script instead:
#   1. downloads a specific, version-pinned kiro-cli archive,
#   2. checks its sha256 against a value PINNED in this repo (below), and
#   3. only on an exact match extracts and runs the archive's own install.sh.
#
# Why pin the sha256 in the repo rather than fetch it from a manifest:
# a checksum fetched from the SAME origin as the archive gives no protection
# against a compromised origin -- an attacker who can serve a tampered archive
# can serve a matching tampered checksum. Pinning the expected hash in version
# control makes the repo the trust anchor: the bytes that run in CI are exactly
# the bytes a human reviewed and pinned, and any drift (tampering, corruption,
# or a silent upstream re-publish) fails the job closed.
#
# ---------------------------------------------------------------------------
# HOW TO BUMP THE VERSION (do all three together, atomically, in one commit):
#   1. Fetch the current manifest to see the latest version and checksums:
#        curl -fsSL https://prod.download.cli.kiro.dev/stable/latest/manifest.json
#      Find the entry with  "fileType": "zip"  and
#      "targetTriple": "x86_64-unknown-linux-gnu" (the headless Linux x86_64
#      zip -- the same artifact this workflow runs on).
#   2. Set KIRO_CLI_VERSION to that manifest's top-level "version".
#   3. Set KIRO_CLI_SHA256 to that zip entry's "sha256".
#   Then verify locally that the pinned URL and hash agree before committing:
#        curl -fsSL -o /tmp/k.zip \
#          "https://prod.download.cli.kiro.dev/stable/${KIRO_CLI_VERSION}/${KIRO_CLI_ASSET}"
#        sha256sum /tmp/k.zip   # must equal KIRO_CLI_SHA256
#   (The version-pinned ARCHIVE path is directly fetchable; note the
#   version-pinned MANIFEST path is not served, so the manifest is only a
#   lookup aid for choosing the two pinned values, never fetched by this
#   script at run time.)
# ---------------------------------------------------------------------------
set -euo pipefail

# --- Pinned artifact (bump all three together; see HOW TO BUMP above) --------
KIRO_CLI_VERSION="2.32.0"
KIRO_CLI_ASSET="kirocli-x86_64-linux.zip"
KIRO_CLI_SHA256="7cea2c90198edc60ccaee9e0d9c9de26902b3824f54a66aa3639a365f7242fbb"
# -----------------------------------------------------------------------------

KIRO_CLI_URL="https://prod.download.cli.kiro.dev/stable/${KIRO_CLI_VERSION}/${KIRO_CLI_ASSET}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading kiro-cli ${KIRO_CLI_VERSION} from ${KIRO_CLI_URL}"
curl -fsSL --retry 3 -o "$TMP/$KIRO_CLI_ASSET" "$KIRO_CLI_URL"

actual_checksum="$(sha256sum "$TMP/$KIRO_CLI_ASSET" | cut -d' ' -f1)"
if [[ "$actual_checksum" != "$KIRO_CLI_SHA256" ]]; then
  echo "::error::kiro-cli checksum mismatch for ${KIRO_CLI_ASSET} (version ${KIRO_CLI_VERSION})." >&2
  echo "::error::expected ${KIRO_CLI_SHA256}, got ${actual_checksum}. Refusing to install." >&2
  exit 1
fi
echo "Checksum verified: ${actual_checksum}"

unzip -q "$TMP/$KIRO_CLI_ASSET" -d "$TMP/extract"

install_script="$TMP/extract/kirocli/install.sh"
if [[ ! -f "$install_script" ]]; then
  echo "::error::install.sh not found in verified kiro-cli archive" >&2
  exit 1
fi
chmod +x "$install_script"

# Install the binaries into ~/.local/bin without running the interactive
# first-run setup (KIRO_CLI_SKIP_SETUP is honoured by the archive's install.sh).
KIRO_CLI_SKIP_SETUP=1 "$install_script"
