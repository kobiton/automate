#!/bin/bash
# Prepares the virtualUSB client for the debug-device-over-vusb skill:
#
#   1. Ensures the client build pinned in skills/debug-device-over-vusb/VUSB_VERSION
#      is available. On macOS the pinned macos.pkg is downloaded from
#      https://public.kobiton.download/virtualusb/<version>/ with mandatory
#      sha256 verification, unpacked, and cached as
#      ~/.kobiton/vusb/<version>/virtualUSB.app (the whole bundle - the
#      binary resolves its daemon and assets relative to itself). On Windows
#      the pinned windows.msi is downloaded and verified into the same cache,
#      but never executed: the installer needs UAC and a USB driver, so the
#      human finishes the install. Linux hosts are not supported by the skill.
#      A cache hit performs no network I/O.
#   2. Installs the ~/.kobiton/bin/vusb entry point pointing at this plugin
#      version's vusb.sh wrapper (symlink on macOS; a bash exec-shim on
#      Windows, where MSYS `ln -sf` copies files).
#
# Idempotent - safe to invoke repeatedly. Invoked by Step 1 of the skill, and
# by hand (`bash <plugin-root>/skills/debug-device-over-vusb/scripts/vusb-preflight.sh`).
# It is NOT run by the SessionStart hook: only users of this skill download
# the client.
#
# Output contract:
#   stdout - machine-readable `key=value` lines, in order:
#              platform=<darwin|windows|linux|unknown>
#              pin=<pinned version>
#              installed=<version token of the client in use, or empty>
#              latest=<version>            (only when the pinned folder is gone upstream)
#              vusb=<absolute path of the client in use, or empty>
#              outcome=<label>             (always the last line on exit 0)
#            labels: no action needed | installed | updated | handed off to human | redirected (limitation)
#   stderr - human-readable messages (hand-off steps, warnings, errors).
#   exit   - 0 on every tolerated outcome (including offline, or the pinned
#            folder pruned upstream, with or without a cache); 1 only on a
#            checksum mismatch, an unverifiable download, or an unpack
#            failure. Never leaves a partial download at a resolved cache path.
#
# Environment overrides (tests, mirrors):
#   KOBITON_VUSB_BASE_URL           download endpoint (default https://public.kobiton.download/virtualusb).
#                                   The .sha256 sidecar is fetched from the SAME host, so this is a trust
#                                   decision: point it only at a mirror you trust (or a local test server).
#   KOBITON_VUSB_SYSTEM_APP         system install to detect (default /Applications/virtualUSB.app)
#   KOBITON_VUSB_PLATFORM_OVERRIDE  value used instead of `uname -s`

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TARGET="$SKILL_DIR/scripts/vusb.sh"
LINK="$HOME/.kobiton/bin/vusb"
PIN_FILE="$SKILL_DIR/VUSB_VERSION"
BASE_URL="${KOBITON_VUSB_BASE_URL:-https://public.kobiton.download/virtualusb}"
CACHE_ROOT="$HOME/.kobiton/vusb"
SYSTEM_APP="${KOBITON_VUSB_SYSTEM_APP:-/Applications/virtualUSB.app}"
WIN_EXE="/c/Program Files/virtualUSB/vusb.exe"

PIN=""
[ -f "$PIN_FILE" ] && PIN="$(tr -d '[:space:]' < "$PIN_FILE")"

# --- 1. Platform table ---------------------------------------------------------
# Published artifacts per platform (each with a .sha256 sibling):
#   macos.pkg (universal)  windows.msi (x64)  amd64.deb / x86_64.rpm (Linux)
# MODE: cache    - download, verify, unpack into the cache, run from there
#       handoff  - download and verify the installer; the human runs it
#       redirect - the skill does not support this host; stop
OS="${KOBITON_VUSB_PLATFORM_OVERRIDE:-$(uname -s)}"
case "$OS" in
  Darwin)               PLATFORM="darwin";  ARTIFACT="macos.pkg";   MODE="cache" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows"; ARTIFACT="windows.msi"; MODE="handoff" ;;
  Linux)                PLATFORM="linux";   ARTIFACT="";            MODE="redirect" ;;
  *)                    PLATFORM="unknown"; ARTIFACT="";            MODE="redirect" ;;
esac

echo "platform=$PLATFORM"
echo "pin=$PIN"

