# Per-Command Response Shapes

Reference material for the `run-interactive-session` skill. The skill drives a Kobiton device by translating natural-language intent into CLI commands; this file holds the parsing guidance for every command's response so the skill knows how to extract values, detect success, and surface results to the user.

Most WebDriver endpoints return a JSON envelope `{"value": <result>}`. A few commands (`wd get screenshot`, `wd get source`) are unwrapped by the CLI and emit raw bytes/text directly. Non-WebDriver commands (`session`, `device`, `file`, `app`, `test`) typically emit plain text and signal failure through exit code.

## WebDriver commands

| Command | Response on stdout | How to read |
|---|---|---|
| `wd post element` (find) | JSON envelope; the element ID lives under `.value` (W3C/Appium standard - may be `.value.ELEMENT` or `.value["element-6066-11e4-a52e-4f735466cecf"]` or a bare string) | Extract with `jq -r '.value.ELEMENT // .value["element-6066-11e4-a52e-4f735466cecf"] // .value'`, or pattern-match the string |
| `wd post element/<id>/click`, `.../value`, `.../clear`, `wd post orientation`, `wd post url`, `wd post actions`, `wd post execute` | JSON envelope `{"value": <result>}`; usually `null` on success | Treat null/empty `.value` as success; surface a non-null `.value` (e.g., script return) to the user |
| `wd get element/<id>/text`, `wd get url`, `wd get orientation` | JSON `{"value":"<string>"}` | `.value` is the requested string |
| `wd get window/rect` | JSON `{"value":{"width":<n>,"height":<n>,"x":<n>,"y":<n>}}` | Use `.value.width` etc. |
| `wd get screenshot` | Base64-encoded PNG (CLI unwraps the WebDriver JSON for you) | Pipe through `base64 -d` straight into a `.png` file |
| `wd get source` | Raw XML / hierarchy markup (CLI unwraps the WebDriver JSON for you) | Redirect straight into a `.xml` file |

## Session lifecycle

| Command | Response on stdout | How to read |
|---|---|---|
| `session create --hide` | One line: `Session <id> created for device <udid>.`; the session token is **not** printed (it is still saved to `~/.kobiton/.session`) | `grep -oE 'Session [0-9]+ created'` and take the number. Without `--hide` a second line `Session token <jwt>` appears - always pass the flag, and never echo that line if you see it |
| `session ping` | `Session <id> pinged.`; exit code 0 = alive, non-zero = expired | Trust exit status; don't parse stdout |
| `session list` | Comma-separated table: header `ID, State, Type, Device, Platform, Created, Ended`, one session per row (`Ended` is `active` for running sessions), then a footer. Paged (default 20 rows): `Page N (M items), T total`. With `--all` spanning several pages: `N of T sessions, P pages.` (a single-page `--all` keeps the paged footer; on the current build the `T` in that footer can read `0` - count the rows instead). **No matches print the single line `No sessions found.` with no header row** - treat it as an empty result, not a failed call | Read directly or `grep` for an id / device name; narrow with `--state`, `--type`, `--platform`, `--keyword`, `--from` / `--to` rather than parsing a large dump. Check for `No sessions found.` before looking for the header; accept either footer. The `Type` column carries the same values as `getSession` (`CLI`, `AUTO`, `MANUAL`, `UIAUTOMATOR`, ...) |
| `session show` | Key/value lines: session name, `Created:`, `Device <udid>: <platform> <version>`, `Status:` | Read directly |
| `session end` | `Session <id> ended.` | No parsing needed |

## Device / file / app / test

| Command | Response on stdout | How to read |
|---|---|---|
| `device adb-shell <cmd>` | Raw stdout from the on-device shell. Shape depends on `<cmd>` - KV pairs (`dumpsys battery`), single line (`getprop`), multi-line table (`pm list`, `ps`), or free text (`logcat`) | (a) For single-value extractions, `grep` or `awk` the line. (b) For multi-line output, save to artifact then parse. (c) **Gotcha:** exit code 0 does NOT mean the inner command succeeded - adb returns 0 as long as it could deliver the command; check stderr or look for error strings in stdout. (d) On restricted sessions (public cloud / trial devices) a **whitelist rejection also lands on stdout at exit 0** - string-match the first line against `Input contains a forbidden character:`, `Command is not on the whitelist:`, `Argument is not permitted for`, and `Only get/put of secure enabled_accessibility_services is permitted` before trusting empty or short output (see the SKILL's Restricted sessions block). |
| `device screen` | JPEG image bytes - check `--help` for output flag (e.g., `--out`) | Redirect or use the documented output flag |
| `device forward [--mode mux\|demux]` | `Listening on <addr>.` then blocks - the command runs in the foreground for the lifetime of the forward and holds the local port. Output shape is the same for both modes | A non-returning invocation is normal, not a hang; launch with `run_in_background: true` and kill explicitly to release the port. Transient network failures are retried for up to 5 minutes - during a retry the process is silent, so give it that long before concluding it is stuck |
| `device ps`, `file list` | Plain text on stdout | Read directly |
| `file push`, `file pull` | Text confirmation; non-zero exit on failure | Surface failures by exit code |
| `app run <app-id>` | Text confirmation; the app launches on the device | Continue interacting after launch |
| `test run --app … --runner … <uiautomator\|xcuitest>` | Progress lines while the device is booked and the bundles install; with `--follow` a final summary block with the pass/fail result; with `--stream` the raw test-runner log as it is emitted (no session report afterwards) | Run with `run_in_background: true`; parse the final summary block (`--follow`) or grep the streamed log. Fetch the report URL afterwards with the `getSessionArtifacts` MCP tool. Unrelated to the `createTestRun` MCP tool, which replays a recorded test case |

## See also

- [`../SKILL.md`](../SKILL.md) - the orchestration skill that consumes this reference.
- [`../SKILL.md#command-reference`](../SKILL.md#command-reference) - the inverse lookup (intent -> command shape) that complements this file (command -> response shape).
- [Appium 2.x documentation](https://appium.io/docs/en/2.0/) - canonical W3C WebDriver / Appium endpoint response schemas the CLI thinly wraps.
