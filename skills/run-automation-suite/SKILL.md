---
name: run-automation-suite
description: >-
  Run local Appium test scripts against Kobiton devices. Guides through app
  upload, device selection, capability parsing, and local execution. Use when
  the user asks to run mobile tests, validate an APK or IPA on Kobiton
  devices, or kick off an Appium suite from a local script directory.
  Trigger with "run kobiton tests" or "execute appium on kobiton".
allowed-tools: >-
  Read, Edit,
  Bash(node:*), Bash(npm:*), Bash(npx:*), Bash(yarn:*), Bash(pnpm:*),
  Bash(python:*), Bash(python3:*), Bash(pytest:*),
  Bash(java:*), Bash(mvn:*), Bash(gradle:*), Bash(./gradlew:*),
  Bash(dotnet:*),
  Bash(ruby:*), Bash(bundle:*), Bash(rspec:*),
  Bash(open:*), Bash(xdg-open:*), Bash(sleep:*)
version: 1.0.2
author: Kobiton Inc.
license: MIT
compatibility: >-
  Compatible with any MCP-aware AI coding assistant. Requires Node.js >= 18
  and Appium 2.x. Test scripts must use Appium WebDriver protocol.
tags: [mobile, testing, appium, automation, devices, kobiton]
---

# Run Automation Suite

## Overview

Execute Appium-based mobile test automation suites on Kobiton's device cloud. Given a local Appium test script, this skill identifies the target app, selects an available device, parses and reconciles capabilities, runs the script in the background, and surfaces the resulting session URL plus artifacts (video, logs, screenshots, reports).

Use this skill when the user asks to run mobile tests, validate an APK or IPA across real devices, or trigger a Kobiton-hosted automation run from a local script directory.

## Prerequisites

Before invoking this skill, ensure:

- **Kobiton MCP connection** - the Kobiton MCP server is reachable (default `api.kobiton.com/mcp`; check `.mcp.json` for the configured endpoint).
- **Local Appium test script** - a runnable Appium WebDriver script (`.js`, `.ts`, `.py`, `.java`, `.kt`, `.cs`, `.rb`) referencing desired capabilities for the target platform.
- **Runtime installed locally** - Node.js + npm/npx, Python + pip, Java + mvn/gradle, .NET SDK, or Ruby + bundle, whichever your test script uses.
- **App build (or store reference)** - either a local `.apk` / `.ipa` / `.zip` build artifact for upload, or a `kobiton-store:vXXXXX` reference for an existing upload.
- **Kobiton account** - credentials with device access for the target platform (Android / iOS) and remaining session quota.

## Authentication

This skill calls tools served by the Kobiton MCP server at `api.kobiton.com/mcp`. Two authentication configurations ship with the plugin; one of them must be active before any MCP tool will respond:

| Config file | Auth mechanism | When to use |
|---|---|---|
| `.mcp.json` (default) | OAuth 2.1 browser flow | Interactive AI-CLI session for an end user |
| `.mcp.apikey-example.json` | Basic auth header — `Authorization: Basic base64(username:apikey)` from the `KOBITON_AUTH` env var | CI / headless / scripted invocations; copy this file over `.mcp.json` |

If the skill is invoked and no MCP connection is established, abort step 1 and surface a clear error: the user needs to authenticate the Kobiton MCP server in their AI CLI before any device or session call can succeed. The exact invocation depends on the host (e.g. `/mcp` in Claude Code, `/mcp auth kobiton` in GitHub Copilot CLI and Gemini CLI, automatic browser flow on first tool call in Codex CLI, `/mcp list` then Login in Cursor CLI — see the plugin README for current per-CLI commands). Do NOT attempt to recover by retrying — the auth context is fixed at session start.

## Instructions

### 1. Identify the app

**IMPORTANT: Always ask the user this question, even if they already provided an app file path. Do NOT skip ahead or start uploading automatically.**

Ask the user:

> "Would you like to:"
> 1. Upload a new app build
> 2. Use an existing app from Kobiton Store or a provided URL

Wait for their response before proceeding. Do not call any upload or app-related tools until the user responds.