if [ "$MODE" = "redirect" ]; then
  if [ "$PLATFORM" = "linux" ]; then
    echo "virtualUSB client: Linux hosts are not supported by the debug-device-over-vusb skill (Linux builds of the client exist, but the skill's connect/debug flow is validated on macOS and Windows only)." >&2
  else
    echo "virtualUSB client: unsupported platform '$OS'." >&2
  fi
  echo "Use a macOS or Windows host for virtualUSB debugging, or the run-interactive-session skill for device access from this host." >&2
  echo "installed="
  echo "vusb="
  echo "outcome=redirected (limitation)"
  exit 0
fi

if [ -z "$PIN" ]; then
  echo "virtualUSB client: no VUSB_VERSION pin found at $PIN_FILE - re-install the automate plugin; the pin file ships with it." >&2
  exit 1
fi

# --- 2. Helpers -----------------------------------------------------------------

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

# latest_version -> resolves the current version from the /latest/ redirect
latest_version() {
  curl -sI --connect-timeout 5 --max-time 15 "$BASE_URL/latest/" 2>/dev/null \
    | awk 'tolower($1)=="location:"{print $2}' | tr -d '\r' \
    | sed -e 's|/$||' -e 's|.*/||'
}

# version_token <vusb-path> -> prints the token after the word "virtualUSB"
# in `vusb --version` output ("virtualUSB 2609.111336.0+master.a033b54"), or nothing
version_token() {
  "$1" --version 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "virtualUSB") {print $(i + 1); exit}}' || true
}

# cached_client <version> -> prints the path of that version's client in the cache
cached_client() {
  if [ "$MODE" = "cache" ]; then
    printf '%s' "$CACHE_ROOT/$1/virtualUSB.app/Contents/MacOS/vusb"
  else
    printf '%s' "$CACHE_ROOT/$1/$ARTIFACT"
  fi
}

