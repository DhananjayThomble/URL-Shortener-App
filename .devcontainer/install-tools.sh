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

# install_url_bin: for tools whose checksum file covers only the one asset
# (a bare "<hash>" or a "<hash>  <name>" line) rather than a shared multi-file
# checksums.txt, and/or whose release artifacts are not hosted on GitHub.
# <checksum-has-filename> distinguishes kubectl's bare-hash file (no filename
# column) from kind's "<hash>  <asset>" file so both can share this helper.
install_url_bin() { # name binary-url checksum-url checksum-has-filename(0|1)
  local name=$1 url=$2 sums_url=$3 named=$4
  command -v "$name" >/dev/null && { echo "$name already installed"; return; }
  fetch "$url" "$name.bin"
  fetch "$sums_url" "$name.sha256"
  if [ "$named" = "1" ]; then
    (cd "$TMP" && awk '{print $1"  '"$name.bin"'"}' "$name.sha256" | sha256sum -c -)
  else
    (cd "$TMP" && echo "$(cat "$name.sha256")  $name.bin" | sha256sum -c -)
  fi
  $SUDO install -m 0755 "$TMP/$name.bin" "$BIN/$name"
}

# install_url_tar: same idea as install_url_bin, but the checksum covers a
# tar.gz that must be extracted first.
install_url_tar() { # name tarball-url checksum-url inner-path-in-archive
  local name=$1 url=$2 sums_url=$3 inner=$4
  command -v "$name" >/dev/null && { echo "$name already installed"; return; }
  local asset="${url##*/}"
  fetch "$url" "$asset"
  fetch "$sums_url" "$asset.sha256sum"
  (cd "$TMP" && awk '{print $1"  '"$asset"'"}' "$asset.sha256sum" | sha256sum -c -)
  mkdir -p "$TMP/$name" && tar -xzf "$TMP/$asset" -C "$TMP/$name"
  $SUDO install -m 0755 "$TMP/$name/$inner" "$BIN/$name"
}

install_tar gitleaks   gitleaks/gitleaks   v8.30.1  gitleaks_8.30.1_linux_x64.tar.gz       gitleaks_8.30.1_checksums.txt   gitleaks
install_tar trivy      aquasecurity/trivy  v0.74.0  trivy_0.74.0_Linux-64bit.tar.gz        trivy_0.74.0_checksums.txt      trivy
install_tar actionlint rhysd/actionlint    v1.7.12  actionlint_1.7.12_linux_amd64.tar.gz   actionlint_1.7.12_checksums.txt actionlint
install_tar k6         grafana/k6          v2.2.0   k6-v2.2.0-linux-amd64.tar.gz           k6-v2.2.0-checksums.txt         k6-v2.2.0-linux-amd64/k6
install_bin osv-scanner google/osv-scanner v2.6.0   osv-scanner_linux_amd64                osv-scanner_SHA256SUMS
install_bin hadolint   hadolint/hadolint   v2.15.1  hadolint-linux-x86_64                  checksums.sha256

# Helm profile tools (deploy/helm/snapurl, exercised by .github/workflows/deploy-helm.yml
# and the "cloud" agent role, which previously had to install helm on demand).
# helm's GitHub release only carries detached PGP signatures, not the tarballs
# themselves or a plain checksum file (checked directly: `helm-vX.Y.Z-linux-amd64.tar.gz`
# 404s under releases/download, only the `.asc` signature variants exist there).
# The actual binaries and their plain sha256sum files are served from
# get.helm.sh, pinned to v3.16.3 — the same version azure/setup-helm pins in
# deploy-helm.yml. kind is pinned to v0.31.0, matching helm/kind-action@v1's
# default there. kubectl is pinned to v1.35.8 (latest 1.35.x stable per
# https://dl.k8s.io/release/stable-1.35.txt) to track kind v0.31.0's default
# node image (Kubernetes 1.35).
install_url_tar helm \
  https://get.helm.sh/helm-v3.16.3-linux-amd64.tar.gz \
  https://get.helm.sh/helm-v3.16.3-linux-amd64.tar.gz.sha256sum \
  linux-amd64/helm
install_url_bin kubectl \
  https://dl.k8s.io/release/v1.35.8/bin/linux/amd64/kubectl \
  https://dl.k8s.io/release/v1.35.8/bin/linux/amd64/kubectl.sha256 \
  0
install_url_bin kind \
  https://github.com/kubernetes-sigs/kind/releases/download/v0.31.0/kind-linux-amd64 \
  https://github.com/kubernetes-sigs/kind/releases/download/v0.31.0/kind-linux-amd64.sha256sum \
  1

if ! command -v semgrep >/dev/null; then
  pipx install semgrep==1.177.0
fi

# OWASP ZAP runs as a container on demand (see docs/AGENTIC-DEV.md); pre-pull it here.
docker pull ghcr.io/zaproxy/zaproxy:stable >/dev/null 2>&1 || echo "zap image pull skipped (docker not ready)"

echo "tools installed into $BIN"
