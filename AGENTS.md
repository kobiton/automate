# Kobiton Automate - Agent Guide

Cross-tool agent instructions for the Kobiton mobile testing platform's MCP plugin. This file is the host-agnostic equivalent of `skills/run-automation-suite/SKILL.md`. It's read by Gemini CLI (via `contextFileName`), GitHub Copilot CLI, and Cursor CLI. Codex CLI reads the mirrored `.codex/skills/*/SKILL.md` instead; Claude Code reads `skills/*/SKILL.md` directly.

## What this plugin does

Kobiton is a real-device mobile cloud for Android + iOS testing. This MCP plugin gives AI agents tools to:

- **Devices**: list, get status, reserve, terminate reservation
- **Apps**: list, upload, confirm upload, get parsing status, get details
- **Sessions**: list, get, get artifacts, get user-input events, terminate
- **Test management**: create / list / get / update / delete test cases, test runs, and test suites; `saveTestCase` converts a finished manual session into a reusable test case
- **Setup**: `getCredential` (used by `/automate:setup`)

The MCP server runs at `https://api.kobiton.com/mcp`. Authentication is OAuth 2.1 (default) or API key (CI/headless).

## userIntent format

Every tool call requires a `userIntent` argument summarizing what the user is trying to accomplish, a natural-language sentence is sufficient (e.g., `"reserve a Pixel 7 to run the checkout suite"`). The plugin's audit logging consumes this; include it on every tool call.

## When the user asks to run tests on Kobiton

Default workflow (mirrors the `run-automation-suite` skill):

1. **Identify the app**: ask the user whether to upload a new app build or reuse an existing one. Do NOT auto-upload without confirmation. After `confirmAppUpload`, poll `getAppParsingStatus(versionId)` until the state is terminal (`OK` or a `FAILURE_*` value). See Known limitations.
2. **Select a device**: call `listDevices` with the right platform filter. Confirm with the user before reserving.
3. **Parse capabilities**: read the local Appium test script (Node / Python / .NET / Java), extract the capabilities literal, reconcile against the selected device per the must-match / suggested-default / user-controlled policy in `skills/run-automation-suite/references/capabilities.md`.
4. **Confirm and execute**: present the summary, get user confirmation, run the script in the background, open the live-view URL.
5. **Collect artifacts**: after the session terminates, call `getSession` + `getSessionArtifacts` for video, logs, screenshots, test reports. Surface session link + pass/fail.

Detailed step-by-step instructions live in `skills/run-automation-suite/SKILL.md`. Hosts that support skills load it automatically; otherwise read the file directly for the full workflow.

## When the user asks to interactively drive a device

For exploratory testing or repro work (not running a pre-written script):

1. **Pick a device**: same `listDevices` flow as above; the user is interactively in the loop.
2. **Create or resume a session**: `reserveDevice` then start an interactive session; resume an existing one by session ID if the user has one.
3. **Interact**: relay WebDriver commands through the plugin; capture artifacts on demand.
4. **End the session**: `terminateSession` when the user is done.

Detailed step-by-step instructions live in `skills/run-interactive-cli-session/SKILL.md`. Response shapes for the WebDriver layer are documented at `skills/run-interactive-cli-session/references/response-shapes.md`.

## When the user asks to drive a device from a natural-language intent

