# Kobiton Automate - Agent Guide

Cross-tool agent instructions for the Kobiton mobile testing platform's MCP plugin. This file is the host-agnostic equivalent of `skills/run-automation-suite/SKILL.md`. It's read by Gemini CLI (via `contextFileName`), GitHub Copilot CLI, and Cursor CLI. Codex CLI reads the mirrored `.codex/skills/*/SKILL.md` instead; Claude Code reads `skills/*/SKILL.md` directly.

## What this plugin does

Kobiton is a real-device mobile cloud for Android + iOS testing. This MCP plugin gives AI agents tools to:

- **Devices**: list, get status, reserve, terminate reservation
- **Apps**: list, upload, confirm upload, get parsing status, get details
- **Sessions**: list, get, get artifacts, get user-input events, terminate
- **Test management**: create / list / get / update / delete test cases, test runs, and test suites; `saveTestCase` converts a finished manual session into a reusable test case
- **Account**: `getCredential` (used by `/automate:setup`); `getOrgSettings` for org-level feature flags such as live remediation

The MCP server runs at `https://api.kobiton.com/mcp`. Authentication is OAuth 2.1 (default) or API key (CI/headless).

## userIntent format

Every tool call requires a `userIntent` argument summarizing what the user is trying to accomplish, a natural-language sentence is sufficient (e.g., `"reserve a Pixel 7 to run the checkout suite"`). The plugin's audit logging consumes this; include it on every tool call.

## Getting started (new users)

The full journey a first-time user takes: `/automate:setup` (credentials) → `listDevices` / `reserveDevice` → drive the device with one skill (routing table below) → `saveTestCase` on the finished session → optionally `createTestRun` + monitor. Frame the skills as steps of that one flow, not a menu.

Route by intent:

| The user wants… | Use |
|---|---|
| to run local Appium scripts (Node.js/Python/.NET/Java) on Kobiton devices | `run-automation-suite` |
| a clean hands-off run of a described flow, saveable as a test case | `drive-automation-session` |
| quick inspection / troubleshooting — poke at a device, pull logs, push files | `run-interactive-session` |
| to kick off a test run from a test case or suite | `create-test-run` |
| to watch a running test run and catch blockers | `monitor-test-run` |

Vocabulary: **session** = one recorded device connection (commands, video, logs under a session id); **test case** = saved replayable steps, usually created from a session; **test run** = execution of a case/suite across devices with per-device results; **test suite** = ordered collection of cases; **reservation** = exclusive device hold; **device UDID** = unique device identifier; **live remediation** = browser takeover to fix a blocked test-run execution mid-run.

### Routing ambiguous prompts

A prompt like *"test the login screen of app ABC"* names a goal but not a method — three skills could serve it, with different outcomes. Check for routing signals first:

| Signal in the prompt | Route |
|---|---|
| Local test scripts/files mentioned (`.js`/`.py`/`.cs`/`.java`, "my Appium tests") | `run-automation-suite` |
| A flow described in plain language; wants it repeatable ("save", "rerun later", "as a test case") | `drive-automation-session` |
| Hands-on/diagnostic verbs: explore, poke, inspect, debug, adb, logs, push/pull a file | `run-interactive-session` |
| Names an existing test case or suite to execute | `create-test-run` |
| A run is already in flight ("watch", "follow", "track") | `monitor-test-run` |

If no signal decides it, ask ONE short question — *"Run your own test scripts, have me drive the flow (saveable as a test case), or explore the device hands-on?"* — and recommend `drive-automation-session` as the default: it works from a plain-language goal on any platform, and its session can be saved with `saveTestCase`, so nothing is lost if the user later wants to rerun. Do not silently route a "test X" goal to `run-interactive-session` — CLI sessions don't feed `saveTestCase` (see the session model below), so that choice quietly forfeits the saveable-test-case outcome.

### Intent synonyms

Users say the same thing many ways; route by what the phrase means, not the keyword:

| The user says… | They mean | Route |
|---|---|---|
| "rerun / run again / revisit / replay **this test case** (on other devices)" | execute the saved steps as a new test run | `create-test-run` |
| "rerun **this session**" | sessions aren't rerun directly — save it as a test case, then run that | `saveTestCase` → `create-test-run` |
| "replay / review **the session recording**" | watch what happened, not execute again | `getSessionArtifacts` / the session's portal page |
| "watch / follow / track the run" | live progress + blockers | `monitor-test-run` |
| "explore / poke around / grab logs / adb / push a file" | hands-on device access | `run-interactive-session` |
| "test the X flow / log in and do Y" | agent-driven flow | `drive-automation-session` |
| "run my (Appium) tests / scripts" | execute local scripts | `run-automation-suite` |

### Kobiton session model (background the routing relies on)

- **Everything on a device happens inside a session, and every session has a type**: `AUTOMATION` (script- or agent-driven Appium), `CLI` (the bundled CLI wrapper), `MANUAL` (a human driving the portal live view). If a human opens the live view and interacts while an automation session runs, the session becomes `MIXED` — human gestures and script commands interleave on the same recording (see the device-only-view note in `skills/run-automation-suite/SKILL.md`).
- **Test cases are session-based**: a test case is created FROM a completed session's recorded steps via `saveTestCase`. Only automation sessions opened with `kobiton:scriptlessCapture` record saveable steps, and only actions on allowlisted endpoints are captured (`skills/drive-automation-session/references/endpoint-reference.md`); CLI sessions don't feed `saveTestCase`.
- **A test run re-executes (revisits) a test case's steps** on the devices you choose — the platform models each per-device execution as a revisit execution (`getTestRun.revisit_executions[]`). "Rerun on 3 devices" = one test run, three executions.
- **Session end state matters**: ending an automation session cleanly (`DELETE /wd/hub/session/{id}`) records it `COMPLETE`, which `saveTestCase` expects; `terminateSession` marks it `TERMINATED` (abnormal exit). Prefer the clean path when a test case might be saved later.
- **Live remediation depends on the org flag**: with live remediation ON, a blocked revisit execution **pauses** (`BLOCKED_WAITING`) so a human can take over the device in the portal and fix the step live — the execution then resumes within the **same** run. With the flag OFF, the blocker fails the execution and a resolution submitted in the portal applies on the **next** rerun (details in `skills/monitor-test-run/SKILL.md`).

