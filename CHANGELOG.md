# Changelog

## 1.6.0 - 2026-06-12

### New `drive-automation-session` skill

`automate:drive-automation-session` drives an already-reserved Kobiton device from a natural-language intent. Opens an **automation-type** Appium session directly against the Kobiton WebDriver hub (the first direct-Appium-HTTP path in this plugin), runs a turn-based observe-act cycle, and returns a session id consumable by `getSession`, `getSessionArtifacts`, and `saveTestCase` unchanged. Complements `run-interactive-cli-session` (CLI session type) — does not replace it. Sessions open with `appium:newCommandTimeout: 1800` (30 min) so they survive human-in-the-loop pauses; the platform-side session-duration cap remains the wall-clock bound.

### Skill architecture (in `skills/drive-automation-session/`)

- **`scripts/appium.js`** — Node `node:https`-only Appium HTTP client. No package dependencies. Five subcommand shapes:
  - **Generic mode**: `node appium.js --method <GET|POST|DELETE> --url <path-after-/wd/hub> [--req-body '<json>'|@<file>]`. The AI host emits raw Appium calls per `references/endpoint-reference.md`.
  - **`screen`** helper: captures `iter-N.xml` (and `iter-N.png` with `--include-screenshot`); emits `{hash, xmlBytes, pngBytes}` on stdout. XML-only default saves tokens.
  - **`actions`** helper: builds the W3C `/session/{id}/actions` body for `touch`/`swipe`/`key` sub-types — too verbose to hand-write.
  - **`touch-perform`** helper: wraps a JSON-array of `{action, options}` steps for the legacy MJSONWP `/session/{id}/touch/perform`.
  - **`control`** subcommand: `--done` or `--blocked --reason "..."` writes `iter-N.control.json`; no HTTP call. Signals the host to end the cycle.
- **`references/`** — three docs the AI host reads: `endpoint-reference.md` (allowlisted endpoints + selector-construction guide), `loop-discipline.md` (per-turn pattern + stuck patterns + reading errors), `capabilities.md` (desired-caps payload).

### Per-turn pattern (in `SKILL.md`)

Each turn, the host exports `ITER=$((ITER + 1))` and picks **exactly one** of three branches: `screen` (observe), an Appium call (act), or `control` (end). A decision guide maps each previous-turn outcome to the next branch — e.g., a failed act with `no such element` calls for another `act` (with a corrected selector), not a fresh `screen` (the screen didn't change).

The script never enforces blocker thresholds. The host watches the `hash` emitted by `screen` and its own conversation context to detect stuck patterns (same-call repetition, A→B→A oscillation, credentials prompt, CAPTCHA, lazy load, network spinner) — see `loop-discipline.md` "Stuck patterns". The only hard programmatic stop besides fatal errors is **`MAX_ITERS=100`** (overridable per session), a safety net against runaway cycles.

### Credentials

Three sources, in precedence order: explicit flags (`--portal --user --api-key` or `--hub-url`), env vars (`KOBITON_USER` / `KOBITON_API_KEY` / `KOBITON_PORTAL`), then a fallback to parsing `~/.kobiton/.credentials` (file written by `/automate:setup`). The SKILL.md per-turn block exports the env vars once at startup — from `mcp__plugin_automate_kobiton__getCredential` when MCP is available, else from the file — so individual `appium.js` invocations stay flag-free. Credentials never appear in `argv`/`ps` listings. The file is parsed via a Bash `while IFS='=' read` loop, not `eval`, so a tampered credentials file cannot inject shell commands.

### Single exit code; host classifies errors

`appium.js` exits 0 for every outcome — success, Appium-level failure (4xx/5xx/parse/network/timeout), or host-fixable CLI usage error (missing flag, malformed JSON, unknown helper). The script writes `iter-N.error.json` on every failure path (when `--session-dir` is set): line 1 is `{status}` (HTTP) or `{error, message}` (usage/runtime); line 2+ is the verbatim response body. The host reads the file on the next turn and decides. The only non-zero exit is a Node literal crash. `references/loop-discipline.md` "Reading errors" documents which Appium W3C errors are typically re-plannable (`no such element`, `stale element reference`, `invalid selector`, `invalid argument`, `timeout`, HTTP 408) vs. likely-fatal (`invalid session id`, HTTP 5xx, non-Appium error pages).

### Cross-skill change: `run-automation-suite/scripts/render-capabilities.js`

Two new optional flags:
- `--newCommandTimeout <seconds>` — emits `appium:newCommandTimeout` when set; omitted when unset (preserves existing-caller behavior).
- `--scriptlessCapture` — emits `kobiton:scriptlessCapture: true` per KOB-41142, gating platform-side capture of WebDriver actions for `saveTestCase` consumability.

Both default off. `drive-automation-session` always passes both.

### `/automate:setup` documentation

Clarifies that `drive-automation-session` consumes the credentials file alongside MCP tools and `run-automation-suite`. Only `run-interactive-cli-session` depends on the additional CLI symlink. No behavior change in setup.

### Cleanup contract

The skill ends the WebDriver session on exit (normal, user interrupt, error) via a Bash `trap` that issues `DELETE /wd/hub/session/{id}` (idempotent — 404 is treated as success). This is the **only** path used in the happy case — Kobiton records the session state as `COMPLETE`. `mcp__plugin_automate_kobiton__terminateSession` is NOT called by default; it would mark the session `TERMINATED` (treated as abnormal exit by the recording pipeline) and is reserved for the force-kill case where the WebDriver DELETE is genuinely unreachable AND the user explicitly asks for it.

### Pilot-feedback follow-up (post-review tweaks within 1.5.0)

A first pilot run (`/automate:drive-automation-session "open youtube.com on chrome, search 'world cup 2026' and play the first video"` on a Pixel 8a, 32 iterations, end-to-end success) surfaced real workarounds that weren't in the skill docs and ergonomics gaps versus `run-automation-suite`. A second review (with a pre-session screenshot showing Chrome's "notifications" welcome dialog blocking the first turn) revealed that XML-only observation misses native overlays entirely. All addressed in the same 1.5.0 release without a version bump:

- **`screen` captures PNG by default.** Previously XML-only with `--include-screenshot` opt-in; now writes both `iter-N.xml` and `iter-N.png` by default. Native overlays (Chrome's "notifications" welcome card, OS-level permission prompts, system dialogs) are NOT in the webview source XML — only the screenshot catches them. New `--xml-only` flag skips the screenshot when you trust the source is complete (token savings); new `--png-only` flag skips the source for visual-only verification turns. `--include-screenshot` retained as a no-op for backward compatibility. +4 vitest cases covering all three modes plus the mutually-exclusive guard.
- **`appium.js` auto-wraps caps in W3C envelope** when generic-mode hits `POST /session` with a flat caps body. `render-capabilities.js` emits flat caps (`{platformName: ..., appium:udid: ..., ...}`) but the Appium hub requires `{capabilities: {alwaysMatch: ...}}`. Pre-wrapped bodies pass through unchanged. Avoids the `400 "desiredCapabilities or capabilities is required"` the pilot hit on its first attempt. +3 vitest cases covering auto-wrap, passthrough, and non-`/session` no-false-positive.
- **`references/endpoint-reference.md` "Web sessions" section rewritten** to lead with the universal approach: switch to NATIVE_APP context, tap viewport coordinates via the `actions` helper. Works for both clicks and media activation, routes through the scriptless-capture allowlist, and sidesteps the three chromedriver pitfalls (in-webview click failures, missing user-activation, unstable context names) in one move. `execute/sync` is a brief fallback subsection for web-only operations (DOM manipulation, hidden elements, custom events).
- **SKILL.md emphasizes credential-export-once.** The pilot re-parsed `~/.kobiton/.credentials` on every Bash call. Added an explicit "DON'T re-parse per call" anti-pattern callout under Step 1.
- **Step 0: Device + app selection (ask before picking).** Inherited from `run-automation-suite`. If the user didn't specify a device, the skill asks before auto-picking. Auto-pick is allowed only when the intent unambiguously implies a platform AND the user didn't constrain — and even then, the skill states which device it picked and why.
- **Step 3b: Offer to open the live view after session start.** Inherited from `run-automation-suite`. After session create, the skill asks whether the user wants to watch the device drive in real time via `<portal>/devices/launch?id=<deviceId>&view=device-only`. Open via `Bash(open:*)` / `Bash(xdg-open:*)` on user confirm — never auto-open.

### Test surface

154 vitest cases total, up from 116:
- `skills/drive-automation-session/scripts/appium.test.js` — 40 cases against an in-proc HTTP mock. Covers generic mode (GET/POST/DELETE, inline + `@file` bodies, `/wd/hub` prefix normalization, idempotent DELETE on 404, **auto-wrap of flat caps on POST /session, passthrough of already-wrapped bodies, no-wrap on non-`/session` URLs**), all three credential paths (triple, env, `--hub-url` backward-compat) and flag override of env, exit-0-always semantics for every error category, **`screen` helper (default both-by-default, `--xml-only`, `--png-only`, mutually-exclusive guard)**, `--session-dir` artifact persistence (request/response/error, no-files-without-flags, 3-digit padding, `ITER` env fallback + explicit `--iter` override, bad-input-writes-error-file), `actions` helper (all three sub-types + validation), `touch-perform` helper + validation, `control` helper for DONE/BLOCKED + validation, generic-mode usage errors.
- `skills/run-automation-suite/scripts/render-capabilities.test.js` — 5 new cases for `--newCommandTimeout` (3) and `--scriptlessCapture` (2).

## 1.5.0 - 2026-06-11

- New `getAppParsingStatus` MCP tool — checks the async parse status of an uploaded app version by `versionId`. After `confirmAppUpload` the app is created in state `PARSING`; poll this tool until the state is terminal (`OK` or a `FAILURE_*` value) before reserving devices or starting sessions. Also resolves the real `appId` when `confirmAppUpload` returned `appId: null` for a brand-new upload.
- `confirmAppUpload` description now documents the async parsing flow and points to `getAppParsingStatus` for polling.
- `docs/examples.md` gains an upload-then-poll example covering the new tool.

## 1.4.3 - 2026-06-02

- New `getUserInputEvents` MCP tool — surfaces the touch/swipe gestures a human makes on the device-only live view so an agent-driven session can be redirected mid-run. The user's tap reaches the device in real time AND is reported to the agent as an observation to react to ("the user just tapped Settings → pivot the test plan to Settings"). Keystroke / right-click / pinch / drag-off-canvas remain suppressed.
- `run-automation-suite` skill now polls `getUserInputEvents` between scripted commands.

## 1.4.2 - 2026-06-02

- **Fix Copilot CLI command loading:** the `name: "automate:setup"` / `name: "automate:doctor"` frontmatter in `commands/*.md` is now plain `name: "setup"` / `name: "doctor"` — Copilot CLI validates the `name` field and rejects colons ("Command name must contain only letters, numbers, hyphens, underscores, dot"), which broke command loading. Claude Code and Copilot CLI derive `/automate:setup` and `/automate:doctor` from the filename + plugin namespace as before; Gemini CLI (bundled TOML) and Codex CLI are unaffected.
- **Cursor CLI command names:** as a consequence, Cursor CLI now registers the commands as `/setup` and `/doctor` (Cursor applies no plugin namespace). They coexist with Cursor's built-in `/setup` — the plugin's entries are distinguishable by their Kobiton descriptions. README and command bodies updated accordingly.
- **Docs (Cursor CLI):** install steps describe the actual marketplace flow (repo parsing, Enter to install, restart `agent` so skills load), and a new Cursor CLI troubleshooting section covers stale/missing skills and commands, MCP disconnects, and the missing `~/.kobiton/bin/kobiton` wrapper.

## 1.4.1 - 2026-06-02

- **chromeless-launcher (mac):** detect Chrome / Chromium / Chrome Canary / Brave at their standard `/Applications/` paths instead of hardcoding only `Google Chrome.app`. Users running Chromium or Canary now get the chromeless window instead of silently falling through to the default-browser path. Linux already had this behaviour via `command -v` over a candidate list.
- **chromeless-launcher (all OSes):** validate `--width` / `--height` / `--x` / `--y` as positive integers at argument-parse time. Non-numeric, zero, or negative dimensions now exit `64` with a clear "must be a positive integer" message, instead of either tripping `set -e` on later arithmetic or producing an invalid window size.
- **Test surface:** 19 new vitest cases — numeric-validation rejection (9 cases across dispatcher / mac / linux shims), codex-mirror existence (5 cases), and codex-mirror byte-identity (5 cases). The new mirror-parity tests assert that `.codex/skills/run-automation-suite/scripts/` carries byte-identical copies of every launcher script — closing the gap where unit tests only covered the `skills/` tree.

## 1.4.0 - 2026-06-01

- New **chromeless launcher** for `run-automation-suite` Step 5: when the skill resolves the device-only view URL and the user's saved browser preference is Google Chrome (or no preference is saved), launch Chrome in `--app` window mode (no tab strip, no URL bar, no bookmarks bar) and resize the window to a device-shaped frame at runtime. Per-OS shims:
  - **macOS:** `osascript` resize loop with 10s poll, URL-substring window match, per-window `try`/`on error` so a stray window does not abort the iteration. Requires a one-time **Automation** grant for the host process to control Google Chrome (System Settings → Privacy & Security → Automation). Apple Events error `-1743` (Automation denied) is fail-open: the window opens at Chrome's default size, the launcher logs a hint, and the skill continues.
  - **Windows:** PowerShell + `Add-Type` `SetWindowPos`; matches the new window via a snapshot-before / diff-after over visible top-level Chrome windows (works whether Chrome was already running and `chrome.exe --app=` delegated to it, or started fresh).
  - **Linux:** launches Chrome `--app` + `--window-size` hint; no runtime resize (no portable cross-WM hook).
- **Device-class sizing heuristic** in `SKILL.md` Step 5. The skill picks launcher dimensions from the resolved device name (case-insensitive): tablet (`iPad`, `Galaxy Tab`, `Pixel Tablet`, `Surface`, `MatePad`, names containing `Tab` or `Pad`) → `780 × 920`; fold (`Fold`, `Z Fold`, `Pixel Fold`) → `880 × 920`; phone (default) → `540 × 920`. Landscape orientation swaps width and height. All three presets share the same `920 px` height so the chromeless window's vertical footprint stays consistent across device classes.
- Falls back gracefully when chromeless isn't appropriate: Chrome / Chromium not installed (launcher exits `2`), the URL branch is the manual-interaction form (no `?view=device-only`), or the user has explicitly saved Safari / Firefox / Default browser as their preference. In those cases the existing browser-preference open path is used (`open -a "Safari" <url>`, `xdg-open <url>`, etc.); Chrome is never spawned and no macOS Automation prompt appears.
- URL validation rejects bash-quoting-breaking metacharacters (`"`, backtick, `$`, `\`) and non-`http(s)` schemes at every launcher entry point. URL-syntax characters (`&`, `?`, `=`, `;`, `|`, `<`, `>`, single-quote) are accepted — Kobiton portal URLs need `&` between query params.
- `SKILL.md` Step 5 restructured: launcher invocation is the first action on the device-only branch when the gate allows; the existing "Which browser should I open the session in?" prompt + `open` / `xdg-open` table become the fallback path.
- `allowed-tools` extended to include `Bash(bash:*)`, `Bash(pwsh:*)`, `Bash(osascript:*)` (needed by the launcher shim invocations).
- 32 new vitest cases in `skills/run-automation-suite/scripts/chromeless-launcher.test.js` covering arg parsing, exit-code sentinels (`64` usage / `2` Chrome-absent fallback / `0` fail-open), URL metacharacter rejection, and positive-path acceptance for real `?id=…&view=device-only` URLs.
- `scripts/sync-version.js`: drive-by fix — the CHANGELOG regex `(\d+\.\d+\.\d+)\b` over-matched `1.4.0` against pre-release versions like `1.4.0-dev.0`. Now accepts SemVer 2.0 pre-release suffixes. Regression test added.

## 1.3.0 - 2026-05-28

- Multi-CLI support extended: install on [Cursor CLI](https://cursor.com/cli) in addition to the existing four hosts (Claude Code, GitHub Copilot CLI, Gemini CLI, Codex CLI)
- New `.cursor-plugin/plugin.json` + `.cursor-plugin/marketplace.json` following the [cursor/plugins](https://github.com/cursor/plugins) convention — install in-session with `/plugin marketplace add https://github.com/kobiton/automate`, or drop just `.cursor/mcp.json` into any project for an MCP-only setup
- New `.cursor/hooks/hooks.json` declaring a `sessionStart` event for the `~/.kobiton/bin/kobiton` CLI wrapper; Cursor CLI does not currently run plugin sessionStart hooks, so run `/automate:setup` once after install to create the wrapper (same as Copilot and Gemini)
- MCP requests originating from Cursor carry `X-AI-Tool-Name: Cursor` for adoption analytics (KOB-52724)
- Documented install paths for additional generic MCP clients — ChatGPT (Apps SDK) and Continue / Cline / other Streamable-HTTP clients — in a new "Other MCP Clients" README subsection (configs derived from each client's published documentation; not yet end-to-end validated)
- `/automate:setup` and `/automate:doctor` are now wired for Cursor CLI too — the `.cursor-plugin/plugin.json` `commands` field points at the shared `commands/*.md` set, which Cursor reads in the same Markdown + YAML-frontmatter format


## 1.2.2 - 2026-05-25

- Added 14 Test Case Management MCP tool schemas in `tools/test-management.yaml` — test cases (`saveTestCase`, `listTestCases`, `getTestCase`, `updateTestCase`, `deleteTestCase`), test runs (`createTestRun`, `listTestRuns`, `getTestRun`, `terminateTestRun`), and test suites (`listTestSuites`, `getTestSuite`, `createTestSuite`, `updateTestSuite`, `deleteTestSuite`)
- Updated bundled `kobiton` CLI binary in `run-interactive-cli-session` skill to the latest version
- Expanded `run-interactive-cli-session` adb-shell documentation for AI agents: quoting rules (local vs device shell parsing), platform guard (Android only), 22-row intent-to-command cookbook, big-output redirect pattern (to avoid 25k-token MCP overflow), long-running command guidance, and response parsing gotchas in `references/response-shapes.md` — notably that `adb` returns exit code 0 even when the inner command fails

## 1.2.1 - 2026-05-20

- `run-automation-suite` skill now defaults to the **device-only view URL** (`?view=device-only`) when surfacing the live session link, hiding the surrounding Kobiton UI for a cleaner watch-the-test experience. Falls back to the default-view URL only when the user explicitly asks to interact with the device.
- Portal URL mapping in the skill is now derivation-based (`api*.kobiton.com` → `portal*.kobiton.com`) instead of a hard-coded per-env table.


## 1.2.0 - 2026-05-18

- Multi-CLI support: install on GitHub Copilot CLI, Gemini CLI, and Codex CLI in addition to Claude Code
- New `run-interactive-cli-session` skill — natural-language WebDriver/device/file commands powered by the bundled `kobiton` CLI wrapper (macOS Apple Silicon binary included)
- New `/automate:setup` command — bootstraps `~/.kobiton/.credentials` from the authenticated MCP session, no manual file editing
- New `/automate:doctor` command — read-only health checks for CLI install, credentials file, active profile, and required fields
- New `getCredential` MCP tool — backs `/automate:setup`; returns the OAuth user's username, API key (existing or freshly generated), and portal URL
- Session attribution: Appium sessions started via `run-automation-suite` now emit `kobiton:aiToolName`; MCP requests from Claude Code, Codex CLI, and Gemini CLI carry `X-AI-Tool-Name` (set to the originating tool) for adoption analytics (KOB-52724)
- Governance: CodeQL weekly scans + per-PR analysis, security issue routing template


## 1.1.0 - 2026-05-10

- Plugin now sends an `X-AI-Tool-Name: Claude` header on every MCP request so Kobiton can attribute sessions to Claude Code in adoption analytics. Set automatically in all three shipped configs (OAuth, API-key, dev-local) — no end-user action required (KOB-52724)


## 1.0.2 - 2026-04-02

- Improved the accuracy of fetching Appium capabilities supported by Kobiton
- Implemented a reliable method for correlating active sessions with their corresponding device IDs


## 1.0.1 - 2026-04-01

- Added a user confirmation prompt when selecting an app version for testing
- Enabled Claude to open active test sessions for live screen previews


## 1.0.0 - 2026-03-31

- Initial release with 12 MCP tools and 1 skill
- Authentication: OAuth 2.1 with automatic browser login (primary), API key auth for CI/headless (alternative)
- Device management: list, status, reserve, terminate reservation
- Session management: list, details, artifacts, terminate
- App management: list, details, upload to store, confirm to upload
- Skills: run-automation-suite to parse capabilities from local Appium scripts and execute them directly (supports Node.js, Python, .NET, Java)
