---
name: run-interactive-session
description: >-
  Perform interactive testing on Kobiton devices using natural language.
  Translates user intents into CLI commands - WebDriver actions (find
  elements, type, click, swipe), device operations (adb shell, screen
  capture, port forwarding), file management (push/pull), app
  management, and test execution. Use when the user wants to interact
  with a mobile device on Kobiton, run exploratory tests, inspect device
  state, manage files on a device, or execute test sessions - even if
  they don't say "interactive test" explicitly. Trigger with "interact
  with kobiton device", "explore on kobiton", or "tap/swipe on device".
allowed-tools: >-
  Read, Edit,
  Bash(~/.kobiton/bin/kobiton:*),
  Bash(node:*),
  Bash(mkdir:*), Bash(date:*), Bash(base64:*), Bash(echo:*),
  Bash(cat:*), Bash(grep:*), Bash(head:*), Bash(tail:*), Bash(test:*),
  Bash(jq:*), Bash(xmllint:*),
  Bash(timeout:*), Bash(perl:*),
  Bash(open:*), Bash(xdg-open:*)
version: 1.0.0
author: Kobiton Inc.
license: MIT
compatibility: >-
  macOS (Apple Silicon), Linux (x64), and Windows (x64, under Git
  Bash). The Kobiton CLI is downloaded on install: the plugin pins a
  build version (skills/run-interactive-session/CLI_VERSION) and the
  install script fetches the matching platform build from
  public.kobiton.download, sha256-verified and cached under
  ~/.kobiton/cli/. Intel Macs are not supported (no macos-x64 build
  is published) - there, use run-automation-suite or
  drive-automation-session, or the Kobiton MCP tools directly.
  Requires local file access for the cached binary and
  ~/.kobiton/.credentials, and Node 18+ for the lean page-source view
  (shared with drive-automation-session). Run /automate:setup once before first use
  to install the CLI wrapper and write credentials.
tags: [mobile, testing, interactive, webdriver, devices, kobiton]
---

# Run Interactive Test

## Overview

Drive a Kobiton device interactively from natural-language intent. Given a request like "find the Login button and tap it" or "pull the latest log file from this Pixel", this skill creates (or resumes) a session, translates the intent into the right CLI command - WebDriver action, `adb shell`, file transfer, app launch, test run - captures the response, saves artifacts (screenshots, page source) under the workspace, and reports back in plain language.

Use this skill whenever the user wants to interact with a mobile device on Kobiton, run exploratory tests, inspect device state, manage files on a device, or execute test sessions - even if they don't say "interactive test" explicitly.

## Prerequisites

**Runs on macOS (Apple Silicon), Linux (x64), and Windows (x64 under Git Bash), and needs a local filesystem** — it executes a locally cached CLI binary and reads `~/.kobiton/.credentials`. On Intel Macs or other unsupported architectures, or anywhere a local filesystem isn't available, don't invoke this skill: route to `run-automation-suite` (user already has a test script) or `drive-automation-session` (describe the flow instead), both cross-platform. Check this *before* reserving a device, so a doomed run doesn't burn device minutes. See the Skill compatibility matrix in `CLAUDE.md`.

Before invoking this skill, ensure:

