---
name: run-interactive-test
description: Perform interactive testing on Kobiton devices using natural language. Translates user intents into CLI commands — WebDriver actions (find elements, type, click, swipe), device operations (adb shell, logs, screen capture, port forwarding), file management (push/pull), app management, and test execution. Use this skill whenever the user wants to interact with a mobile device on Kobiton, run exploratory tests, inspect device state, manage files on a device, or execute test sessions — even if they don't say "interactive test" explicitly.
---

## How It Works

All commands go through a single wrapper script that automatically handles:
- Platform-specific binary resolution
- Portal URL (from `KOBITON_PORTAL` in credentials, or derived from `.mcp.json` as fallback)
- Credentials (loaded from `~/.kobiton/.credentials` using AWS-style profiles)
- Session token (loaded by the CLI from `~/.kobiton/.session`)

Every command is self-contained — no env vars to manage between calls:

    ~/.kobiton/bin/kobiton <cli-args>

`$KOBITON_BIN` is used as shorthand throughout this document. In every Bash command, substitute it with the literal path `~/.kobiton/bin/kobiton` — the variable does not persist between Bash calls.

## Prerequisites

Run `/automate:setup` before first use. This verifies the CLI is installed and guides you through credentials configuration.

If a command fails with a credentials error, direct the user to run `/automate:setup` to reconfigure.

## CLI Syntax

Global flags must come **before** the subcommand:

    $KOBITON_BIN [global-flags] <subcommand> [subcommand-flags]

### Discovering Commands

The CLI has built-in help at every level. **Always check `--help` before running a command you haven't used before or when unsure about arguments:**

    $KOBITON_BIN --help                    # list all top-level commands
    $KOBITON_BIN session --help            # session create, ping, end
    $KOBITON_BIN session create --help     # show create flags and usage
    $KOBITON_BIN wd --help                 # webdriver post/get commands
    $KOBITON_BIN device --help             # list, adb-shell, forward, ps, log, screen
    $KOBITON_BIN device adb-shell --help   # run adb shell commands on device
    $KOBITON_BIN file --help               # list, push, pull files on device
    $KOBITON_BIN file push --help          # push local file to device
    $KOBITON_BIN test --help               # test run with built-in framework
    $KOBITON_BIN test run --help           # show test run flags and usage
    $KOBITON_BIN app --help                # app management commands
    $KOBITON_BIN app run --help            # show app run flags and usage

**Rule: if a command fails with "unexpected argument" or "unknown flag", run `--help` on that command to discover the correct syntax before retrying.** Do not guess — the help output is authoritative.

## Session Lifecycle

### Create a session

Ask the user which device to target. Use the `listDevices` MCP tool to find available devices if needed.

    $KOBITON_BIN -u <udid> session create

The CLI output includes the Kobiton session ID (e.g., `kobitonSessionId: 12345`). Capture it:

1. Parse the session ID from the output
2. Create the artifacts directory: `mkdir -p .kobiton/sessions/<session-id>`
3. Store the session ID for use in screenshot and page source commands

The JWT is saved automatically to `~/.kobiton/.session`. All subsequent commands use it — no flags needed.

### Check if a session exists

    $KOBITON_BIN session ping

If it succeeds, the session is still active. If it fails, create a new one.

### End a session

    $KOBITON_BIN session end

## Command Execution

When the user describes what they want in natural language:

1. Translate the intent to one or more commands using the reference below
2. Run each command via Bash using `$KOBITON_BIN` (the global CLI wrapper)
3. Parse JSON responses to extract values (e.g., element IDs)
4. Report results in plain language

### Chaining

Multi-step intents require chaining. Example: "find the Name field and type Hello"

1. `$KOBITON_BIN wd post element '{"using":"id","value":"com.app:id/etName"}'` — extract `ELEMENT_ID` from the `value` field in the JSON response
2. `$KOBITON_BIN wd post element/$ELEMENT_ID/value '{"text":"Hello"}'`

Always extract the element ID from the response before using it in subsequent commands.

## Command Reference

