#!/bin/bash
# Installs the kobiton CLI for the run-interactive-session skill:
#
#   1. Ensures the CLI build pinned in skills/run-interactive-session/CLI_VERSION
#      is cached at ~/.kobiton/cli/<version>/ — downloaded from
#      https://public.kobiton.download with mandatory sha256 verification.
#      A cache hit performs no network I/O, so session start stays fast.
#   2. Installs the ~/.kobiton/bin/kobiton entry point pointing at this
#      plugin version's run.sh wrapper (symlink on macOS/Linux; a bash
#      exec-shim on Windows, where MSYS `ln -sf` copies files and the copy
#      would break run.sh's own symlink-based path resolution).
#
# Idempotent - safe to invoke repeatedly.
#
# Invoked from four places, one per supported AI host:
#   1. Claude Code's SessionStart hook (auto, every session) declared
#      in hooks/hooks.json. The /automate:setup slash command also
#      invokes it on demand.
#   2. Codex CLI's SessionStart hook (auto, every session). Codex
#      loads the same hooks/hooks.json via the `hooks` field in
#      .codex-plugin/plugin.json; on first run the user must trust
#      the hook once via Codex's /hooks command.
#   3. GitHub Copilot CLI via the /automate:setup slash command -
#      Copilot loads Claude-format markdown commands, but has no
#      SessionStart hook, so users run /automate:setup once after
#      install.
#   4. Gemini CLI via the /automate:setup slash command - Gemini
#      loads bundled TOML commands at commands/automate/setup.toml,
#      which invokes this script upfront via !{...} as Step 0.
#
# Exit codes: 0 on success and on tolerated conditions (unsupported
# platform, offline with a usable cache); 1 only on a failed download or
# checksum mismatch, so setup surfaces the failure. Never leaves a partial
# download at a resolved cache path.
#
# Plugin root resolution: prefer CLAUDE_PLUGIN_ROOT if the host CLI
# injected it (Codex sets it as a compatibility alias for its own
# PLUGIN_ROOT); otherwise derive from this script's own location
# (`<plugin-root>/scripts/install-cli.sh`).

set -euo pipefail

if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  PLUGIN_ROOT="$CLAUDE_PLUGIN_ROOT"
else
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

TARGET="${PLUGIN_ROOT}/skills/run-interactive-session/scripts/run.sh"
LINK="$HOME/.kobiton/bin/kobiton"
PIN_FILE="${PLUGIN_ROOT}/skills/run-interactive-session/CLI_VERSION"
# KOBITON_CLI_BASE_URL overrides the download endpoint (tests, mirrors).
BASE_URL="${KOBITON_CLI_BASE_URL:-https://public.kobiton.download/kobiton-cli}"
CACHE_ROOT="$HOME/.kobiton/cli"

# Only act if the wrapper script exists in this plugin
[ -f "$TARGET" ] || exit 0

# --- 1. Platform detection -------------------------------------------------
# Published artifacts (one per platform, each with a .sha256 sibling):
#   macos-arm64.tgz  linux-x64.tgz  win-x64.zip
OS="$(uname -s)"
ARCH="$(uname -m)"
ARTIFACT=""
BIN_NAME="kobiton"
WINDOWS=""
case "$OS" in
  Darwin)
    # A shell running under Rosetta 2 reports x86_64 on Apple Silicon;
    # sysctl.proc_translated=1 identifies that case so M-series Macs
    # aren't mis-classified as Intel.
    if [ "$ARCH" = "x86_64" ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = "1" ]; then
      ARCH="arm64"
    fi
    case "$ARCH" in
      arm64) ARTIFACT="macos-arm64.tgz" ;;
      *)
        echo "kobiton CLI: Intel Macs are not supported (no macos-x64 build is published)." >&2
        echo "Use the run-automation-suite or drive-automation-session skills instead." >&2
        exit 0
        ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      x86_64) ARTIFACT="linux-x64.tgz" ;;
      *)
        echo "kobiton CLI: unsupported Linux architecture '$ARCH' (only x86_64 builds are published)." >&2
        exit 0
        ;;
    esac
    ;;
  MINGW*|MSYS*|CYGWIN*)
    ARTIFACT="win-x64.zip"
    BIN_NAME="kobiton.exe"
    WINDOWS=1
    ;;
  *)
    echo "kobiton CLI: unsupported platform '$OS'." >&2
    exit 0
    ;;
esac

# --- 2. Helpers -------------------------------------------------------------

# sha256 <file> -> prints the hex digest
sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    return 1
  fi
}

# fetch <url> <outfile> -> prints the HTTP status code ("000" = no connection)
fetch() {
  curl -sSL --connect-timeout 5 --max-time 300 -o "$2" -w '%{http_code}' "$1" 2>/dev/null || echo "000"
}