- **Kobiton CLI wrapper** - `~/.kobiton/bin/kobiton` (a symlink to this plugin's `run.sh` wrapper on macOS/Linux, a bash exec-shim on Windows) must exist and resolve to an executable. Claude Code and Codex CLI both recreate it automatically via a bundled SessionStart hook; on Codex, the user trusts the hook once via `/hooks` after install. `/automate:setup` re-installs the wrapper on demand on any host. GitHub Copilot CLI and Gemini CLI load `/automate:setup` (Copilot via Claude-format `.md`, Gemini via bundled TOML at `commands/automate/setup.toml`) but have no SessionStart hook - run `/automate:setup` once after install. The CLI binary itself is **downloaded, not bundled**: the install script fetches the build pinned in `CLI_VERSION` (sha256-verified) into `~/.kobiton/cli/` on first run. `run.sh` reports a missing binary or missing credentials with the right remedy, so surface its error rather than pre-flighting your own checks.
- **Node 18+** - the page-source step writes its lean view with the sibling `drive-automation-session` skill's `scripts/ui-tree.js`. Without Node, read the saved full source instead (see [`webdriver.md` § Observe](../drive-automation-session/references/webdriver.md#observe)).
- **Credentials file** - `~/.kobiton/.credentials` must contain a valid INI-formatted profile with `KOBITON_USER`, `KOBITON_API_KEY`, and `KOBITON_PORTAL`. Created by `/automate:setup`. The active profile is `$KOBITON_PROFILE` if set, otherwise `default`.
- **Kobiton MCP connection** - useful for `listDevices` / `getDeviceStatus` calls when picking a device. Default `api.kobiton.com/mcp`; check `.mcp.json` for the configured endpoint.
- **Kobiton account** - credentials with device access for the target platform (Android / iOS) and remaining session quota.

If a command fails with a credentials error or missing-binary error, direct the user to run `/automate:doctor` for diagnostics, then `/automate:setup` to repair.

## How It Works

All CLI calls go through a single wrapper at `~/.kobiton/bin/kobiton` that automatically handles:

- **CLI binary resolution** - resolves the pinned CLI build from the version cache at `~/.kobiton/cli/<version>/` (falling back to the newest cached build with a drift warning).
- **Portal URL** - from `KOBITON_PORTAL` in credentials, or derived from `.mcp.json` as fallback.
- **Credentials** - loaded from `~/.kobiton/.credentials` using AWS-style profiles (`$KOBITON_PROFILE`, default `default`).
- **Session token** - loaded by the CLI from `~/.kobiton/.session` once a session exists. Always create sessions with `session create --hide` so the token is saved but never printed into the transcript.

Every command is self-contained - no env vars to manage between calls:

    ~/.kobiton/bin/kobiton <cli-args>

`$KOBITON_BIN` is used as shorthand throughout this document. In every Bash command, substitute it with the literal path `~/.kobiton/bin/kobiton` - the variable does not persist between Bash calls.

`$SKILL_DIR` is shorthand for this skill's directory, the one holding this SKILL.md.
In every Bash command and every path you `Read`, substitute it with the literal absolute path of that directory - nothing sets the variable, and it does not persist between Bash calls.
The skill reaches the sibling `drive-automation-session` skill through it (`$SKILL_DIR/../drive-automation-session/`), the same sibling-path pattern the plugin's other skills use for `../run-automation-suite/scripts/`.

## Conventions

### Argument order

Global flags must come **before** the subcommand:

    $KOBITON_BIN [global-flags] <subcommand> [subcommand-flags]

Example: `$KOBITON_BIN -u <udid> session create --hide` (NOT `$KOBITON_BIN session -u <udid> create --hide`).

### Help-first discovery

The CLI has built-in help at every level. **Always check `--help` before running a command you haven't used before or when unsure about arguments:**

    $KOBITON_BIN --help                    # list all top-level commands
    $KOBITON_BIN session --help            # session create, ping, end, list, list-active, show
    $KOBITON_BIN session create --help     # show create flags and usage (--hide, --timeout)
    $KOBITON_BIN session list --help       # page through past sessions with filters
    $KOBITON_BIN wd --help                 # webdriver post/get commands
    $KOBITON_BIN device --help             # list, adb-shell, forward, ps, screen
    $KOBITON_BIN device adb-shell --help   # run adb shell commands on device
    $KOBITON_BIN device forward --help     # port forwarding, --mode mux|demux
    $KOBITON_BIN file --help               # list, push, pull files on device
    $KOBITON_BIN file push --help          # push local file to device
    $KOBITON_BIN test --help               # test run: native instrumentation (uiautomator / xcuitest)
    $KOBITON_BIN test run --help           # show test run flags and usage (--app, --runner, <framework>)
    $KOBITON_BIN app --help                # app management commands
    $KOBITON_BIN app run --help            # show app run flags and usage

**Rule:** if a command fails with "unexpected argument" or "unknown flag", run `--help` on that command to discover the correct syntax before retrying. Do not guess - the help output is authoritative.

### Artifacts storage

All session artifacts (screenshots, page source) **must** be saved under the current workspace at:

    .kobiton/sessions/<session-id>/

This keeps artifacts organized per session, easy to review, and version-controllable. Never save artifacts to `/tmp/` or other locations outside the workspace.

**Workspace vs home.** This `.kobiton/` is **workspace-relative** (your CWD when running the skill) - do not confuse with `~/.kobiton/` in the user's home, which holds the CLI symlink, credentials, and session JWT (managed by `/automate:setup`). Workspace `.kobiton/` only contains per-session artifacts the skill creates.

Before writing the first artifact in a session, ensure the directory exists with `mkdir -p .kobiton/sessions/<session-id>`. It's idempotent, so include it defensively whenever you're about to write - especially when resuming an existing session, where Instructions § 2 may have been skipped.

## Instructions

### 1. Pick a device

Ask the user which device or platform to target. If they haven't specified one, call the MCP tool `listDevices` to surface available options, optionally filtered by platform / OS version.

If the user already has a specific device in mind, confirm its availability with `getDeviceStatus` before proceeding.

Capture both the **UDID** (used for session creation) and the device **id** (the separate numeric ID used to build portal launch URLs).

### 2. Create or resume a session

If there is no active session yet, create one:

    $KOBITON_BIN -u <udid> session create --hide

The output is a single line like `Session 12345 created for device <udid>.`. Capture it:

1. Parse the session ID from the output (`grep -oE 'Session [0-9]+ created' | grep -oE '[0-9]+'`).
2. Create the artifacts directory: `mkdir -p .kobiton/sessions/<session-id>`.
3. Store the session ID for use in screenshot and page source commands.

The JWT is saved automatically to `~/.kobiton/.session`. All subsequent commands use it - no flags needed. `--hide` keeps the token out of stdout (and therefore out of the agent transcript); without it the CLI prints the bearer token, which is valid for the session's lifetime. Never omit `--hide`, and never paste a token line into chat if one appears.

`--hide` (like `session list` and `device forward --mode`) needs CLI build `2608.191335.0` or newer - the build this plugin pins. The wrapper enforces it: `session create` without `--hide` gets the flag added, and if the resolved build is older (the `pinned CLI version ... is not cached` warning tells you so) the wrapper refuses to create the session instead of printing the token. If you see that refusal, run `/automate:setup` to download the pinned build - do **not** retry with different flags.

If a session may already exist (e.g., the user is continuing earlier work), check first:

    $KOBITON_BIN session ping

Exit code 0 -> session alive, reuse it. Non-zero -> expired; create a fresh one.

### 3. Interact with the device

Translate the user's natural-language intent into one or more CLI commands using the [Command Reference](#command-reference) below.

For each command:

1. Run it via Bash using the literal path `~/.kobiton/bin/kobiton`.
2. Parse the response (JSON envelope, plain text, or exit code) to extract values - see [Output § Per-command response shapes](#per-command-response-shapes) for the summary rules and [`references/response-shapes.md`](references/response-shapes.md) for the full per-command table.
3. Report results in plain language to the user.

**Chaining.** Multi-step intents require chaining the output of one command into the next. Example - "find the Name field and type Hello":

1. Find the element and extract its ID with the shared extractor:

       $KOBITON_BIN wd post element '{"using":"id","value":"com.app:id/etName"}' \
         | jq -r '(.value? // .) | if type == "object" then (.ELEMENT // .["element-6066-11e4-a52e-4f735466cecf"]) else . end'

   The CLI prints the unwrapped element object, `{"ELEMENT":"…","element-6066-11e4-a52e-4f735466cecf":"…"}`.
   A failed find prints a top-level `{"error":"…","message":"…"}` at exit 0 and the extractor prints `null`: check `.error` before using the ID.

2. Type into it (substituting the captured element ID):

       $KOBITON_BIN wd post element/<ELEMENT_ID>/value '{"text":"Hello"}'

The find-then-act workflow, including why element IDs must be re-found after every screen change, is in [`webdriver.md`](../drive-automation-session/references/webdriver.md#find-an-element-then-act-on-it).

### 4. Capture artifacts

Ensure the artifacts directory exists first (idempotent, safe to repeat):

    mkdir -p .kobiton/sessions/<session-id>

Artifacts use the file names in [`webdriver.md` § Observe](../drive-automation-session/references/webdriver.md#observe) - `screenshot-<ts>.png`, `source-<ts>.full.xml` and `source-<ts>.xml`, with `<ts>` the epoch seconds of the capture - the same names `drive-automation-session` writes.
One observation's files share one `<ts>`: compute `TS=$(date +%s)` once and reuse it for that observation's screenshot and source in the same Bash call, or substitute its literal value into each command when they run as separate calls.

**Screenshot and page source.** `wd get screenshot` prints the base64-encoded PNG and `wd get source` the raw XML (Android UIAutomator2) or hierarchy markup (iOS XCUITest).
Decode the screenshot into its file, save the source as the full source, then write the lean view next to it with the shared filter that ships with the sibling `drive-automation-session` skill (substitute `$SKILL_DIR` and `$KOBITON_BIN` as [How It Works](#how-it-works) says):

    TS=$(date +%s)
    $KOBITON_BIN wd get screenshot \
      | base64 -d \
      > .kobiton/sessions/<session-id>/screenshot-$TS.png
    $KOBITON_BIN wd get source > .kobiton/sessions/<session-id>/source-$TS.full.xml
    node "$SKILL_DIR/../drive-automation-session/scripts/ui-tree.js" \
      .kobiton/sessions/<session-id>/source-$TS.full.xml \
      > .kobiton/sessions/<session-id>/source-$TS.xml
    echo "$TS"

A transport failure leaves an empty file (the CLI prints the reason on stderr and exits non-zero): check each file is non-empty (`test -s`) before reading it, and rerun that command once if it is empty, with the printed `<ts>` substituted for `$TS`.
Drop the screenshot command when this observation doesn't need it ([`webdriver.md` § Screenshot](../drive-automation-session/references/webdriver.md#screenshot) says when it does), or the source commands for a screenshot alone; keep the `TS=` and `echo` lines either way.
Use the `Read` tool on the screenshot to display it inline, and report the file path to the user.
`Read` the lean `source-<ts>.xml` for element inspection, or `grep` it for the target when it is large ([`webdriver.md` § Observe](../drive-automation-session/references/webdriver.md#observe)); open the `.full.xml` only in the cases [`webdriver.md`](../drive-automation-session/references/webdriver.md#when-to-open-the-full-source) lists, and build selectors by its [Selectors](../drive-automation-session/references/webdriver.md#selectors) rules.

### 5. End the session

When the user is done:

    $KOBITON_BIN session end

This terminates the Kobiton-side session and frees the device. The local artifacts directory at `.kobiton/sessions/<session-id>/` is preserved for later review and version control.

## Command Reference

### WebDriver commands

`wd` sends a WebDriver call to the session created in Step 2:

    $KOBITON_BIN wd post <path> '<json>'   # POST /session/<current-session>/<path>
    $KOBITON_BIN wd get <path>             # GET  /session/<current-session>/<path>

Every operation's `<path>` and body (find, click, type, clear, text, source, screenshot, window size, orientation, URL, alerts, back / home, swipe and tap), the selector rules, the find-then-act workflow and the response and error shapes live in the reference shared with `drive-automation-session`: [`$SKILL_DIR/../drive-automation-session/references/webdriver.md`](../drive-automation-session/references/webdriver.md).
Read it before the first `wd` call in a session.
For example, `wd post element '{"using":"accessibility id","value":"Open Settings"}'` finds an element and `wd get window/rect` returns the window size.

CLI-specific behaviour:

- Every `wd` call prints the unwrapped result - the envelope's `value` alone: a find prints `{"ELEMENT":"…","element-6066-11e4-a52e-4f735466cecf":"…"}`, a call with no result prints `null`, and `wd get source` / `wd get screenshot` print raw XML / base64 PNG (save them as in Step 4).
- WebDriver failures print a top-level `{"error":"…","message":"…"}` and exit 0; transport failures print plain text on stderr and exit non-zero (see Error Handling).
- `$KOBITON_BIN wd --help` lists the subcommands; `$KOBITON_BIN session ping` checks the session is alive.

### adb-shell commands (Android only)

`device adb-shell` forwards everything after it to `adb shell <...>` on the device. Three failure modes account for most AI-agent mistakes - read these before composing a command.

**Restricted sessions (public cloud and trial devices).** On Kobiton public cloud devices and for trial users, every invocation is checked against a deny-by-default whitelist before it reaches the device. Dedicated devices (private cloud / on-premise) are unrestricted; everything in this block applies only to restricted sessions. The interactive shell is unavailable on restricted sessions - every invocation must name a command.

Rejected on restricted sessions:

- Any command not in the whitelist below, and command lines longer than 1024 characters.
- Control characters, and these shell metacharacters anywhere in the input: `` & ; | $ ` ( ) > < \ " ' * ? ~ { } # ! `` - so no pipes, redirection, command or variable substitution, backgrounding, globbing, or **quoting**. Arguments may not contain whitespace.

Whitelisted commands, by category:

| Category | Commands |
|----------|----------|
| Device information | `getprop`, `dumpsys`, `df`, `free` |
| Diagnostics | `logcat`, `ps`, `top`, `netstat`, `printenv`, `uptime`, `id`, `whoami`, `date` (flags only) |
| Applications | `pm`, `am`, `monkey` (`pm install` may name an APK inside the allowed directories below) |
| Text tools | `grep`, `egrep`, `fgrep`, `head`, `tail`, `wc`, `sort`, `uniq`, `nl`, `cut` - they read files, not stdin (pipes are rejected), and pattern arguments are limited to letters, digits, dot, underscore, hyphen |
| File inspection | `ls`, `cat`, `stat`, `du`, `md5sum`, `sha1sum` |
| Screen and input | `screencap`, `input` |
| Settings | `settings` - one key only, see below |

File-path arguments must stay inside `/sdcard/Download/`, `/sdcard/Documents/`, or `/data/local/tmp/`, plus the individually allowed read-only file `/proc/version`; paths containing `..` are rejected. To list a directory outside that allowlist, use `$KOBITON_BIN file list <path>` instead of `adb-shell ls`. The same directories bound `file push` / `file pull`.

Settings: only `settings get secure enabled_accessibility_services` and `settings put secure enabled_accessibility_services <value>` are permitted. Every other settings namespace, key, and subcommand (including `list` and `delete`) is rejected.

A rejected invocation prints one of these messages on stdout and - gotcha - **exits 0**, so check the first line of output rather than `$?`:

- `Input contains a forbidden character: '<c>'.`
- `Command is not on the whitelist: '<cmd>'.`
- `Argument is not permitted for '<cmd>': '<arg>'.`
- `Only get/put of secure enabled_accessibility_services is permitted for 'settings'.` (the settings rule has its own message)

The whitelist evolves with CLI releases; `$KOBITON_BIN device adb-shell --help` carries the full current policy - trust it over this snapshot.

**Quoting rules.** The local shell parses pipes, redirects, globs, and variable expansion *before* the wrapper sees them. Anything you wrap in quotes survives to the device's shell; anything outside is interpreted on your laptop.

- **Plain command, no shell metacharacters** - pass args separately (works on restricted and unrestricted sessions alike; `/sdcard/Download/` is inside the restricted path allowlist):

      $KOBITON_BIN device adb-shell ls -la /sdcard/Download/
      $KOBITON_BIN device adb-shell getprop ro.build.version.release

- **Pipes, redirects, globs, `&&`, `$VAR`, or quotes inside the command** - **unrestricted (dedicated) devices only**: wrap the entire remote command in one quoted string so it runs on the device's shell, not your local shell:

      $KOBITON_BIN device adb-shell "dumpsys window | grep mCurrentFocus"
      $KOBITON_BIN device adb-shell 'pm list packages -3 | wc -l'
      $KOBITON_BIN device adb-shell "logcat -d -t 200 > /sdcard/log.txt"

  On a **restricted session** this form is rejected outright - the quotes and the metacharacters inside them are all forbidden characters, so there is no on-device composition form at all. Compose locally instead (next bullet).

- **Restricted sessions: compose locally.** Run the bare whitelisted command, bound its output, redirect *locally* into the session artifact directory, then filter the file locally:

      $KOBITON_BIN device adb-shell dumpsys window \
        > .kobiton/sessions/<session-id>/window-$(date +%s).txt
      grep mCurrentFocus .kobiton/sessions/<session-id>/window-*.txt

  On unrestricted devices prefer the quoted on-device form - filtering locally on the full output is slower and can overflow the 25k-token MCP limit if it isn't routed through an artifact file. On restricted sessions the local route is the only one: always bound the command (`-d -t N`, `-n 1`) and go through an artifact file, never paste raw output to chat.

**Platform guard.** `adb` is Android-only. If the active session targets iOS, do **not** call `device adb-shell`. Refuse and reach for the WebDriver equivalent (`wd post execute/sync '{"script":"mobile: ...","args":[{...}]}'`) or a different inspection path.

**Device logs on iOS.** `logcat` is Android-only; the cross-platform log path is `$KOBITON_BIN device log`, which **streams until killed** — always bound it and expect the bound's exit code, which means success here, not failure:

    timeout 45 $KOBITON_BIN device log > .kobiton/sessions/<session-id>/device-log.txt   # exit 124 = bound fired (coreutils)
    # stock macOS has no `timeout` - use the perl-alarm equivalent (exit 142 = SIGALRM, same meaning):
    perl -e 'alarm shift; exec @ARGV' 45 ~/.kobiton/bin/kobiton device log > .kobiton/sessions/<session-id>/device-log.txt

The **Restricted** column says what changes on a restricted session; `ok` means the command runs as written.

| Intent | Command | Restricted |
|--------|---------|------------|
| Get OS / build property | `$KOBITON_BIN device adb-shell getprop <key>` | ok |
| Get screen resolution | `$KOBITON_BIN device adb-shell wm size` | rejected (`wm` not whitelisted) - use `$KOBITON_BIN wd get window/rect` instead |
| Get foreground app/activity | `$KOBITON_BIN device adb-shell "dumpsys window \| grep mCurrentFocus"` | quoted pipe rejected - run bare `dumpsys window`, filter locally |
| Open a URL (Android Chrome) | UI-driven: launch Chrome via `monkey -p com.android.chrome -c android.intent.category.LAUNCHER 1`, then `wd post element '{"using":"id","value":"com.android.chrome:id/url_bar"}'` → `wd post element/<id>/click '{}'` → `wd post element/<id>/value '{"text":"<url>"}'` → `input keyevent 66` | this recipe IS the restricted path - a URL argument to `am start` is rejected (`Argument is not permitted for 'am'`); on unrestricted devices `am start -a android.intent.action.VIEW -d <url>` also works |
| Open a URL (iOS Safari) | `wd post execute/sync '{"script":"mobile: launchApp","args":[{"bundleId":"com.apple.mobilesafari"}]}'` → `wd post element '{"using":"accessibility id","value":"TabBarItemTitle"}'` → `wd post element/<id>/click '{}'` → `wd post element/<id>/value '{"text":"<url>\n"}'` — the trailing `\n` submits (iOS has no keyevent); `click` requires a body, `'{}'` works | n/a - WebDriver path, not adb-shell |
| List running processes | `$KOBITON_BIN device adb-shell ps -A` | ok |
| List user-installed packages | `$KOBITON_BIN device adb-shell pm list packages -3` | ok |
| Find APK path of a package | `$KOBITON_BIN device adb-shell pm path <pkg>` | ok |
| Launch app by package | `$KOBITON_BIN device adb-shell monkey -p <pkg> -c android.intent.category.LAUNCHER 1` | ok |
| Force-stop app | `$KOBITON_BIN device adb-shell am force-stop <pkg>` | ok |
| Clear app data | `$KOBITON_BIN device adb-shell pm clear <pkg>` | ok |
| Battery level + charging state | `$KOBITON_BIN device adb-shell dumpsys battery` | ok |
| Memory snapshot for a package | `$KOBITON_BIN device adb-shell dumpsys meminfo <pkg>` | ok |
| Storage free on /sdcard | `$KOBITON_BIN device adb-shell df -h /sdcard` | ok |
| Press hardware key (home=3, back=4, power=26) | `$KOBITON_BIN device adb-shell input keyevent <code>` | ok |
| Type text into focused field | `$KOBITON_BIN device adb-shell input text "<text>"` | quotes/whitespace rejected - a single token works (`%s` encodes a space); for real text entry prefer `wd post element/<id>/value` |
| Tap at coordinates | `$KOBITON_BIN device adb-shell input tap <x> <y>` | ok |
| Swipe (ms = duration) | `$KOBITON_BIN device adb-shell input swipe <x1> <y1> <x2> <y2> <ms>` | ok |
| Read recent logs (Android only) | `$KOBITON_BIN device adb-shell logcat -d -t 500 > <local-file>` — on iOS use `device log` (see "Device logs on iOS" above) | ok (no quotes needed - the args carry no metacharacters; the redirect is local) |
| Screenshot via shell | `$KOBITON_BIN device adb-shell screencap -p /sdcard/Download/shot.png` | ok - retrieve with `file pull` (or use `device screen` directly) |
| Read system setting | `$KOBITON_BIN device adb-shell settings get system <key>` | rejected - only the `secure enabled_accessibility_services` key is readable/writable |
| Write system setting | `$KOBITON_BIN device adb-shell settings put system <key> <value>` | rejected - same single-key rule |
| Read/write enabled accessibility services | `$KOBITON_BIN device adb-shell settings get secure enabled_accessibility_services` / `... put secure enabled_accessibility_services <value>` | ok - the one permitted settings key (`<value>` is colon-separated components, or `null` to clear) |
| Read file content | `$KOBITON_BIN device adb-shell cat <path>` | path allowlist applies (allowed dirs + `/proc/version`) |
| List directory | `$KOBITON_BIN device adb-shell ls -la <path>` | path allowlist applies - outside it, use `$KOBITON_BIN file list <path>` |
| Current IME | `$KOBITON_BIN device adb-shell "dumpsys input_method \| grep mCurId"` | quoted pipe rejected - run bare `dumpsys input_method`, filter locally |

**Big-output commands.** `dumpsys`, `logcat`, `pm list -f`, and full process dumps can blow past the 25k-token MCP limit. For these, redirect to an artifact file first, then read/grep only what you need (the redirect is your *local* shell's, so this exact pattern also works on restricted sessions - it is the same local-composition idiom from the quoting rules):

    $KOBITON_BIN device adb-shell logcat -d -t 1000 \
      > .kobiton/sessions/<session-id>/logcat-$(date +%s).txt
    grep -E 'FATAL|AndroidRuntime' \
      .kobiton/sessions/<session-id>/logcat-*.txt | head -20

Never paste full dumpsys/logcat output to chat - surface a summary + the file path.

**Long-running commands.** Streaming commands like `logcat` (no `-d`), `device log`, `tcpdump`, or `top` (no `-n 1`) run forever. Either bound them (`-d -t N`, `-c N`, `-n 1`, or the `timeout`/perl-alarm wrapper for `device log`) or launch with `run_in_background: true` and kill explicitly.

**adb-shell vs WebDriver overlap.** Both can press keys, type, and tap. Tie-breakers:

- If the target is a known element ID -> WebDriver (`wd post element/<id>/click`, `.../value`).
- If the target is a hardware key, a blind coordinate tap, or a system-level action -> `adb shell input` / `am` / `pm`.
- For inspection (foreground app, processes, build props, settings) -> adb shell only; there is no WebDriver equivalent.

Default: prefer adb-shell for system-level work, WebDriver for UI element-level work.

### Beyond WebDriver

These commands require an active session. Run `$KOBITON_BIN <command> --help` to discover the exact flags before using them - argument order and required flags vary.

| Domain | Command | What it does |
|--------|---------|-------------|
| Device | `$KOBITON_BIN device screen` | Capture device screen as jpg |
| Device | `$KOBITON_BIN device forward <local> <remote> [--mode mux\|demux]` | Forward a local port to a service on the device; addresses are `tcp:<port>`. Runs in the foreground until interrupted and holds the local port for the lifetime of the forward - launch with `run_in_background: true` and kill explicitly, like the long-running adb-shell commands above. `--mode mux` (default) multiplexes every accepted connection over one shared gRPC channel; `--mode demux` gives each connection its own channel (1:1) - try it when a protocol misbehaves over the shared channel. **Transient network failures are retried for up to 5 minutes** - a forward that seems to hang for a few minutes is retrying, not dead; wait it out or kill and relaunch |
| Device | `$KOBITON_BIN device ps` | List processes on device |
| File | `$KOBITON_BIN file list <path>` | List files on device |
| File | `$KOBITON_BIN file push <local> <remote>` | Push file to device |
| File | `$KOBITON_BIN file pull <remote> <local>` | Pull file from device |
| App | `$KOBITON_BIN app run <app-id>` | Launch an app |
| Session | `$KOBITON_BIN session list [--from <date> --to <date> --state <STATE> --type <TYPE> --platform <P> --keyword <k> --page <n> --size <n> --all]` | Page through sessions created in a time window (default: last 30 days, 20 per page). Filters: `--state` (START, COMPLETE, PASSED, FAILED, TIMEOUT, ERROR, TERMINATED), `--type` (AUTO, MANUAL, CLI, MIXED, ...), `--platform` (Android, iOS), `--keyword` (device name / platform version). `--all` retrieves every page. Companion commands: `session list-active` (currently running), `session show` (one session's details) |
| Test | `$KOBITON_BIN test run --app <APP> --runner <TEST_RUNNER> <uiautomator\|xcuitest>` | Run a **native instrumentation** test on a device: `--app` and `--runner` accept a URL or a Kobiton store app id; the positional framework is `uiautomator` (Android) or `xcuitest` (iOS - also pass `--plan <TEST_PLAN>` or one or more `--test <TEST>`). Target with `-u <udid>` or `-d <device-name>` (wildcards; optionally `-v <platform-version>`, `-g <device-group>`). `--follow` waits for completion and prints the result; `--stream` streams test logs live (no session test report with this option). `-o <seconds>` caps the session (default 1800). See "Instrumentation runs" below. **Not** the `createTestRun` MCP tool - that re-executes a *recorded* test case's steps; this executes your own compiled test bundle |

### Instrumentation runs (`test run`)

"Test run" names two unrelated features on this platform. The **CLI's `test run`** executes a native instrumentation bundle you built (UIAutomator/Espresso on Android, XCUITest on iOS) against a device and streams the runner's output. The **`createTestRun` MCP tool** (and the `create-test-run` skill) re-executes the *recorded steps* of a saved test case on one or more devices. If the user has an APK/IPA plus a test-runner bundle, this command is the path; if they have a saved test case, route to `create-test-run`.

`test run` books its own device - it does **not** need a `session create` first. Upload the app under test and the runner with the `uploadAppToStore` MCP tool (then `confirmAppUpload`) and pass the returned store ids, or pass URLs directly:

    # Android: app + androidTest runner from the Kobiton store, run to completion
    $KOBITON_BIN test run --app 12345 --runner 12346 -d "Pixel 8*" uiautomator --follow

    # iOS: app + XCUITest runner, restricted to two tests, streaming logs
    $KOBITON_BIN test run --app https://example.com/app.ipa --runner https://example.com/runner.zip \
      -u <udid> xcuitest --test LoginTests/testValidLogin --test LoginTests/testLockout --stream

Launch with `run_in_background: true` and tail the output; with `--follow` the final summary block carries the pass/fail result, and the session's report is available through `getSessionArtifacts` (`test_report_url`) afterwards. The resulting session appears in `listSessions` / `getSession` with `type` `UIAUTOMATOR` or `XCUITEST`. Run `$KOBITON_BIN test run --help` for the full flag list (`--reset`, `--env KEY VALUE`, `--session-name`, ...).

## Output

The skill produces two kinds of output: **per-command responses** that Claude parses inline during the session, and **persistent session artifacts** that accumulate on disk and remain after the session ends.

### Per-command response shapes

The common parsing patterns:

- **WebDriver (`wd`)** calls print the unwrapped result of every call - the `value` of the envelope described in [`webdriver.md` § Responses and errors](../drive-automation-session/references/webdriver.md#responses-and-errors), never the envelope itself: a find prints the element object, a call with no result prints `null`, a failure prints a top-level `{"error":"…","message":"…"}` at exit 0, and `wd get screenshot` / `wd get source` print raw base64 PNG / raw XML - pipe those straight into a file.
- **Session commands** mix text + exit code. `session create --hide` prints `Session <id> created for device <udid>.` (and, without `--hide`, an extra `Session token <jwt>` line - which is why the flag is mandatory); `session ping` prints `Session <id> pinged.` and signals liveness through exit code (0 = alive); `session list` prints a comma-separated table (`ID, State, Type, Device, Platform, Created, Ended`) followed by a footer - `Page N (M items), T total` when paged, `N of T sessions, P pages.` when `--all` spans several pages - or the single line `No sessions found.` when nothing matches.
- **`device` / `file` / `app` / `test`** emit plain text and signal failure through exit code. Long-running ones (`test run`, `device forward`) should be launched with `run_in_background: true` and tailed.

For the full per-command table (response on stdout, exact parsing recipe per command), see [`references/response-shapes.md`](references/response-shapes.md). Consult it when the response shape isn't obvious from these summary rules.

### Persistent session artifacts

After (and during) a session, the workspace and home directory contain:

- **`.kobiton/sessions/<session-id>/screenshot-<ts>.png`** - every screenshot captured during the session.
- **`.kobiton/sessions/<session-id>/source-<ts>.full.xml`** - every raw page-source dump captured during the session.
- **`.kobiton/sessions/<session-id>/source-<ts>.xml`** - the lean view of each dump (the file to read).
- **`~/.kobiton/.session`** - the JWT for the most recently created session, written by `session create` whether or not `--hide` is passed. The CLI uses this implicitly; treat it as opaque and never read it into chat. It's overwritten by the next `session create`.

`<ts>` is the capture's epoch seconds, so files sort chronologically; the kinds and names match [`webdriver.md` § Observe](../drive-automation-session/references/webdriver.md#observe).

The Kobiton portal also hosts a live session view at:

    <portal-base>/sessions/<session-id>

Where `<portal-base>` is derived from the `KOBITON_PORTAL` value in the active profile by replacing the `api` host prefix with `portal` (e.g., `https://api.kobiton.com` -> `https://portal.kobiton.com`, `https://api-test.kobiton.com` -> `https://portal-test.kobiton.com`). Surface this URL when summarizing a finished session so the user can review the recorded video and logs.

## Error Handling

- **Unexpected argument / unknown flag**: run `$KOBITON_BIN <command> --help` to discover the correct syntax, then retry with the right arguments. Never guess flags. Exception: never drop `--hide` from `session create` - if it is rejected, the cached build is too old (see below).
- **`Refusing to run 'session create' ... does not support --hide`** from the wrapper: the pinned build is not cached and the fallback build predates `--hide`, so creating a session would print the bearer token. Run `/automate:setup` (or re-open the session so the SessionStart hook downloads the pinned build), then retry the same command.
- **`wd` errors**: WebDriver failures (e.g. no such element) print a top-level `{"error":"<error>","message":"…"}` and exit 0 - check `.error` in the output. Transport failures (`Failed to connect to Direct Hub`, `Invalid session '<id>'`) print plain text on stderr and exit non-zero - check `$?` as well, and retry the command once. A bounded `device log` exiting 124 (`timeout`) or 142 (perl-alarm) is the bound firing, not a failure.
- **Session create failed**: device may be offline, already reserved, or the UDID is wrong - verify availability with the `listDevices` MCP tool before retrying.
- **Session expired / auth error mid-flow**: `session ping` fails or a command returns auth error - offer to create a new session.
- **`no such element`, `stale element reference` and other WebDriver errors**: see [`webdriver.md` § Responses and errors](../drive-automation-session/references/webdriver.md#responses-and-errors) for the next move; capture the page source (Step 4) before re-planning a selector.
- **Binary not found**: no cached CLI build exists under `~/.kobiton/cli/` - run `/automate:setup` (or re-open the session so the SessionStart hook downloads the pinned build). If the platform is unsupported (Intel Mac, non-x64), recommend `run-automation-suite` or the MCP tools instead.
- **Checksum mismatch during install**: the download was corrupted or tampered with - the installer discards it and keeps any existing cache. Retry `/automate:setup`; if it persists, report it on the plugin repo.
- **Version drift warning from `run.sh`**: the pinned build is not cached (usually pruned upstream) and a different cached build is being used - run `/automate:doctor` to see pinned vs installed vs latest, and update the automate plugin to its latest version (newer releases pin a validated build).
- **Missing credentials**: direct the user to run `/automate:doctor` first to see what's missing; if the credentials file is missing or incomplete, run `/automate:setup` to fetch and write fresh credentials.

## Examples

### Example 1: Open Settings -> Display -> screenshot (Android)

> "Take an Android Pixel device, open the Settings app, tap Display, then screenshot what's on screen."

The skill walks through:

1. Query MCP `listDevices` filtered to Android Pixel and pick the first AVAILABLE one - say UDID `9B211FFAZ0017F`, device id `4218`.
2. Create the session:

       ~/.kobiton/bin/kobiton -u 9B211FFAZ0017F session create --hide

   Output is `Session 12345 created for device 9B211FFAZ0017F.` (and no token line, thanks to `--hide`). Capture the ID.

3. Prepare the workspace:

       mkdir -p .kobiton/sessions/12345

4. Press Home (in case another app was foregrounded), then launch Settings:

       ~/.kobiton/bin/kobiton wd post execute/sync \
         '{"script":"mobile: pressKey","args":[{"keycode":3}]}'
       ~/.kobiton/bin/kobiton app run com.android.settings

5. Find the "Display" row by visible text:

       ~/.kobiton/bin/kobiton wd post element \
         '{"using":"xpath","value":"//*[@text=\"Display\"]"}'

   The CLI prints the unwrapped element object, `{"ELEMENT":"…","element-6066-11e4-a52e-4f735466cecf":"…"}`; extract the element ID with the extractor in [`webdriver.md` § Transports](../drive-automation-session/references/webdriver.md#transports).

6. Click it (substituting the captured `ELEMENT_ID`):

       ~/.kobiton/bin/kobiton wd post element/<ELEMENT_ID>/click '{}'

7. Capture the screenshot (one `TS` per observation, as in Step 4):

       TS=$(date +%s)
       ~/.kobiton/bin/kobiton wd get screenshot \
         | base64 -d \
         > .kobiton/sessions/12345/screenshot-$TS.png
       echo "$TS"

8. Read the file with the `Read` tool to display it inline, then report:

   > "Done. Screenshot saved to `.kobiton/sessions/12345/screenshot-1747612345.png`. Live session: `https://portal.kobiton.com/sessions/12345`."

9. If the user is finished, end the session:

       ~/.kobiton/bin/kobiton session end

### Example 2: Push a file, verify it landed, pull logs back (Android)

> "Push `./test-data.json` to `/sdcard/Download/` on the Pixel I'm already using, verify with `ls`, then pull the latest `logs.txt` from the device back into my project."

The skill walks through:

1. Check whether the existing session is still alive:

       ~/.kobiton/bin/kobiton session ping

   Exit 0 -> reuse it. Non-zero -> create a new one as in Example 1.

2. Push the file:

       ~/.kobiton/bin/kobiton file push ./test-data.json /sdcard/Download/test-data.json

3. Verify with adb shell:

       ~/.kobiton/bin/kobiton device adb-shell ls -la /sdcard/Download/test-data.json

   Expect a line like `-rw-rw---- 1 root sdcard_rw 1234 2026-05-19 09:30 /sdcard/Download/test-data.json`. Surface that line to the user.

4. Pull logs into the workspace:

       ~/.kobiton/bin/kobiton file pull /sdcard/logs.txt ./logs.txt

5. Read `./logs.txt` and report a one-line summary plus the file path. Do **not** echo the entire log to chat - it's likely large; instead `head -50` it or grep for keywords the user cares about.

### Example 3: Inspection-only - dump page source, list clickable elements (Android)

> "What clickable things are on screen right now? Save the page source so I can grep it later."

Assumes a session is already active (run `session ping` first; if expired, create a new one).

1. Dump the source and write its lean view - ensure the artifacts directory exists first, and substitute `$SKILL_DIR` with this skill's absolute directory ([How It Works](#how-it-works)):

       mkdir -p .kobiton/sessions/12345
       TS=$(date +%s)
       ~/.kobiton/bin/kobiton wd get source \
         > .kobiton/sessions/12345/source-$TS.full.xml
       node "$SKILL_DIR/../drive-automation-session/scripts/ui-tree.js" \
         .kobiton/sessions/12345/source-$TS.full.xml \
         > .kobiton/sessions/12345/source-$TS.xml

2. Read the lean `source-<ts>.xml` - every clickable element is in it with `clickable="true"`, its `resource-id` / `content-desc` / `text` and its `bounds`. On a long screen, a quick filter of the lean file is enough:

       grep 'clickable="true"' .kobiton/sessions/12345/source-<ts>.xml | head -20

   The lean view is all this question needs. Reach for the full file only for the [`webdriver.md`](../drive-automation-session/references/webdriver.md#when-to-open-the-full-source) cases - for example a targeted structured query such as `xmllint --xpath '//*[@clickable="true"]/@resource-id' .kobiton/sessions/12345/source-<ts>.full.xml` (Android) when you need an attribute the lean view leaves out.

3. Report a deduplicated list of resource IDs (or fall back to `content-desc` / `text` for nodes that have no `resource-id`), and the paths to both files - the user asked to keep the page source for later grepping, and `source-<ts>.full.xml` is the complete one.

## Resources

- [Appium 2.x documentation](https://appium.io/docs/en/2.0/) - driver-specific docs (UiAutomator2 for Android, XCUITest for iOS) for the WebDriver endpoints called via `wd post` / `wd get`.
- [`kobiton/automate` plugin source](https://github.com/kobiton/automate) - issue tracker and source for the CLI wrapper (`skills/run-interactive-session/scripts/run.sh`), the install script, and the `CLI_VERSION` pin.
- [`run-automation-suite`](../run-automation-suite/SKILL.md) - sister skill for non-interactive runs of an existing Appium script. Use it when the user wants to execute a full test suite rather than drive the device step-by-step, or when the host platform has no published CLI build (e.g. Intel Macs).
- `/automate:setup` - install / refresh the CLI symlink and the credentials profile at `~/.kobiton/.credentials`.
- `/automate:doctor` - read-only health check for CLI symlink, credentials file, active profile, and required fields.
