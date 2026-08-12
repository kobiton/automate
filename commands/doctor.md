---
name: "doctor"
description: Run read-only health checks on the Kobiton automate plugin (CLI, credentials, profile).
allowed-tools:
  - Bash
  - Read
---

# Kobiton Automate Doctor

Run each check below in sequence. Print one line per check using `✓` (pass) or `✗` (failure). Never short-circuit — run all checks even if some fail. After the last check, print a summary line: `Summary: <passed>/5 checks passed.`

For each `✗`, also print an indented remediation hint on the following line (prefixed with `→ `).

This command must NOT modify any files. The `~/.kobiton/bin/kobiton` symlink is created by the plugin's SessionStart hook on Claude Code and Codex CLI (Codex prompts the user to trust the hook once via `/hooks` on first install), or by `/automate:setup` on demand. GitHub Copilot CLI and Gemini CLI both load `/automate:setup` (Copilot via Claude-format `.md`, Gemini via the bundled TOML at `commands/automate/setup.toml`) but have no SessionStart hook, so users on those CLIs run `/automate:setup` once after install. Cursor CLI also loads the shared `.md` commands but registers them without the plugin namespace — there they appear as `/setup` and `/doctor` (distinguishable from Cursor's built-ins by their Kobiton descriptions); read every `/automate:setup` / `/automate:doctor` mention in this file accordingly. This `/automate:doctor` command itself never modifies anything.

## Check 1: CLI installed

Verifies the wrapper entry point is present: a symlink to the plugin's `run.sh` on macOS/Linux, or a bash exec-shim (regular file) on Windows, where symlinks aren't reliable under Git Bash.

```bash
LINK="$HOME/.kobiton/bin/kobiton"
if [ -L "$LINK" ]; then
  TARGET="$(readlink "$LINK")"
  if [ -f "$TARGET" ] && [ -x "$TARGET" ]; then
    echo "PASS:$TARGET"
  else
    echo "FAIL:bad-target:$TARGET"
  fi
elif [ -f "$LINK" ] && [ -x "$LINK" ] && grep -q 'run\.sh' "$LINK" 2>/dev/null; then
  echo "PASS:shim:$(grep -o '"[^"]*run\.sh"' "$LINK" | tr -d '"')"
elif [ -e "$LINK" ]; then
  echo "FAIL:not-a-symlink"
else
  echo "FAIL:missing"
fi
```

- `PASS:<target>` → print `✓ CLI installed (~/.kobiton/bin/kobiton → <target>)`
- `PASS:shim:<target>` → print `✓ CLI installed (~/.kobiton/bin/kobiton is a Windows exec shim → <target>)`
- `FAIL:missing` → print `✗ CLI installed (~/.kobiton/bin/kobiton not found)` and `    → Run /automate:setup to install the wrapper. On Claude Code and Codex CLI, restarting the session re-creates it via the bundled SessionStart hook (Codex requires trusting the hook once via /hooks). If the hook was denied or you need to install without an active session, fall back to: bash "$(find ~/.codex -name install-cli.sh -path '*automate*' 2>/dev/null | head -1)".`
- `FAIL:not-a-symlink` → print `✗ CLI installed (~/.kobiton/bin/kobiton is neither a symlink nor an exec shim)` and the same hint.
- `FAIL:bad-target:<t>` → print `✗ CLI installed (symlink target missing or not executable: <t>)` and the same hint.

## Check 2: Credentials file

```bash
F="$HOME/.kobiton/.credentials"
if [ -f "$F" ] && [ ! -L "$F" ]; then
  # GNU stat first (-c), BSD stat as fallback (-f is "filesystem status" on
  # GNU and would dump a multi-line blob to stdout before failing over).
  MODE=$(stat -c '%a' "$F" 2>/dev/null || stat -f '%A' "$F" 2>/dev/null)
  if [ "$MODE" = "600" ]; then echo "PASS"; else echo "PASS:mode=$MODE"; fi
elif [ -L "$F" ]; then echo "FAIL:symlink"
elif [ -d "$F" ]; then echo "FAIL:directory"
else echo "FAIL:missing"
fi
```

- `PASS` → print `✓ Credentials file`
- `PASS:mode=<m>` → print `✓ Credentials file (mode is <m>, expected 600)` (still counts as pass; just inform)
- `FAIL:missing` → print `✗ Credentials file` and `    → ~/.kobiton/.credentials does not exist. Run /automate:setup to create it.`
- `FAIL:symlink` → print `✗ Credentials file (is a symlink, not a regular file)` and `    → Replace ~/.kobiton/.credentials with a regular file. Run /automate:setup.`
- `FAIL:directory` → print `✗ Credentials file (is a directory)` and `    → Remove the directory at ~/.kobiton/.credentials and run /automate:setup.`

## Check 3: Active profile present

```bash
F="$HOME/.kobiton/.credentials"
PROFILE="${KOBITON_PROFILE:-default}"
if [ ! -f "$F" ]; then echo "SKIP"; exit 0; fi
PROFILE="$PROFILE" awk '
  BEGIN { found = 0 }
  /^[[:space:]]*\[[[:space:]]*[^]]+[[:space:]]*\]/ {
    n = $0; sub(/^[[:space:]]*\[[[:space:]]*/, "", n); sub(/[[:space:]]*\][[:space:]]*$/, "", n)
    if (n == ENVIRON["PROFILE"]) { found = 1; exit 0 }
  }
  END { print (found ? "PASS" : "FAIL") }
' "$F"
```

