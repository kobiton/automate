# AGENTS.md — Kobiton Automate

Cross-tool agent instructions for the Kobiton mobile testing platform's MCP plugin. This file is the host-agnostic equivalent of `skills/run-automation-suite/SKILL.md` — it's read by Gemini CLI (via `contextFileName`), GitHub Copilot CLI, and Cursor CLI. (Codex CLI reads the mirrored `.codex/skills/*/SKILL.md` instead; Claude Code reads `skills/*/SKILL.md` directly.)

## What this plugin does

Kobiton is a real-device mobile cloud for Android + iOS testing. This MCP plugin gives AI agents 28 tools to:

- **Devices** (4) — list, get status, reserve, terminate reservation
- **Apps** (4) — list, upload, confirm upload, get details
- **Sessions** (5) — list, get, get artifacts, get user-input events, terminate
- **Test management** (14) — create / list / get / update / delete test cases, test runs, and test suites; `saveTestCase` converts a finished manual session into a reusable test case
- **Setup** (1) — `getCredential` (used by `/automate:setup`)

The MCP server runs at `https://api.kobiton.com/mcp`. Authentication is OAuth 2.1 (default) or API key (CI/headless).

## userIntent format

Every tool call requires a `userIntent` argument summarizing what the user is trying to accomplish — a natural-language sentence is sufficient (e.g., `"reserve a Pixel 7 to run the checkout suite"`). The plugin's audit logging consumes this; include it on every tool call.

## When the user asks to run tests on Kobiton

Default workflow (matches the `run-automation-suite` skill for Claude Code users):

1. **Identify the app** — ask the user whether to upload a new app build or reuse an existing one. Do NOT auto-upload without confirmation.
2. **Select a device** — call `listDevices` with the right platform filter. Confirm with the user before reserving.
3. **Parse capabilities** — read the local Appium test script (Node / Python / .NET / Java), extract the capabilities literal, reconcile against the selected device per the must-match / suggested-default / user-controlled policy in `skills/run-automation-suite/references/capabilities.md`.
4. **Confirm and execute** — present the summary, get user confirmation, run the script in the background, open the live-view URL.
5. **Collect artifacts** — after the session terminates, call `getSession` + `getSessionArtifacts` for video, logs, screenshots, test reports. Surface session link + pass/fail.

Detailed step-by-step instructions live in `skills/run-automation-suite/SKILL.md` — read those if you support Claude Code's skill format.

## When the user asks to interactively drive a device

For exploratory testing or repro work (not running a pre-written script):

1. **Pick a device** — same `listDevices` flow as above; the user is interactively in the loop.
2. **Create or resume a session** — `reserveDevice` then start an interactive session; resume an existing one by session ID if the user has one.
3. **Interact** — relay WebDriver commands through the plugin; capture artifacts on demand.
4. **End the session** — `terminateSession` when the user is done.

Detailed step-by-step instructions live in `skills/run-interactive-test/SKILL.md`. Response shapes for the WebDriver layer are documented at `skills/run-interactive-test/references/response-shapes.md`.

## When the user asks to save or manage test cases

The plugin exposes 14 test-management tools covering test cases, test runs, and test suites. The most common ask is *"save the session I just ran as a reusable test case"* — for that, call `saveTestCase` with the session ID and a name. The remaining tools follow standard CRUD patterns (`createTestRun` / `listTestCases` / `getTestSuite` / `updateTestCase` / `deleteTestRun` etc.). For multi-step orchestration, ask the user to confirm before any `delete*` or `terminateTestRun` call.

## Known limitations

Several behaviors of the current Kobiton MCP server have known gaps that agents should plan around:

- **`confirmAppUpload` async race** — returns 200 OK before the parser finishes. Poll `getApp(appId)` until state is `READY` or `FAILURE_PARSING` before downstream calls.
- **`reserveDevice` ambiguous conflict** — `device_unavailable` lumps 4 failure modes. Don't retry the same device; broaden the filter and pick a different device.
- **W3C `/se/log` silently breaks legacy `driver.getLogs()`** — Kobiton's Appium endpoint is W3C-strict. Warn the user if their test script uses the legacy log API.
- **`terminateSession` ~5min device cooldown** — after termination the device enters cleanup; `reserveDevice` on the same device may return `device_unavailable` for ~5min.

## Cross-host install

Plugin install paths for every supported host (listed for reference; only Gemini / Copilot / Cursor consume this `AGENTS.md` as agent context):

| Host | Install path |
|---|---|
| Claude Code | `/plugin marketplace add kobiton/automate` then `/plugin install automate@kobiton` (uses `.mcp.json` + `skills/` + `hooks/`) |
| Gemini CLI | `gemini extensions install https://github.com/kobiton/automate` (uses `gemini-extension.json` + this `AGENTS.md`) |
| Cursor CLI / IDE | `/plugin marketplace add github.com/kobiton/automate`, then install (commands surface as `/setup` + `/doctor`) |
| Codex CLI | `codex plugin marketplace add kobiton/automate`, then install from the plugin browser (Codex reads `.codex/skills/*/SKILL.md`, not this file) |
| GitHub Copilot CLI | See README install section |
| ChatGPT Apps SDK | Add `https://api.kobiton.com/mcp` in ChatGPT developer mode |
| Continue / Cline | Add to `~/.continue/config.json` or equivalent (see README) |

The `hooks/` directory is Claude Code-specific today; other hosts will ignore it.

## Reference

- Plugin source: https://github.com/kobiton/automate
- Kobiton platform documentation: https://docs.kobiton.com
- Appium 2.x: https://appium.io
- MCP specification: https://modelcontextprotocol.io/specification/2025-06-18
