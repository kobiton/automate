#!/bin/bash
# Wrapper that resolves binary, portal URL, and credentials automatically.
# Usage: kobiton [kobiton-cli args...]
# Install: ln -sf <plugin-path>/skills/run-interactive-test/scripts/run.sh ~/.kobiton/bin/kobiton

set -euo pipefail

# --- Helper: trim leading and trailing whitespace (pure bash) ---
trim() { local v="$1"; v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"; printf '%s' "$v"; }

# Resolve symlinks so SCRIPT_DIR points to the real location, not the symlink
SOURCE="$0"
while [ -L "$SOURCE" ]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
SKILL_DIR="$SCRIPT_DIR/.."
PROJECT_ROOT="$SKILL_DIR/../.."

# --- 1. Resolve platform-specific binary ---
BIN_DIR="$SKILL_DIR/bin"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  darwin) PLATFORM="darwin" ;;
  linux)  PLATFORM="linux" ;;
  *)      echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

case "$ARCH" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64)        ARCH="x64" ;;
  *)             echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

BINARY="$BIN_DIR/kobiton-${PLATFORM}-${ARCH}"
if [ ! -f "$BINARY" ]; then
  echo "Binary not found: $BINARY" >&2; exit 1
fi
chmod +x "$BINARY" 2>/dev/null

# --- 2. Load credentials from ~/.kobiton/.credentials (INI profile format) ---
CRED_FILE="$HOME/.kobiton/.credentials"
if [ -z "${KOBITON_USER:-}" ] && [ -f "$CRED_FILE" ]; then
  PROFILE="${KOBITON_PROFILE:-default}"
  IN_PROFILE=false
  FOUND_PROFILE=false
  while IFS= read -r line || [ -n "$line" ]; do
    # Strip trailing whitespace from the raw line
    line="$(trim "$line")"
    # Skip blank lines and comments
    [[ -z "$line" || "$line" == \#* ]] && continue
    # Section header
    if [[ "$line" == \[*\] ]]; then
      section="${line#[}"
      section="${section%]}"
      section="$(trim "$section")"
      if [ "$section" = "$PROFILE" ]; then
        IN_PROFILE=true
        FOUND_PROFILE=true
      else
        # If we were in our profile, we've passed it — stop
        $IN_PROFILE && break
        IN_PROFILE=false
      fi
      continue
    fi
    # Key=Value inside our profile
    if $IN_PROFILE; then
      key="$(trim "${line%%=*}")"
      value="$(trim "${line#*=}")"
      case "$key" in
        KOBITON_USER)   KOBITON_USER="$value" ;;
        KOBITON_API_KEY) KOBITON_API_KEY="$value" ;;
        KOBITON_PORTAL)  KOBITON_PORTAL="$value" ;;
      esac
    fi
  done < "$CRED_FILE"

  if ! $FOUND_PROFILE; then
    echo "Error: Profile [$PROFILE] not found in $CRED_FILE" >&2
    exit 1
  fi

  export KOBITON_USER KOBITON_API_KEY
  [ -n "${KOBITON_PORTAL:-}" ] && export KOBITON_PORTAL
fi

# --- 3. Auto-derive portal URL from .mcp.json (fallback if not in credentials) ---
if [ -z "${KOBITON_PORTAL:-}" ]; then
  MCP_FILE="$PROJECT_ROOT/.mcp.json"
  if [ -f "$MCP_FILE" ]; then
    MCP_URL=$(MCP_FILE="$MCP_FILE" node -e "
      const m=JSON.parse(require('fs').readFileSync(process.env.MCP_FILE,'utf8'));
      const s=m.mcpServers?.kobiton;
      console.log(s?.url || '');
    " 2>/dev/null || true)
    if [ -n "$MCP_URL" ]; then
      export KOBITON_PORTAL="${MCP_URL%/mcp}"
    fi
  fi
fi

# --- 4. Validate minimum requirements ---
MISSING=()
[ -z "${KOBITON_PORTAL:-}" ]  && MISSING+=("KOBITON_PORTAL")
[ -z "${KOBITON_USER:-}" ]    && MISSING+=("KOBITON_USER")
[ -z "${KOBITON_API_KEY:-}" ] && MISSING+=("KOBITON_API_KEY")
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "Error: Missing ${MISSING[*]}. Create ~/.kobiton/.credentials with:" >&2
  echo "  [default]" >&2
  echo "  KOBITON_PORTAL=<your-portal-url>" >&2
  echo "  KOBITON_USER=<your-username>" >&2
  echo "  KOBITON_API_KEY=<your-api-key>" >&2
  exit 1
fi

# --- 5. Run the CLI (JWT at ~/.kobiton/.session is loaded by CLI itself) ---
exec "$BINARY" "$@"
