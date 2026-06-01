# Changelog

## 1.4.0-dev.3 - 2026-06-01

- Bump tablet preset `820 × 1024` → **`880 × 1024`** (portrait) and `1024 × 820` → **`1024 × 880`** (landscape). Empirical macOS test against the prod iPad Pro 12.9-inch device-only view showed the 820 px width still clipped the right edge of the iPad canvas; the extra 60 px clears the canvas and leaves a small margin for the exit affordance.
- Phone preset unchanged at 520 × 1000. Fold unchanged at 580 × 1080.

## 1.4.0-dev.2 - 2026-06-01

- Widen the chromeless launcher's phone default again — `480 × 1000` → **`520 × 1000`**. Empirical macOS test on Galaxy S24 Ultra showed the 480 px width still clipped the right-side exit button against the device canvas; the extra 40 px now leaves comfortable margin around the exit affordance.
- Bump tablet preset `768 × 1024` → **`820 × 1024`** to better fit iPad Air's CSS width. Tablet landscape becomes `1024 × 820`. Fold (580×1080) is unchanged — it already accommodates the unfolded device.
- Default-size constants in all four launcher shims (`chromeless-launcher.sh` / `-mac.sh` / `-windows.ps1` / `-linux.sh`) bumped to 520×1000 to match the SKILL.md table — callers that omit `--width` / `--height` now get the new phone default.
- Sync prose: SKILL.md device-class table + spec.md AC scenarios + TC docs all updated to the new dimensions.

## 1.4.0-dev.1 - 2026-06-01

- Widen the chromeless launcher's phone default from `420×920` → **`520×1000`** so the device-only view's right-side exit button is fully visible without overlapping the device canvas. Empirically verified on Galaxy S24 Ultra (2026-06-01); the prior 420 px width clipped the exit button by ~100 px on phones with wider physical aspect ratios.
- Add a **device-class sizing heuristic** to `SKILL.md` Step 5. The skill now picks launcher dimensions from the resolved device name (case-insensitive match): tablet (`iPad`, `Galaxy Tab`, `Pixel Tablet`, `Surface`, `MatePad`, names containing `Tab` or `Pad`) → `880×1024`; fold (`Fold`, `Z Fold`, `Pixel Fold`) → `580×1080`; phone (default) → `520×1000`. Landscape orientation swaps width and height. This stops tablets from rendering in a phone-shaped window with most of the canvas cropped.
- The MCP `listDevices` / `getDeviceStatus` schemas do **not** expose a resolution field today (only `device_name`, `platform`, `platform_version`, `is_online`, `is_booked`); the heuristic above is a name-pattern proxy. A follow-up could add `screen_width` / `screen_height` to the API responses and have the skill use them when present — out of scope for this EPA.
- Updated TC suite: TC-01 through TC-14 have their `420×920` references updated to `520×1000` (and `920×420` → `1000×520` for landscape). Added TC-16 (tablet → 880×1024) and TC-17 (fold → 580×1080) to exercise the new heuristic. Coverage checklist expanded.

## 1.4.0-dev.0 - 2026-06-01

- New **chromeless launcher** for `run-automation-suite` Step 5: when the skill resolves the device-only view URL and the user's saved browser preference is Google Chrome (or no preference is saved), launch Chrome in `--app` window mode (no tab strip, no URL bar, no bookmarks bar) and resize the window to a phone-shaped frame at runtime. Per-OS shims:
  - **macOS:** `osascript` resize loop with 10s poll, URL-substring window match, per-window `try`/`on error` so a stray DevTools window doesn't abort the iteration. Requires a one-time **Automation** grant for the host process to control Google Chrome (System Settings → Privacy & Security → Automation — NOT Accessibility). Macos error `-1743` (Automation denied) is fail-open: window opens at default size, warning logged, skill continues.
  - **Windows:** PowerShell + `Add-Type` `SetWindowPos`; matches the new chromeless window via a snapshot-before / diff-after over all visible top-level Chrome windows (works whether Chrome was already running and `chrome.exe --app=` delegated to it, or started fresh).
  - **Linux:** launches Chrome `--app` + `--window-size` hint; no runtime resize (no portable cross-WM hook). Honored by Mutter, ignored by tiling WMs.
- Falls back gracefully: if Chrome / Chromium is not installed (exit code `2` from the launcher), or the URL branch is the manual-interaction form (no `?view=device-only`), or the user has explicitly saved Safari / Firefox / Default browser as their preference, the existing browser-preference open path is used instead (`open -a "Safari" <url>`, `xdg-open <url>`, etc.). Chrome is never spawned in those branches; no macOS Automation prompt appears.
- URL validation rejects bash-quoting-breaking metacharacters (`"`, backtick, `$`, `\`) and non-`http(s)` schemes at every launcher entry point. URL-syntax characters (`&`, `?`, `=`, `;`, `|`, `<`, `>`, single-quote) are accepted — Kobiton portal URLs need `&` between query params.
- `SKILL.md` Step 5 restructured: launcher invocation is the first action on the device-only branch when the gate allows; the existing "Which browser should I open the session in?" prompt + `open` / `xdg-open` table become the fallback path.
- `allowed-tools` extended to include `Bash(bash:*)`, `Bash(pwsh:*)`, `Bash(osascript:*)` (needed by the launcher shim invocations).
- 32 new vitest cases in `skills/run-automation-suite/scripts/chromeless-launcher.test.js` covering arg parsing, exit-code sentinels (`64` usage / `2` Chrome-absent fallback / `0` fail-open), URL metacharacter rejection, and positive-path acceptance for real `?id=…&view=device-only` URLs.
- `scripts/sync-version.js`: small drive-by fix — the CHANGELOG regex `(\d+\.\d+\.\d+)\b` over-matched `1.4.0` against `1.4.0-dev.0`, tripping the CI gate on every dev-version cut. Now accepts SemVer 2.0 pre-release suffixes. Regression test added.

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