- `SKIP` → credentials file missing (already reported in Check 2); print `- Active profile (skipped — credentials file missing)` and do not count as pass or fail.
- `PASS` → print `✓ Active profile [<PROFILE>]`
- `FAIL` → print `✗ Active profile [<PROFILE>]` and `    → Profile [<PROFILE>] not found in ~/.kobiton/.credentials. Run /automate:setup to create it, or unset KOBITON_PROFILE to use [default].`

## Check 4: Required fields populated

```bash
F="$HOME/.kobiton/.credentials"
PROFILE="${KOBITON_PROFILE:-default}"
if [ ! -f "$F" ]; then echo "SKIP"; exit 0; fi
PROFILE="$PROFILE" awk '
  function trim(s) { sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s); return s }
  BEGIN { found=0; in_p=0 }
  /^[[:space:]]*\[[[:space:]]*[^]]+[[:space:]]*\]/ {
    n = $0; sub(/^[[:space:]]*\[[[:space:]]*/, "", n); sub(/[[:space:]]*\][[:space:]]*$/, "", n)
    if (n == ENVIRON["PROFILE"]) { in_p = 1; found = 1 } else { if (in_p) exit 0; in_p = 0 }
    next
  }
  in_p && /=/ {
    k = trim(substr($0, 1, index($0,"=")-1))
    v = trim(substr($0, index($0,"=")+1))
    if (v != "") seen[k] = 1
  }
  END {
    if (!found) { print "MISSING_PROFILE"; exit 0 }
    miss = ""
    split("KOBITON_USER KOBITON_API_KEY KOBITON_PORTAL", reqs, " ")
    for (i in reqs) if (!(reqs[i] in seen)) miss = miss " " reqs[i]
    if (miss == "") print "PASS"; else print "FAIL:" miss
  }
' "$F"
```

- `SKIP` / `MISSING_PROFILE` → already covered by Check 2 / 3; print `- Required fields (skipped — earlier check failed)` and do not count as pass or fail.
- `PASS` → print `✓ Required fields (KOBITON_USER, KOBITON_API_KEY, KOBITON_PORTAL)`
- `FAIL:<missing>` → print `✗ Required fields (missing:<missing>)` and `    → Run /automate:setup to refresh, or edit ~/.kobiton/.credentials to add the missing field(s).`

## Check 5: CLI version (pinned vs installed vs latest)

Reports version drift between the plugin's pin, the cached binary, and the newest published build — and whether the pinned build is still downloadable. All requests are HEAD-only; nothing is downloaded.

This file (`doctor.md`) lives at `<plugin-root>/commands/doctor.md`, so the pin file is at `<plugin-root>/skills/run-interactive-session/CLI_VERSION`. Resolve `<plugin-root>` to its absolute path first, then run:

```bash
PIN="$(tr -d '[:space:]' < "<plugin-root>/skills/run-interactive-session/CLI_VERSION" 2>/dev/null)"
INSTALLED="$("$HOME/.kobiton/bin/kobiton" --version 2>/dev/null | awk '{print $2}')"
LATEST="$(curl -sI --connect-timeout 5 --max-time 15 "https://public.kobiton.download/kobiton-cli/latest/" 2>/dev/null | awk 'tolower($1)=="location:"{print $2}' | tr -d '\r' | sed -e 's|/$||' -e 's|.*/||')"
PIN_ON_SERVER="unknown"
if [ -n "$PIN" ] && [ -n "$LATEST" ]; then
  CODE="$(curl -s -o /dev/null -I -w '%{http_code}' --connect-timeout 5 --max-time 15 "https://public.kobiton.download/kobiton-cli/$PIN/" 2>/dev/null)"
  case "$CODE" in 200) PIN_ON_SERVER="yes";; 404) PIN_ON_SERVER="pruned";; *) PIN_ON_SERVER="unknown";; esac
fi
echo "pin=$PIN"
echo "installed=$INSTALLED"
echo "latest=$LATEST"
echo "pin_on_server=$PIN_ON_SERVER"
```

Interpret:

- `pin` empty → print `✗ CLI version (no CLI_VERSION pin found in the plugin)` and `    → Re-install the plugin; the pin file ships with it.`
- `installed` empty (wrapper missing or binary not cached) → print `✗ CLI version (no installed CLI to compare — see Check 1)` and `    → Run /automate:setup to download the pinned build.`
- `latest` empty (network unreachable) → print `- CLI version (skipped — download server unreachable; pinned <pin>, installed <installed>)` and do not count as pass or fail.
- `installed == pin` → print `✓ CLI version (pinned <pin> = installed; latest available <latest>)`. If `pin_on_server=pruned`, append on the next line: `    → Note: the pinned build is no longer downloadable upstream (retention pruning). Existing installs keep working from cache; fresh installs will fall back to the newest build. Update the automate plugin to its latest version to refresh the pin.`
- `installed != pin` → print `✗ CLI version (installed <installed> ≠ pinned <pin>; latest available <latest>)` and `    → The cache is serving a different build than this plugin release was validated against (fallback after upstream pruning, or a stale cache). Run /automate:setup to re-download the pin if it is still published (pin_on_server=yes); otherwise update the automate plugin to its latest version - newer releases pin a validated build.`

`latest` differing from `pin` is normal (the download server tracks newer builds continuously; pins advance with plugin releases) — mention it only as the informational value in the pass/fail line, never as a failure by itself.

## Summary

Count:
- `passed` = number of `✓` lines printed across Checks 1–5.
- Skipped checks (printed with `-`) do not count as passed or failed.

Print exactly:

```
Summary: <passed>/5 checks passed.
```

If `passed < 5`, append: `Fix the issues above and rerun /automate:doctor.`
If `passed == 5`, append: `All checks passed. You're ready to use the plugin.`