**Pick this skill** for agent-driven flows the user describes in plain language ("open YouTube and play the first world cup video", "log in then enable Bluetooth, then go home") — it auto-pilots from observation to action without a human in the loop on each step, and the result is a saveable test case. It complements (does NOT replace) `run-interactive-cli-session`: that one is for human-driven exploration via the CLI session type; this one uses the automation session type via direct Appium HTTP. (Tool names below are the Kobiton MCP tools' bare names — the host resolves the registered prefix.)

1. **Ask before picking the device and the live view** (the skill blocks here): which device + which observation mode (foreground live view vs background run). For the device, the same `listDevices` / `reserveDevice` flow as the other skills applies.
2. **Render capabilities** via `skills/run-automation-suite/scripts/render-capabilities.js` with `--newCommandTimeout 1800` (30 min — survives human-in-the-loop pauses) and `--scriptlessCapture` (so the resulting session is consumable by `saveTestCase`).
3. **Create the automation Appium session** via the Node-only `skills/drive-automation-session/scripts/appium.js` (no package deps — uses `node:https` directly). The script reads `~/.kobiton/.credentials` (written by `/automate:setup`) directly on each invocation — credentials never pass through argv, env, or the host transcript. Returns the session ID.
4. **If the user chose foreground**, open the device-only live view URL via `skills/run-automation-suite/scripts/chromeless-launcher.sh` (Chrome `--app` window sized per device class), with the default-browser fallback table for Safari / Firefox / system default browser.
5. **Per-turn loop** — three branches per turn:
   - `screen`: capture `iter-N.xml` (stripped webview DOM or raw native source) AND `iter-N.png` by default. Compute a screen-state hash for stuck detection.
   - `act`: emit a raw Appium HTTP call (`POST /session/{id}/element`, `POST /session/{id}/actions`, `POST /session/{id}/touch/perform`, ...). Selectors come from the observed XML — never invented.
   - `control`: signal end-of-cycle with `--done` (goal reached) or `--blocked` (genuinely stuck).
6. **Cleanup**: a Bash `trap` issues `DELETE /wd/hub/session/{id}` (idempotent — 404 = success). This is the only cleanup path; it ends the session cleanly and Kobiton records it `COMPLETE`. Do NOT call `terminateSession` by default — it marks the session `TERMINATED`, treated as an abnormal exit.

The session ID is consumable by `getSession`, `getSessionArtifacts`, and `saveTestCase` exactly like a session created by `run-automation-suite`.

Detailed step-by-step instructions live in `skills/drive-automation-session/SKILL.md`. The endpoint allowlist + selector-construction guide live in `skills/drive-automation-session/references/endpoint-reference.md`; per-turn loop discipline (stuck patterns, error catalog, artifact layout) lives in `skills/drive-automation-session/references/loop-discipline.md`.

## When the user asks to save or manage test cases

The plugin exposes test-management tools covering test cases, test runs, and test suites. The most common ask is *"save the session I just ran as a reusable test case"*. For that, call `saveTestCase` with the session ID and a name. The remaining tools follow standard CRUD patterns (`createTestRun` / `listTestCases` / `getTestSuite` / `updateTestCase` / `terminateTestRun` etc.). For multi-step orchestration, ask the user to confirm before any `delete*` or `terminateTestRun` call.

## When the user asks to create / run a test run

Mirrors the `create-test-run` skill. Resolve the target (test case or suite id), fill defaults for anything unspecified, confirm a summary, then call `createTestRun`. **Use the exact enum values — upper-case, case-sensitive; lower-case is rejected:** `testSelection.type` ∈ `TEST_CASE` | `TEST_SUITE`; `deviceSelection.type` ∈ `INDIVIDUAL_DEVICES` | `DEVICE_BUNDLE`; `deviceAllocationStrategy` ∈ `CROSS_DEVICE` | `SINGLE_DEVICE`. Default to `INDIVIDUAL_DEVICES` with explicit `{ udid, isCloud }`, 1 device matching the target platform unless the user asked for more, and `CROSS_DEVICE`. After creating, offer to monitor (see below). Full workflow in `skills/create-test-run/SKILL.md`.

## When the user asks to watch / monitor a test run

Mirrors the `monitor-test-run` skill. Read `getOrgSettings` once for `live_remediation_enabled`, then **stream** the bundled poller `skills/monitor-test-run/scripts/poll-test-run.js --run-id <id>` so each emitted line re-engages you — it polls run state over REST (reads `~/.kobiton/.credentials`) and prints only on real state changes, exiting on `DONE`. **Claude Code uses its `Monitor` tool for this; other hosts must substitute their own streamed-shell / watch / loop affordance** (do NOT launch it as a silent detached background process — its stdout won't come back, which defeats the watch). On a blocker, surface the `<portal>/devices/launch?id=<deviceId>` URL (and optionally open it via `run-automation-suite`'s chromeless launcher); a flag-ON blocker is on a resolution timeout, so treat it as an open ask of the user, not a passive watch. Full workflow + the poller's line protocol in `skills/monitor-test-run/SKILL.md`.

## Known limitations

Several behaviors of the current Kobiton MCP server have known gaps that agents should plan around:

- **`confirmAppUpload` parses asynchronously**: the app record is created in state `PARSING`, and `appId` may be `null` for a brand-new upload. Poll `getAppParsingStatus(versionId)` until the state is terminal (`OK` or a `FAILURE_*` value) before reserving devices or starting sessions. It also resolves the real `appId`.
- **`reserveDevice` ambiguous conflict**: `device_unavailable` lumps 4 failure modes. Don't retry the same device; broaden the filter and pick a different device.
- **W3C `/se/log` silently breaks legacy `driver.getLogs()`**: Kobiton's Appium endpoint is W3C-strict. Warn the user if their test script uses the legacy log API.
- **`terminateSession` ~5min device cooldown**: after termination the device enters cleanup; `reserveDevice` on the same device may return `device_unavailable` for ~5min.

## Cross-host install

Plugin install paths for every supported host (listed for reference; only Gemini / Copilot / Cursor consume this `AGENTS.md` as agent context):

| Host | Install path |
|---|---|
| Claude Code | `/plugin marketplace add kobiton/automate` then `/plugin install automate@kobiton` (uses `.mcp.json` + `skills/` + `hooks/`) |
| Gemini CLI | `gemini extensions install https://github.com/kobiton/automate` (uses `gemini-extension.json` + this `AGENTS.md`) |
| Cursor CLI / IDE | `/plugin marketplace add github.com/kobiton/automate`, then install (commands surface as `/setup` + `/doctor`) |
| Codex CLI | `codex plugin marketplace add kobiton/automate`, then install from the plugin browser (Codex reads `.codex/skills/*/SKILL.md`, not this file) |
| GitHub Copilot CLI | `/plugin marketplace add kobiton/automate` then `/plugin install automate@kobiton` (uses `.mcp.json` + this `AGENTS.md`) |
| ChatGPT Apps SDK | Add `https://api.kobiton.com/mcp` in ChatGPT developer mode |
| Continue / Cline | Add to `~/.continue/config.json` or equivalent (see README) |

The `hooks/` directory ships a SessionStart hook that installs the `~/.kobiton/bin/kobiton` CLI symlink. Claude Code runs it automatically every session; Codex CLI runs it after a one-time trust via `/hooks`; hosts without SessionStart hook support run the setup command once instead (`/automate:setup`, or `/setup` on Cursor).

## Reference

- Plugin source: https://github.com/kobiton/automate
- Kobiton platform documentation: https://docs.kobiton.com
- Appium 2.x: https://appium.io
- MCP specification: https://modelcontextprotocol.io/specification/2025-06-18
