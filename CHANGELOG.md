# Changelog

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
- Updated bundled `kobiton` CLI binary in `run-interactive-test` skill to the latest version
- Expanded `run-interactive-test` adb-shell documentation for AI agents: quoting rules (local vs device shell parsing), platform guard (Android only), 22-row intent-to-command cookbook, big-output redirect pattern (to avoid 25k-token MCP overflow), long-running command guidance, and response parsing gotchas in `references/response-shapes.md` — notably that `adb` returns exit code 0 even when the inner command fails

## 1.2.1 - 2026-05-20

- `run-automation-suite` skill now defaults to the **device-only view URL** (`?view=device-only`) when surfacing the live session link, hiding the surrounding Kobiton UI for a cleaner watch-the-test experience. Falls back to the default-view URL only when the user explicitly asks to interact with the device.
- Portal URL mapping in the skill is now derivation-based (`api*.kobiton.com` → `portal*.kobiton.com`) instead of a hard-coded per-env table.


## 1.2.0 - 2026-05-18

- Multi-CLI support: install on GitHub Copilot CLI, Gemini CLI, and Codex CLI in addition to Claude Code
- New `run-interactive-test` skill — natural-language WebDriver/device/file commands powered by the bundled `kobiton` CLI wrapper (macOS Apple Silicon binary included)
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
