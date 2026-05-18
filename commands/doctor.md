---
description: Run read-only health checks on the Kobiton automate plugin (CLI, credentials, profile).
allowed-tools:
  - Bash
  - Read
---

# Kobiton Automate Doctor

Run each check below in sequence. Print one line per check using `✓` (pass) or `✗` (failure). Never short-circuit — run all checks even if some fail. After the last check, print a summary line: `Summary: <passed>/4 checks passed.`

For each `✗`, also print an indented remediation hint on the following line (prefixed with `→ `).

This command must NOT modify any files. The `~/.kobiton/bin/kobiton` symlink is created by the plugin's SessionStart hook on Claude Code / Codex CLI, or by `/automate:setup` on CLIs without that hook (e.g., Gemini) — not by this command.

## Check 1: CLI installed

Verifies the wrapper symlink is present and that its target file exists and is executable.

```bash
LINK="$HOME/.kobiton/bin/kobiton"
if [ -L "$LINK" ]; then
  TARGET="$(readlink "$LINK")"
  if [ -f "$TARGET" ] && [ -x "$TARGET" ]; then
    echo "PASS:$TARGET"
  else
    echo "FAIL:bad-target:$TARGET"
  fi
elif [ -e "$LINK" ]; then
  echo "FAIL:not-a-symlink"
else
  echo "FAIL:missing"
fi
```

- `PASS:<target>` → print `✓ CLI installed (~/.kobiton/bin/kobiton → <target>)`
- `FAIL:missing` → print `✗ CLI installed (~/.kobiton/bin/kobiton not found)` and `    → Run /automate:setup to install the symlink (or, on Claude Code / Codex CLI, restart the session — the SessionStart hook re-creates it on launch).`
- `FAIL:not-a-symlink` → print `✗ CLI installed (~/.kobiton/bin/kobiton is not a symlink)` and the same hint.
- `FAIL:bad-target:<t>` → print `✗ CLI installed (symlink target missing or not executable: <t>)` and the same hint.

## Check 2: Credentials file

```bash
F="$HOME/.kobiton/.credentials"
if [ -f "$F" ] && [ ! -L "$F" ]; then
  MODE=$(stat -f '%A' "$F" 2>/dev/null || stat -c '%a' "$F" 2>/dev/null)
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

## Summary

Count:
- `passed` = number of `✓` lines printed across Checks 1–4.
- Skipped checks (printed with `-`) do not count as passed or failed.

Print exactly:

```
Summary: <passed>/4 checks passed.
```

If `passed < 4`, append: `Fix the issues above and rerun /automate:doctor.`
If `passed == 4`, append: `All checks passed. You're ready to use the plugin.`
