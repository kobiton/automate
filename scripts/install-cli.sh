#!/bin/bash
# SessionStart hook: ensures ~/.kobiton/bin/kobiton symlink points to
# the current plugin version's run.sh. Re-creates on every session start
# so upgrades are picked up automatically.

set -euo pipefail

# CLAUDE_PLUGIN_ROOT is injected by Claude Code — not user-configurable
[ -n "${CLAUDE_PLUGIN_ROOT:-}" ] || exit 0

TARGET="${CLAUDE_PLUGIN_ROOT}/skills/run-interactive-test/scripts/run.sh"
LINK="$HOME/.kobiton/bin/kobiton"

# Only act if the target script exists in this plugin
[ -f "$TARGET" ] || exit 0

mkdir -p "$HOME/.kobiton/bin"
ln -sf "$TARGET" "$LINK"
chmod +x "$TARGET"