Prerequisites: Kobiton account, credentials via the setup command, supported host. The `run-interactive-session` skill's bundled CLI runs on macOS only — it is an x86_64 binary (native on Intel Macs, Rosetta 2 on Apple Silicon) — so on Linux and Windows route the user to `run-automation-suite` or `drive-automation-session` instead of dead-ending. See the Skill compatibility matrix under Known limitations for the full per-skill picture. A worked end-to-end example lives in README's Getting Started section.

## When the user asks to run tests on Kobiton

Default workflow (mirrors the `run-automation-suite` skill):

1. **Identify the app**: ask the user whether to upload a new app build or reuse an existing one. Do NOT auto-upload without confirmation. After `confirmAppUpload`, poll `getAppParsingStatus(versionId)` until the state is terminal (`OK` or a `FAILURE_*` value). See Known limitations.
2. **Select a device and ask how to observe**: call `listDevices` with the right platform filter. Confirm with the user before reserving, and in the same exchange ask whether to open the device live view in a browser window or run in the background — ask this up front with the device, not after the script is already running. Skip the question if the user's request already made the preference clear.
3. **Parse capabilities**: read the local Appium test script (Node / Python / .NET / Java), extract the capabilities literal, reconcile against the selected device per the must-match / suggested-default / user-controlled policy in `skills/run-automation-suite/references/capabilities.md`.
4. **Confirm and execute**: present the summary, get user confirmation, run the script in the background, then act on the step-2 observation choice — open the live-view URL only if the user asked to watch; otherwise leave it running silently.
5. **Collect artifacts**: after the session terminates, call `getSession` + `getSessionArtifacts` for video, logs, screenshots, test reports. Surface session link + pass/fail.

Detailed step-by-step instructions live in `skills/run-automation-suite/SKILL.md`. Hosts that support skills load it automatically; otherwise read the file directly for the full workflow.

## When the user asks to interactively drive a device

For exploratory testing or repro work (not running a pre-written script):

1. **Pick a device**: same `listDevices` flow as above; the user is interactively in the loop.
2. **Create or resume a session**: `reserveDevice` then start an interactive session; resume an existing one by session ID if the user has one.
3. **Interact**: relay WebDriver commands through the plugin; capture artifacts on demand.
4. **End the session**: `terminateSession` when the user is done.

Detailed step-by-step instructions live in `skills/run-interactive-session/SKILL.md`. Response shapes for the WebDriver layer are documented at `skills/run-interactive-session/references/response-shapes.md`.

## When the user asks to drive a device from a natural-language intent

**Pick this skill** for agent-driven flows the user describes in plain language ("open YouTube and play the first world cup video", "log in then enable Bluetooth, then go home") — it auto-pilots from observation to action without a human in the loop on each step, and the result is a saveable test case. It complements (does NOT replace) `run-interactive-session`: that one is for human-driven exploration via the CLI session type; this one uses the automation session type via direct Appium HTTP. (Tool names below are the Kobiton MCP tools' bare names — the host resolves the registered prefix.)

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

### Which skills run where

Not every skill runs everywhere — check before invoking one, so you don't start a workflow the
environment can't finish. Judge by **capability, not by product name**: "has a filesystem" is not the
same as "can run this skill", because a chat surface with code execution still has no way to run
`/automate:setup` and write `~/.kobiton/.credentials`.

- **`create-test-run`** needs only an authenticated MCP connection — no local filesystem, no
  credentials file, no binary. It is the only such skill, so it is the only one usable where the host
  supplies nothing else (a chat surface, or the MCP-only entries at the bottom of the Cross-host
  install table below). Its monitoring hand-off does need a local poller, so where that's unavailable,
  create the run and report its id rather than offering to watch it.
- **`drive-automation-session`** and **`monitor-test-run`** each need a persistent local filesystem
  **and** `~/.kobiton/.credentials` — their bundled scripts read that file directly and never call MCP
  `getCredential`, so an authenticated MCP connection alone is not enough.
- **`monitor-test-run`** also wants a way to stream a background command's output (Claude Code's
  `Monitor`, or the host's own streamed shell / watch / loop). This one is preferred, not required — a
  host with none falls back to a foreground loop rather than refusing; see that skill's Step 2 host table.
- **`run-automation-suite`** needs a local filesystem plus the user's own Appium script and its language
  runtime — but **not** the credentials file: the user's script carries its own Kobiton credentials in
  its capabilities / hub URL.
- **`run-interactive-session`** additionally requires **macOS**: its bundled `bin/kobiton` is a
  single-slice x86_64 Mach-O — native on Intel Macs, Rosetta 2 on Apple Silicon, with no Linux or
  Windows build. Route those users to `run-automation-suite` or `drive-automation-session`.

When a capability is missing, name the **specific** missing one and the alternative — "needs the
credentials file `/automate:setup` writes" tells the user what to do next; "needs a CLI host" does not.
Each skill's own `## Prerequisites` states its requirements; the full per-skill matrix lives in
[`CLAUDE.md`](CLAUDE.md#skill-compatibility-matrix) — kept in one place so the two can't drift apart.

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
