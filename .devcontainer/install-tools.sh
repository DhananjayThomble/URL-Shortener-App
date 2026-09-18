#!/usr/bin/env bash
# Pinned QA / security CLIs, each verified against its release checksum file.
# Bump a version by editing the table; the checksum is fetched from the same release.
set -euo pipefail

BIN="${BIN_DIR:-/usr/local/bin}"
SUDO=""; [ -w "$BIN" ] || SUDO="sudo"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

fetch() { curl -fsSL --retry 3 -o "$TMP/$2" "$1"; }

# verify <checksums-file> <asset-name>
verify() {
  (cd "$TMP" && grep -E "[[:space:]]\*?$2\$" "$1" | sha256sum -c -)
}

install_tar() { # name repo tag asset checksums binary-in-archive
  local name=$1 repo=$2 tag=$3 asset=$4 sums=$5 inner=$6
  command -v "$name" >/dev/null && { echo "$name already installed"; return; }
  fetch "https://github.com/$repo/releases/download/$tag/$asset" "$asset"
  fetch "https://github.com/$repo/releases/download/$tag/$sums" "$sums"
  verify "$sums" "$asset"
  mkdir -p "$TMP/$name" && tar -xzf "$TMP/$asset" -C "$TMP/$name"
  $SUDO install -m 0755 "$TMP/$name/$inner" "$BIN/$name"
}

install_bin() { # name repo tag asset checksums
  local name=$1 repo=$2 tag=$3 asset=$4 sums=$5
  command -v "$name" >/dev/null && { echo "$name already installed"; return; }
  fetch "https://github.com/$repo/releases/download/$tag/$asset" "$asset"
  fetch "https://github.com/$repo/releases/download/$tag/$sums" "$sums"
  verify "$sums" "$asset"
  $SUDO install -m 0755 "$TMP/$asset" "$BIN/$name"
}

install_tar gitleaks   gitleaks/gitleaks   v8.30.1  gitleaks_8.30.1_linux_x64.tar.gz       gitleaks_8.30.1_checksums.txt   gitleaks
install_tar trivy      aquasecurity/trivy  v0.74.0  trivy_0.74.0_Linux-64bit.tar.gz        trivy_0.74.0_checksums.txt      trivy
install_tar actionlint rhysd/actionlint    v1.7.12  actionlint_1.7.12_linux_amd64.tar.gz   actionlint_1.7.12_checksums.txt actionlint
install_tar k6         grafana/k6          v2.2.0   k6-v2.2.0-linux-amd64.tar.gz           k6-v2.2.0-checksums.txt         k6-v2.2.0-linux-amd64/k6
install_bin osv-scanner google/osv-scanner v2.6.0   osv-scanner_linux_amd64                osv-scanner_SHA256SUMS
install_bin hadolint   hadolint/hadolint   v2.15.1  hadolint-linux-x86_64                  checksums.sha256

if ! command -v semgrep >/dev/null; then
  pipx install semgrep==1.177.0
fi

# OWASP ZAP runs as a container on demand (see docs/AGENTIC-DEV.md); pre-pull it here.
docker pull ghcr.io/zaproxy/zaproxy:stable >/dev/null 2>&1 || echo "zap image pull skipped (docker not ready)"

echo "tools installed into $BIN"