**If uploading a new app:** Look for .apk, .ipa, .zip files in the project context, or ask the user for the file path. Upload via `uploadAppToStore` (permanent, visible in app repository). This is a three-step process: call the tool to get a pre-signed URL, upload the file via PUT, then confirm the upload.

**If reusing an existing app:** Check `appium:app` field of capabilities in the test script. Call `listApps` with that app version as keywork to check uploaded or not. Let the user pick the version to use (e.g., `kobiton-store:v72107`) if needed

### 2. Select a device

Ask the user which device or platform to target.

Call `listDevices` with the relevant platform filter to show available options. For natural-language device asks (e.g., "any Pixel on Android 14+"), delegate ranking to the `device-picker` agent and resume here with the chosen UDID.

If the user has a specific device in mind, confirm its availability with `getDeviceStatus`.

Reserve the device with `reserveDevice` if needed. If `reserveDevice` returns `device_unavailable`, exclude that UDID and re-rank: call `listDevices` again (or `device-picker` if delegating) for the next-ranked candidate. Cap at 2 retries before surfacing to the user — repeat `device_unavailable` failures on the same UDID likely indicate the post-`terminateSession` cooldown window per [`#36`](https://github.com/kobiton/automate/issues/36).

### 3. Identify script & parse capabilities

Ask the user for the path to their local Appium test script.

Detect the language and runtime from the file extension. See [references/capabilities.md](references/capabilities.md#runtime-detection) for the full extension -> runtime -> common commands lookup and the manifest-based runner selection guidance.

Read the script file and extract the [key capability fields](references/capabilities.md#capability-fields) used by Appium and Kobiton (`platformName`, `udid`, `app`, automation/browser names, vendor `kobiton:*` extensions, etc.).

Identify how the UDID is passed into the script (CLI argument, environment variable, or hardcoded) so it can be overridden with the selected device.

**Appium runtime:** Check if the script contains `'kobiton:runtime': 'appium'` or equivalent. If it does NOT, do not inject it - the default Kobiton runtime will be used. Only if the user explicitly asks to use the Appium runtime should you suggest adding `'kobiton:runtime': 'appium'` to the script's capabilities.

**Validate capabilities:** After parsing the script, run the render script to generate the correct capabilities for the selected device and app:

```
node skills/run-automation-suite/scripts/render-capabilities.js \
  --platformName <platform> \
  --udid <udid> \
  --deviceName "<deviceName>" \
  --platformVersion <version> \
  --automationName <automationName> \
  --app <app> \
  --testingType app
```

For web testing, replace `--app <app>` with `--browserName <browser> --testingType web`.

Compare the JSON output against the parsed script capabilities using the [reconciliation rules](references/capabilities.md#reconciliation-rules): must-match fields are autocorrected to the rendered values, suggested defaults require user confirmation before changing, and user-controlled capabilities are left untouched.

The rendered output also includes `kobiton:aiToolName: "<host>"` so Kobiton can attribute sessions started by this skill to the calling AI workspace in adoption analytics. Resolution order:

1. `--aiToolName <name>` CLI flag (always wins; `""` opts out entirely)
2. `KOBITON_AI_TOOL_NAME` env var (also accepts `""` to opt out)
3. Auto-detect from runtime markers, any non-empty value:
   - `CLAUDECODE` -> Claude
   - `COPILOT_CLI` -> Copilot
   - `GEMINI_CLI` -> Gemini
   - `CODEX_THREAD_ID` (or `CODEX_CLI`) -> Codex — Codex CLI sets the thread ID, not a generic `CODEX_CLI` flag; the latter is accepted for manual override only
4. If nothing matches, no `kobiton:aiToolName` capability is emitted.

This capability is treated as **must-match** during reconciliation (see `references/capabilities.md`): if the rendered output includes `kobiton:aiToolName`, always overwrite any existing value in the user's script with it. A stale value from a prior session run under a different CLI would mis-attribute adoption analytics. If the rendered output omits the capability (no runtime marker matched), leave the user's value untouched.

**The injection is non-interactive.** Edit the script silently using your `Edit` tool — mention the one-line change inline in your reply for transparency (e.g., *"Added `kobiton:aiToolName: 'Gemini'` to your capabilities for adoption analytics."*), but **do NOT ask the user to confirm** before editing. The value is deterministic (it matches the runtime env from auto-detect), there is nothing to negotiate. If the user objects, they can revert the edit themselves.

**Required: verify the injection landed before Step 4.** The `kobiton:aiToolName` capability must be present in the script's source code (e.g., the capabilities object/dict/map). If your reconciliation pass didn't write it to the script, Kobiton will never see it — there is no sidecar config that injects it at runtime. Confirm with a literal-string grep against the user's script:

```bash
grep -F 'kobiton:aiToolName' <path-to-user-script>
```

- **Match found** — injection succeeded, proceed to Step 4.
- **No match, rendered output had a value** — your edit was skipped. Use your `Edit` tool to add the capability to the script's capabilities block now (use the language-appropriate syntax for the script — JS/TS object literal, Python dict, Java `Map.of(...)` / `DesiredCapabilities`, .NET `AppiumOptions.AddAdditionalCapability(...)`, Ruby hash), then re-run the grep. **Do NOT proceed to Step 4 until the grep succeeds.**
- **No match, rendered output omitted the capability** — expected (no runtime marker matched, or user opted out via `--aiToolName ""` or `KOBITON_AI_TOOL_NAME=""`). Skip injection, proceed.

### 4. Confirm & execute

Present a summary to the user before running:

```
Language:     Node.js
Script:       /path/to/test.js
Platform:     Android
Device:       Pixel 4 (9B211FFAZ0017F)
App:          kobiton-store:v72107
Session Name: Verify Appium session
Command:      node /path/to/test.js 9B211FFAZ0017F
```

Wait for user confirmation, then execute the command **in the background** using your shell execution tool.

### 5. Open running session in browser

Ask the user:

> "Would you like me to open the running session in the browser?"

Wait for their response. If they decline, skip to Step 6.

If they agree, wait **2 seconds** after the script was launched in Step 4 (to allow the session to initialize on Kobiton), then open the session in the user's browser.

**Determine the portal URL:** Read `.mcp.json` to get the MCP server URL, then derive the portal base URL by replacing the `api` host with the `portal` equivalent (drop any trailing `/mcp`):

| MCP Server | Portal Base URL |
|------------|----------------|
| `https://api.kobiton.com/mcp` | `https://portal.kobiton.com` |
| `https://api-*.kobiton.com/mcp` | `https://portal-*.kobiton.com` (same `*` suffix) |

For example, an `api-*.kobiton.com` host maps to its matching `portal-*.kobiton.com` host. If the mapping doesn't resolve, fall back to `https://portal.kobiton.com`.

**Build the launch URL.** Default to the **device-only view** — it shows just the device screen, no surrounding Kobiton UI, ideal for watching an automation run, sharing, or embedding:

```
<portal-base-url>/devices/launch?id=<deviceId>&view=device-only
```

Where `<deviceId>` is the ID of the selected device from Step 2 (returned by `listDevices`, `getDeviceStatus`, or `reserveDevice`).

**Fall back to the default view** (without `&view=device-only`) only when the user explicitly asks to interact with the device — e.g. "let me drive it manually", "open the full session view", "I want to tap on the screen", or similar interaction-implying language. The default view shows the full Kobiton UI around the device (sidebars, controls, action panels):

```
<portal-base-url>/devices/launch?id=<deviceId>
```

**Browser preference:** Check auto memory for a saved browser preference. If none exists, ask the user which browser to use:

> "Which browser should I open the session in?"
> 1. Google Chrome
> 2. Safari
> 3. Firefox
> 4. Default browser

Save their choice to auto memory so they are not asked again in future sessions.

**Open the link:**

| Choice | Command |
|--------|---------|
| Google Chrome | `open -na "Google Chrome" --args --new-window <url>` |
| Safari | `open -a "Safari" <url>` |
| Firefox | `open -a "Firefox" <url>` |
| Default browser | `open <url>` |

On Linux, use `xdg-open <url>` (browser selection is not supported — always opens the default).

### 6. Collect results

While the background script is running, call `listSessions` with `deviceId=<deviceId>` (from Step 2) and `state='START'` to find the session that just triggered. Use the most recent session (first result) as the match.

Call `getSession` with the matched session ID to get detailed results.

Call `getSessionArtifacts` with the session ID to retrieve:

- Video recording URL
- Device logs URL
- Screenshots
- Test reports

### 7. Summarize

Present a summary to the user:

- Pass/fail status
- Session link in Kobiton portal
- Video recording link
- Key error messages (if failed)
- Execution duration

## Output

On successful completion, the skill returns:

- **Live session URL**: `https://portal.kobiton.com/devices/launch?id=<deviceId>`, opened automatically in the user's default browser as the script starts.
- **Session metadata**: session ID, device ID, app version, start time, and final pass/fail status (via `getSession`).
- **Session artifacts**: video recording URL, device logs URL, screenshots, and test reports (via `getSessionArtifacts`).
- **Execution duration**: wall-clock time from script launch to completion.

On failure, the skill surfaces error output from the test runner, the session URL if the session reached Kobiton (useful for portal-side debugging), and suggested next steps drawn from the categories in `## Error Handling`.

## Error Handling

- `listDevices` returns empty: suggest broadening filters (remove platform/group constraints) or trying again later when devices free up.
- Upload fails or times out: retry the upload. Pre-signed URLs expire after 30 minutes - if expired, call the upload tool again to get a fresh URL.
- Session stuck in a non-terminal state: poll `getSession` with a reasonable timeout. If still running, offer to call `terminateSession` and retry.
- `reserveDevice` fails (device already taken): exclude that UDID and re-rank — call `listDevices` again, or invoke `device-picker` for natural-language reselection. Cap at 2 retries before handing back to the user (see § 2 — cooldown collision per [`#36`](https://github.com/kobiton/automate/issues/36) is a common cause of repeat `device_unavailable`).
- Script execution fails: check error output for missing dependencies (e.g. `wd`, `appium`), incorrect UDID, or network issues. Suggest fixes.

## Examples

### Run a single test on the first available Android device

> "Run `./tests/checkout.js` on a Pixel 7 - upload the latest APK from `./build/app.apk` first."

The skill detects the `.apk` build, uploads it via `uploadAppToStore`, queries `listDevices` filtered to Pixel 7, reserves the device with `reserveDevice`, parses the script's capabilities, confirms the launch summary with the user, runs `node ./tests/checkout.js <udid>` in the background, opens the live session URL in the user's browser, and returns the session ID plus artifacts when the run completes.

### Run an attached IPA with an attached script on a specific iOS device

> "Test this app @TestApp.ipa by this script @automation.js on Kobiton iOS iPhone 15 Pro"

The skill resolves the two `@`-referenced files from the chat context, uploads `TestApp.ipa` via `uploadAppToStore`, queries `listDevices` filtered to iOS iPhone 15 Pro, reserves the matching device, parses `automation.js` for capabilities, reconciles them against the rendered defaults for the selected device, confirms the launch summary with the user, runs `node automation.js <udid>` in the background, opens the live session URL in the user's browser, and surfaces the session ID plus artifacts when the run completes.

## Resources

- [Kobiton available capabilities reference](https://docs.kobiton.com/automation-testing/capabilities/available-capabilities) - canonical list of `kobiton:*` and supported `appium:*` capabilities the skill's `render-capabilities` step compares against.
- [Appium 2.x documentation](https://appium.io/docs/en/2.0/) - driver-specific capability docs (UiAutomator2, XCUITest) and Appium client libraries for each runtime.
- [`kobiton/automate` plugin source](https://github.com/kobiton/automate) - issue tracker, contribution guide, and the tool YAML schemas this skill orchestrates.
- [Sample prompt patterns](../../docs/examples.md) - natural-language prompt examples organized per MCP tool, useful for crafting requests that trigger this skill cleanly.