# newest_cached -> prints the path of the newest cached binary, or nothing
newest_cached() {
  local newest="" c d
  for d in "$CACHE_ROOT"/*/; do
    c="${d}${BIN_NAME}"
    [ -x "$c" ] || continue
    if [ -z "$newest" ] || [ "$c" -nt "$newest" ]; then newest="$c"; fi
  done
  [ -n "$newest" ] && printf '%s\n' "$newest"
}

# extract <archive> <workdir> -> unpacks the single CLI binary into <workdir>
extract() {
  case "$1" in
    *.tgz) tar -xzf "$1" -C "$2" ;;
    *.zip)
      if command -v unzip >/dev/null 2>&1; then
        unzip -oq "$1" -d "$2"
      else
        # Git Bash without unzip: fall back to PowerShell (always present on Windows)
        powershell.exe -NoProfile -Command \
          "Expand-Archive -Path '$(cygpath -w "$1")' -DestinationPath '$(cygpath -w "$2")' -Force"
      fi
      ;;
  esac
}

# download_version <version> -> installs that build into the cache; returns
# 0 ok, 4 on HTTP 404 (pruned/unknown version), 2 on network failure,
# 1 on checksum/extract failure. Never leaves partial files in the cache.
download_version() {
  local version="$1" tmp code expected actual
  tmp="$(mktemp -d "$CACHE_ROOT/.download.XXXXXX")"

  code="$(fetch "$BASE_URL/$version/$ARTIFACT" "$tmp/$ARTIFACT")"
  if [ "$code" = "404" ]; then rm -rf "$tmp"; return 4; fi
  if [ "$code" != "200" ]; then rm -rf "$tmp"; return 2; fi

  code="$(fetch "$BASE_URL/$version/$ARTIFACT.sha256" "$tmp/$ARTIFACT.sha256")"
  if [ "$code" != "200" ]; then
    echo "kobiton CLI: could not fetch checksum for $version (HTTP $code) - refusing unverified install." >&2
    rm -rf "$tmp"; return 1
  fi

  expected="$(awk '{print $1}' "$tmp/$ARTIFACT.sha256")"
  actual="$(sha256 "$tmp/$ARTIFACT")" || {
    echo "kobiton CLI: no sha256 tool available (need shasum or sha256sum) - refusing unverified install." >&2
    rm -rf "$tmp"; return 1
  }
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    echo "kobiton CLI: checksum mismatch for $ARTIFACT ($version) - download discarded, existing cache untouched." >&2
    rm -rf "$tmp"; return 1
  fi

  extract "$tmp/$ARTIFACT" "$tmp" || { rm -rf "$tmp"; return 1; }
  if [ ! -f "$tmp/$BIN_NAME" ]; then
    echo "kobiton CLI: $BIN_NAME not found inside $ARTIFACT - download discarded." >&2
    rm -rf "$tmp"; return 1
  fi
  chmod +x "$tmp/$BIN_NAME"
  mkdir -p "$CACHE_ROOT/$version"
  mv -f "$tmp/$BIN_NAME" "$CACHE_ROOT/$version/$BIN_NAME"
  rm -rf "$tmp"
  return 0
}

# latest_version -> resolves the current version from the /latest/ redirect
latest_version() {
  curl -sI --connect-timeout 5 --max-time 15 "$BASE_URL/latest/" 2>/dev/null \
    | awk 'tolower($1)=="location:"{print $2}' | tr -d '\r' \
    | sed -e 's|/$||' -e 's|.*/||'
}

# --- 3. Ensure the pinned CLI build is cached --------------------------------
mkdir -p "$CACHE_ROOT"
PIN=""
[ -f "$PIN_FILE" ] && PIN="$(tr -d '[:space:]' < "$PIN_FILE")"

if [ -n "$PIN" ] && [ ! -x "$CACHE_ROOT/$PIN/$BIN_NAME" ]; then
  download_version "$PIN" && rc=0 || rc=$?   # capture without tripping set -e
  case $rc in
    0) : ;; # pinned build cached
    4)
      # Pinned folder pruned from the download server (retention is not
      # keep-all). Prefer an existing cache; only chase `latest` as the
      # no-cache fallback - never as the default.
      if [ -n "$(newest_cached)" ]; then
        echo "kobiton CLI: pinned version $PIN is no longer published; keeping the cached build ($(basename "$(dirname "$(newest_cached)")")). Run /automate:doctor for details." >&2
      else
        # `|| true`: under set -e/pipefail a curl failure in the bare
        # assignment would abort the script before the wrapper install below.
        LATEST="$(latest_version || true)"
        # Accept only version-shaped values (published versions start with a
        # digit) - rejects empty, '..', and hostile redirect payloads before
        # $LATEST is used in cache paths.
        case "$LATEST" in
          [0-9]*) : ;;
          *) LATEST="" ;;
        esac
        if [ -n "$LATEST" ] && download_version "$LATEST"; then
          echo "WARNING: kobiton CLI pinned version $PIN is no longer published and no cache existed." >&2
          echo "WARNING: installed the current build ($LATEST) instead - it is NEWER than what this plugin release was validated against. Behavior may differ; report issues on the plugin repo." >&2
        else
          echo "kobiton CLI: pinned version $PIN is gone and the fallback download failed. Run /automate:setup when the network is available." >&2
        fi
      fi
      ;;
    2)
      if [ -n "$(newest_cached)" ]; then
        : # offline but a cached build exists - run.sh will use it; stay quiet
      else
        echo "kobiton CLI: could not download version $PIN (network unavailable?) and no cached build exists." >&2
        echo "Run /automate:setup once the network is available." >&2
      fi
      ;;
    1) exit 1 ;; # checksum/extract failure - loud and non-zero
  esac
fi

# --- 4. Install the ~/.kobiton/bin/kobiton entry point -----------------------
mkdir -p "$HOME/.kobiton/bin"
if [ -n "$WINDOWS" ]; then
  # MSYS `ln -sf` copies the file instead of symlinking; a copied run.sh
  # can't locate its skill directory. Use a tiny exec shim instead.
  printf '#!/bin/bash\nexec bash "%s" "$@"\n' "$TARGET" > "$LINK"
  chmod +x "$LINK"
else
  ln -sf "$TARGET" "$LINK"
fi
chmod +x "$TARGET"
