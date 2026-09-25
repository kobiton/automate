#!/bin/bash
# Wrapper for the virtualUSB client used by the debug-device-over-vusb skill.
# Usage: vusb [vusb args...]
# Install: created by scripts/vusb-preflight.sh as ~/.kobiton/bin/vusb
#          (symlink on macOS, bash exec-shim on Windows).
#
# What it does:
#   1. Resolves the client binary by absolute path - never via PATH.
#   2. On `login` without an explicit --apikey, injects --apibaseurl,
#      --username and --apikey from ~/.kobiton/.credentials so the API key
#      never appears in the agent transcript.
#   3. exec's the client with the (possibly extended) arguments verbatim -
#      the exit code is the client's own. Note that `vusb status` exits 0 even
#      when it fails; callers parse its output.
#
# Environment overrides (tests): KOBITON_VUSB_SYSTEM_APP, KOBITON_VUSB_PLATFORM_OVERRIDE.

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

# --- 1. Resolve the client binary ---
# vusb-preflight.sh (skill Step 1) caches the build pinned in
# $SKILL_DIR/VUSB_VERSION under ~/.kobiton/vusb/<version>/virtualUSB.app on
# macOS; on Windows the human installs the .msi to Program Files. This wrapper
# only resolves; it never downloads.
CACHE_ROOT="$HOME/.kobiton/vusb"
SYSTEM_APP="${KOBITON_VUSB_SYSTEM_APP:-/Applications/virtualUSB.app}"
WIN_EXE="/c/Program Files/virtualUSB/vusb.exe"
PIN=""
[ -f "$SKILL_DIR/VUSB_VERSION" ] && PIN="$(tr -d '[:space:]' < "$SKILL_DIR/VUSB_VERSION")"
PREFLIGHT_HINT="Run the debug-device-over-vusb preflight: bash \"$SKILL_DIR/scripts/vusb-preflight.sh\""

version_token() {
  "$1" --version 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "virtualUSB") {print $(i + 1); exit}}' || true
}

BINARY=""
case "${KOBITON_VUSB_PLATFORM_OVERRIDE:-$(uname -s)}" in
  Darwin)
    if [ -n "$PIN" ] && [ -x "$CACHE_ROOT/$PIN/virtualUSB.app/Contents/MacOS/vusb" ]; then
      BINARY="$CACHE_ROOT/$PIN/virtualUSB.app/Contents/MacOS/vusb"
    elif [ -x "$SYSTEM_APP/Contents/MacOS/vusb" ] && [ "$(version_token "$SYSTEM_APP/Contents/MacOS/vusb")" = "$PIN" ]; then
      BINARY="$SYSTEM_APP/Contents/MacOS/vusb"
    else
      # Pinned build not cached (pruned upstream, offline, or the pin changed):
      # use the newest cached bundle with a warning.
      for d in "$CACHE_ROOT"/*/; do
        c="${d}virtualUSB.app/Contents/MacOS/vusb"
        [ -x "$c" ] || continue
        if [ -z "$BINARY" ] || [ "$c" -nt "$BINARY" ]; then BINARY="$c"; fi
      done
      if [ -n "$BINARY" ]; then
        echo "Warning: pinned virtualUSB version ${PIN:-unknown} is not cached; using $(basename "$(dirname "$(dirname "$(dirname "$(dirname "$BINARY")")")")") instead. Run /automate:doctor for details." >&2
      fi
    fi
    if [ -z "$BINARY" ]; then
      echo "Error: the virtualUSB client is not installed (no cached bundle under $CACHE_ROOT and no matching $SYSTEM_APP)." >&2
      echo "$PREFLIGHT_HINT" >&2
      exit 1
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    if [ -x "$WIN_EXE" ]; then
      BINARY="$WIN_EXE"
    else
      echo "Error: the virtualUSB client is not installed (\"C:\\Program Files\\virtualUSB\\vusb.exe\" not found)." >&2
      echo "$PREFLIGHT_HINT - it downloads the installer and prints the steps to run it." >&2
      exit 1
    fi
    ;;
  *)
    echo "Error: the debug-device-over-vusb skill supports macOS and Windows hosts only." >&2
    exit 1
    ;;
esac

# --- 2. `login`: inject credentials from ~/.kobiton/.credentials -------------
# Only when the caller did not pass --apikey. Flags already present are kept.
# The INI profile parser below is a COPY of the one in
# run-interactive-session/scripts/run.sh §2 - each wrapper must stay standalone
# through its own ~/.kobiton/bin symlink. Keep in lock-step with
# run-interactive-session/scripts/run.sh §2.
if [ "${1:-}" = "login" ]; then
  HAS_KEY=""; HAS_USER=""; HAS_BASE=""
  for a in "$@"; do
    case "$a" in
      --apikey|--apikey=*)         HAS_KEY=1 ;;
      --username|--username=*)     HAS_USER=1 ;;
      --apibaseurl|--apibaseurl=*) HAS_BASE=1 ;;
      -h|--help)                   HAS_KEY=1 ;; # `login --help` passes through untouched
    esac
  done
  if [ -z "$HAS_KEY" ]; then
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
    fi

    # Portal/API host fallback from the plugin's .mcp.json (MCP URL minus /mcp)
    if [ -z "${KOBITON_PORTAL:-}" ]; then
      MCP_FILE="$PROJECT_ROOT/.mcp.json"
      if [ -f "$MCP_FILE" ]; then
        MCP_URL=$(MCP_FILE="$MCP_FILE" node -e "
          const m=JSON.parse(require('fs').readFileSync(process.env.MCP_FILE,'utf8'));
          const s=m.mcpServers?.kobiton;
          console.log(s?.url || '');
        " 2>/dev/null || true)
        [ -n "$MCP_URL" ] && KOBITON_PORTAL="${MCP_URL%/mcp}"
      fi
    fi

    MISSING=()
    [ -z "${KOBITON_PORTAL:-}" ]  && MISSING+=("KOBITON_PORTAL")
    [ -z "${KOBITON_USER:-}" ]    && MISSING+=("KOBITON_USER")
    [ -z "${KOBITON_API_KEY:-}" ] && MISSING+=("KOBITON_API_KEY")
    if [ ${#MISSING[@]} -gt 0 ]; then
      echo "Error: Missing ${MISSING[*]}." >&2
      echo "Run /automate:doctor to diagnose, or /automate:setup to fetch fresh credentials." >&2
      exit 1
    fi

    # The client wants the API base URL. KOBITON_PORTAL is normally already the
    # API host (https://api.kobiton.com); a portal host is mapped to its API twin.
    API_BASE="${KOBITON_PORTAL%/}"
    case "$API_BASE" in
      https://portal.*) API_BASE="https://api.${API_BASE#https://portal.}" ;;
      http://portal.*)  API_BASE="http://api.${API_BASE#http://portal.}" ;;
    esac

    shift # drop `login`; re-add it with the injected flags first
    INJECT=(login)
    [ -z "$HAS_BASE" ] && INJECT+=(--apibaseurl "$API_BASE")
    [ -z "$HAS_USER" ] && INJECT+=(--username "$KOBITON_USER")
    INJECT+=(--apikey "$KOBITON_API_KEY")
    set -- "${INJECT[@]}" "$@"
  fi
fi

# --- 3. Run the client (its own exit code; `status` exits 0 even on failure) ---
exec "$BINARY" "$@"
