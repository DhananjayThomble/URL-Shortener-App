#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

sudo apt-get update -qq && sudo apt-get install -y -qq tmux jq >/dev/null
corepack enable
pnpm install --frozen-lockfile
pnpm --filter snapurl-e2e exec playwright install --with-deps chromium firefox webkit chrome

bash .devcontainer/install-tools.sh

npm install -g @anthropic-ai/claude-code@2.1.274

command -v kiro-cli >/dev/null || curl -fsSL https://cli.kiro.dev/install | bash
command -v kirocrew >/dev/null || curl -fsSL https://download.crew.kiro.dev/cli.sh | sh

cat <<'EOF'

SnapURL agentic environment ready.
  1. claude            -> sign in (Claude subscription)
  2. kiro-cli login    -> sign in, or set the KIRO_API_KEY Codespaces secret for headless runs
  3. docs/AGENTIC-DEV.md explains the autopilot and the agent roles.
EOF