| Intent | Command |
|--------|---------|
| Find element by ID | `$KOBITON_BIN wd post element '{"using":"id","value":"<id>"}'` |
| Find element by XPath | `$KOBITON_BIN wd post element '{"using":"xpath","value":"<xpath>"}'` |
| Find element by class | `$KOBITON_BIN wd post element '{"using":"class name","value":"<class>"}'` |
| Click element | `$KOBITON_BIN wd post element/<elementId>/click '{}'` |
| Type text | `$KOBITON_BIN wd post element/<elementId>/value '{"text":"<text>"}'` |
| Clear text | `$KOBITON_BIN wd post element/<elementId>/clear '{}'` |
| Get element text | `$KOBITON_BIN wd get element/<elementId>/text` |
| Get page source | `$KOBITON_BIN wd get source` |
| Get orientation | `$KOBITON_BIN wd get orientation` |
| Set orientation | `$KOBITON_BIN wd post orientation '{"orientation":"LANDSCAPE"}'` |
| Get window size | `$KOBITON_BIN wd get window/rect` |
| Take screenshot | `$KOBITON_BIN wd get screenshot` |
| Accept alert | `$KOBITON_BIN wd post execute '{"script":"kobiton:alerthandler","args":{"auto":"accept"}}'` |
| Dismiss alert | `$KOBITON_BIN wd post execute '{"script":"kobiton:alerthandler","args":{"auto":"dismiss"}}'` |
| Go to URL | `$KOBITON_BIN wd post url '{"url":"<url>"}'` |
| Get current URL | `$KOBITON_BIN wd get url` |
| Swipe | `$KOBITON_BIN wd post actions '{"actions":[{"type":"pointer","id":"finger1","parameters":{"pointerType":"touch"},"actions":[{"type":"pointerMove","duration":0,"x":<startX>,"y":<startY>},{"type":"pointerDown","button":0},{"type":"pointerMove","duration":500,"x":<endX>,"y":<endY>},{"type":"pointerUp","button":0}]}]}'` |
| Tap at coordinates | `$KOBITON_BIN wd post actions '{"actions":[{"type":"pointer","id":"finger1","parameters":{"pointerType":"touch"},"actions":[{"type":"pointerMove","duration":0,"x":<x>,"y":<y>},{"type":"pointerDown","button":0},{"type":"pointerUp","button":0}]}]}'` |
| Press back (Android) | `$KOBITON_BIN wd post execute '{"script":"mobile: pressKey","args":{"keycode":4}}'` |
| Press home (Android) | `$KOBITON_BIN wd post execute '{"script":"mobile: pressKey","args":{"keycode":3}}'` |
| Ping session | `$KOBITON_BIN session ping` |

### Artifacts Storage

All session artifacts (screenshots, page source) **must** be saved under the current workspace directory at `.kobiton/sessions/<session-id>/`. This keeps artifacts organized per session, easy to review, and version-controllable. Never save artifacts to `/tmp/` or other locations outside the workspace.

### Screenshot Handling

When taking a screenshot:

1. Run `$KOBITON_BIN wd get screenshot` — returns base64 string
2. Save to workspace: `echo "<base64>" | base64 -d > .kobiton/sessions/<session-id>/screenshot-$(date +%s).png`
3. Read the saved file to display it, and report the file path to the user

### Page Source Handling

When capturing page source (for debugging or element inspection):

1. Save to workspace: `$KOBITON_BIN wd get source > .kobiton/sessions/<session-id>/source-$(date +%s).xml`
2. Read the saved file for element inspection

## Beyond WebDriver

The CLI supports more than WebDriver commands. These require an active session. Use `--help` to discover exact flags before running.

| Domain | Command | What it does |
|--------|---------|-------------|
| Device | `$KOBITON_BIN device adb-shell <command>` | Run adb shell command on device |
| Device | `$KOBITON_BIN device log` | Stream device logs |
| Device | `$KOBITON_BIN device screen` | Capture device screen as jpg |
| Device | `$KOBITON_BIN device forward <local> <remote>` | Forward local port to device |
| Device | `$KOBITON_BIN device ps` | List processes on device |
| File | `$KOBITON_BIN file list <path>` | List files on device |
| File | `$KOBITON_BIN file push <local> <remote>` | Push file to device |
| File | `$KOBITON_BIN file pull <remote> <local>` | Pull file from device |
| App | `$KOBITON_BIN app run <app-id>` | Launch an app |
| Test | `$KOBITON_BIN test run` | Execute a test session |

Always run `$KOBITON_BIN <command> --help` for the specific subcommand before using it — argument order and required flags vary.

## Error Handling

- **Unexpected argument / unknown flag**: run `$KOBITON_BIN <command> --help` to discover the correct syntax, then retry with the right arguments. Never guess flags.
- **Session create failed**: device may be offline, already reserved, or UDID is wrong — verify the device is available with the `listDevices` MCP tool before retrying
- **Session expired**: `session ping` or command returns auth error — offer to create a new session
- **Element not found**: suggest getting page source first (`wd get source`) to inspect the UI hierarchy, then try a different locator strategy
- **Binary not found**: run.sh failed — tell user their platform is not supported
- **Missing credentials**: direct the user to run `/automate:setup` to configure credentials
