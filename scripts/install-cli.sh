#!/bin/bash
# Installs the ~/.kobiton/bin/kobiton symlink pointing at this plugin
# version's run.sh wrapper. Idempotent — safe to invoke repeatedly.
#
# Called from three places:
#   1. Claude Code's SessionStart hook (auto, every session)
#   2. Codex CLI's SessionStart hook (auto; Codex sets
#      CLAUDE_PLUGIN_ROOT for hook compatibility)
#   3. /automate:setup command (manual, one-off per install — needed
#      for CLIs whose hook spec we don't ride on yet, e.g. Gemini)
#
# Plugin root resolution: prefer CLAUDE_PLUGIN_ROOT if the host CLI
# injected it; otherwise derive from this script's own location
# (`<plugin-root>/scripts/install-cli.sh`).

set -euo pipefail

if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  PLUGIN_ROOT="$CLAUDE_PLUGIN_ROOT"
else
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

TARGET="${PLUGIN_ROOT}/skills/run-interactive-test/scripts/run.sh"
LINK="$HOME/.kobiton/bin/kobiton"

# Only act if the target script exists in this plugin
[ -f "$TARGET" ] || exit 0

mkdir -p "$HOME/.kobiton/bin"
ln -sf "$TARGET" "$LINK"
chmod +x "$TARGET"