# newest_cached -> prints the path of the newest cached client (bundle binary
# on macOS, installer on Windows), or nothing. Always returns 0.
newest_cached() {
  local newest="" c d
  for d in "$CACHE_ROOT"/*/; do
    [ -d "$d" ] || continue
    c="$(cached_client "$(basename "$d")")"
    if [ "$MODE" = "cache" ]; then [ -x "$c" ] || continue; else [ -f "$c" ] || continue; fi
    if [ -z "$newest" ] || [ "$c" -nt "$newest" ]; then newest="$c"; fi
  done
  printf '%s' "$newest"
}

# unpack_pkg <pkg> <workdir> -> extracts the flat .pkg payload and sets
# APP_DIR to the unpacked virtualUSB.app; returns 1 when the bundle or its
# vusb binary is missing. gzip-compressed cpio payloads (the published form)
# go through gunzip | cpio; anything else falls back to pkgutil --expand-full.
unpack_pkg() {
  local pkg="$1" work="$2" payload magic
  APP_DIR=""
  mkdir -p "$work/x" "$work/root"
  xar -xf "$pkg" -C "$work/x" 2>/dev/null || return 1
  payload="$(find "$work/x" -name Payload -type f | head -1)"
  [ -n "$payload" ] || return 1
  magic="$(od -An -tx1 -N2 "$payload" | tr -d ' \n')"
  if [ "$magic" = "1f8b" ]; then
    (cd "$work/root" && gunzip -c "$payload" | cpio -idm 2>/dev/null) || return 1
  else
    rm -rf "$work/root"
    pkgutil --expand-full "$pkg" "$work/root" 2>/dev/null || return 1
  fi
  APP_DIR="$(find "$work/root" -maxdepth 4 -type d -name virtualUSB.app | head -1)"
  [ -n "$APP_DIR" ] && [ -x "$APP_DIR/Contents/MacOS/vusb" ]
}

# download_version <version> -> caches that build; returns 0 ok, 4 on HTTP 404
# (pruned/unknown version), 2 on network failure, 1 on checksum/unpack failure.
# Never leaves partial files in the cache.
download_version() {
  local version="$1" tmp code expected actual
  tmp="$(mktemp -d "$CACHE_ROOT/.download.XXXXXX")"

  code="$(fetch "$BASE_URL/$version/$ARTIFACT" "$tmp/$ARTIFACT")"
  if [ "$code" = "404" ]; then rm -rf "$tmp"; return 4; fi
  if [ "$code" != "200" ]; then rm -rf "$tmp"; return 2; fi

  code="$(fetch "$BASE_URL/$version/$ARTIFACT.sha256" "$tmp/$ARTIFACT.sha256")"
  if [ "$code" != "200" ]; then
    echo "virtualUSB client: could not fetch checksum for $version (HTTP $code) - refusing unverified install." >&2
    rm -rf "$tmp"; return 1
  fi

  # First field of the first line only, lowercased, CR stripped: tolerates
  # `<hex>  <file>`, bare `<hex>`, CRLF sidecars and trailing lines alike.
  expected="$(awk 'NR==1{print tolower($1)}' "$tmp/$ARTIFACT.sha256" | tr -d '\r')"
  actual="$(sha256 "$tmp/$ARTIFACT")" || {
    echo "virtualUSB client: no sha256 tool available (need shasum or sha256sum) - refusing unverified install." >&2
    rm -rf "$tmp"; return 1
  }
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    echo "virtualUSB client: checksum mismatch for $ARTIFACT ($version) - download discarded, existing cache untouched." >&2
    rm -rf "$tmp"; return 1
  fi

  if [ "$MODE" = "cache" ]; then
    if ! unpack_pkg "$tmp/$ARTIFACT" "$tmp"; then
      echo "virtualUSB client: could not unpack $ARTIFACT ($version), or virtualUSB.app/Contents/MacOS/vusb is missing inside it - download discarded." >&2
      rm -rf "$tmp"; return 1
    fi
    if ! { mkdir -p "$CACHE_ROOT/$version" \
        && rm -rf "$CACHE_ROOT/$version/virtualUSB.app" \
        && mv -f "$APP_DIR" "$CACHE_ROOT/$version/virtualUSB.app"; }; then
      echo "virtualUSB client: could not move the verified bundle into $CACHE_ROOT/$version - download discarded." >&2
      rm -rf "$tmp" "$CACHE_ROOT/$version/virtualUSB.app"; return 1
    fi
  else
    if ! { mkdir -p "$CACHE_ROOT/$version" && mv -f "$tmp/$ARTIFACT" "$CACHE_ROOT/$version/$ARTIFACT"; }; then
      echo "virtualUSB client: could not move the verified installer into $CACHE_ROOT/$version - download discarded." >&2
      rm -rf "$tmp"; return 1
    fi
  fi
  rm -rf "$tmp"
  return 0
}

# win_path <path> -> the Windows spelling of a Git Bash path, for hand-off text
win_path() {
  cygpath -w "$1" 2>/dev/null || printf '%s' "$1"
}

# windows_handoff_steps <installer-path>
windows_handoff_steps() {
  echo "Finish the virtualUSB install by hand (it needs administrator rights):" >&2
  echo "  1. Run \"$(win_path "$1")\" and accept the UAC prompt - it installs the virtualUSB USB driver." >&2
  echo "  2. Open an administrator terminal and run: \"C:\\Program Files\\virtualUSB\\vusb.exe\" setup-adb" >&2
  echo "  3. Re-run this preflight." >&2
}

# --- 3. Detect the installed client / ensure the pinned build is cached ------------
mkdir -p "$CACHE_ROOT"
INSTALLED=""
VUSB=""
LATEST=""
OUTCOME=""
PINNED_CLIENT="$(cached_client "$PIN")"

# report_pruned -> sets LATEST from one HEAD on latest/ (version-shaped only)
report_pruned() {
  LATEST="$(latest_version || true)"
  case "$LATEST" in
    [0-9]*) : ;;
    *) LATEST="" ;;
  esac
}

if [ "$MODE" = "cache" ]; then
  SYSTEM_BIN="$SYSTEM_APP/Contents/MacOS/vusb"
  if [ -x "$SYSTEM_BIN" ]; then
    # (a) A system install wins: never unpack a second copy next to it.
    INSTALLED="$(version_token "$SYSTEM_BIN")"
    VUSB="$SYSTEM_BIN"
    if [ "$INSTALLED" = "$PIN" ]; then
      OUTCOME="no action needed"
    else
      echo "virtualUSB ${INSTALLED:-(unknown version)} is installed in $SYSTEM_APP; this plugin pins $PIN. Update or remove that install (virtualUSB 1 and 2 cannot coexist, and uninstalling leaves the daemon behind - remove it too), then re-run this preflight." >&2
      OUTCOME="handed off to human"
    fi
  elif [ -x "$PINNED_CLIENT" ]; then
    # (c) Cache hit: no network.
    INSTALLED="$(version_token "$PINNED_CLIENT")"
    VUSB="$PINNED_CLIENT"
    OUTCOME="no action needed"
  elif [ -z "$(newest_cached)" ] && pgrep -x dcb >/dev/null 2>&1; then
    # (b) A daemon of unknown origin is running, with no known client anywhere.
    echo "virtualUSB client: an unknown virtualUSB daemon (dcb) is running, and no virtualUSB.app was found in $SYSTEM_APP or under $CACHE_ROOT. It may belong to another virtualUSB install (virtualUSB 1 and 2 cannot coexist). Quit that virtualUSB app or uninstall the other client, then re-run this preflight." >&2
    OUTCOME="handed off to human"
  else
    HAD_CACHE="$(newest_cached)"
    download_version "$PIN" && rc=0 || rc=$?   # capture without tripping set -e
    case $rc in
      0)
        INSTALLED="$(version_token "$PINNED_CLIENT")"
        VUSB="$PINNED_CLIENT"
        if [ -n "$HAD_CACHE" ]; then OUTCOME="updated"; else OUTCOME="installed"; fi
        ;;
      4)
        report_pruned
        if [ -n "$HAD_CACHE" ]; then
          INSTALLED="$(version_token "$HAD_CACHE")"
          VUSB="$HAD_CACHE"
          echo "virtualUSB client: pinned version $PIN is no longer published; keeping the cached build ($INSTALLED). Update the automate plugin to the latest version${LATEST:+ (current client: $LATEST)}." >&2
          OUTCOME="no action needed"
        else
          echo "virtualUSB client: pinned version $PIN is no longer published and no cached build exists. Update the automate plugin to the latest version${LATEST:+ (current client: $LATEST)}, then re-run this preflight." >&2
          OUTCOME="handed off to human"
        fi
        ;;
      2)
        if [ -n "$HAD_CACHE" ]; then
          INSTALLED="$(version_token "$HAD_CACHE")"
          VUSB="$HAD_CACHE"
          echo "virtualUSB client: could not download version $PIN (network unavailable?); using the cached build ($INSTALLED)." >&2
          OUTCOME="no action needed"
        else
          echo "virtualUSB client: could not download version $PIN (network unavailable?) and no cached build exists. Re-run this preflight once the network is available." >&2
          OUTCOME="handed off to human"
        fi
        ;;
      1) exit 1 ;; # checksum/unpack failure - loud and non-zero
    esac
  fi
else
  # Windows: the client is installed by the human via the .msi; this script
  # only makes the verified installer available and reports drift.
  if [ -x "$WIN_EXE" ]; then
    INSTALLED="$(version_token "$WIN_EXE")"
    VUSB="$WIN_EXE"
  fi
  if [ "$INSTALLED" = "$PIN" ]; then
    OUTCOME="no action needed"
  else
    if [ -f "$PINNED_CLIENT" ]; then
      rc=0
    else
      download_version "$PIN" && rc=0 || rc=$?
    fi
    case $rc in
      0)
        if [ -n "$INSTALLED" ]; then
          echo "virtualUSB $INSTALLED is installed; this plugin pins $PIN." >&2
        else
          echo "virtualUSB is not installed on this machine." >&2
        fi
        windows_handoff_steps "$PINNED_CLIENT"
        OUTCOME="handed off to human"
        ;;
      4)
        report_pruned
        echo "virtualUSB client: pinned version $PIN is no longer published. Update the automate plugin to the latest version${LATEST:+ (current client: $LATEST)}, then re-run this preflight." >&2
        OUTCOME="handed off to human"
        ;;
      2)
        echo "virtualUSB client: could not download the $PIN installer (network unavailable?). Re-run this preflight once the network is available." >&2
        OUTCOME="handed off to human"
        ;;
      1) exit 1 ;;
    esac
  fi
fi

# --- 4. Install the ~/.kobiton/bin/vusb entry point ------------------------------
mkdir -p "$HOME/.kobiton/bin"
if [ "$MODE" = "handoff" ]; then
  # MSYS `ln -sf` copies the file instead of symlinking; a copied vusb.sh
  # can't locate its skill directory. Use a tiny exec shim instead.
  printf '#!/bin/bash\nexec bash "%s" "$@"\n' "$TARGET" > "$LINK"
  chmod +x "$LINK"
else
  ln -sf "$TARGET" "$LINK"
fi
chmod +x "$TARGET"

echo "installed=$INSTALLED"
[ -n "$LATEST" ] && echo "latest=$LATEST"
echo "vusb=$VUSB"
echo "outcome=$OUTCOME"
exit 0
