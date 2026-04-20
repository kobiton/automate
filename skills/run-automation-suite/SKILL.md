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
  Bash(open:*), Bash(xdg-open:*)
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

Call `listDevices` with the relevant platform filter to show available options.

If the user has a specific device in mind, confirm its availability with `getDeviceStatus`.

Reserve the device with `reserveDevice` if needed.

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

The rendered output also includes `kobiton:aiToolName: "<host>"` so Kobiton can attribute sessions started by this skill to the calling AI workspace in adoption analytics. The host is auto-detected from runtime env markers (`CLAUDECODE=1` → Claude, `COPILOT_CLI=1` → Copilot, `GEMINI_CLI=1` → Gemini, `CODEX_THREAD_ID` → Codex). Override with `--aiToolName <name>` or set `KOBITON_AI_TOOL_NAME=<name>` to force a specific value. Pass `--aiToolName ""` to omit the capability entirely.

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

**Immediately after launching the script**, wait **2 seconds** (to allow the session to initialize on Kobiton), then open the running session in the user's browser.

**Determine the portal URL:** Read `.mcp.json` to get the MCP server URL, then map it to the portal base URL:

| MCP Server | Portal Base URL |
|------------|----------------|
| `api.kobiton.com` | `https://portal.kobiton.com` |
| `api-test-green.kobiton.com` | `https://portal-test.kobiton.com` |

**Build the launch URL:**

```
<portal-base-url>/devices/launch?id=<deviceId>
```

Where `<deviceId>` is the ID of the selected device from Step 2 (returned by `listDevices`, `getDeviceStatus`, or `reserveDevice`).

**Open the link** in the user's default browser:

| Platform | Command |
|----------|---------|
| macOS | `open <url>` |
| Linux | `xdg-open <url>` |

### 5. Open running session in browser

Ask the user:

> "Would you like me to open the running session in the browser?"

Wait for their response. If they decline, skip to Step 6.

If they agree, wait **2 seconds** after the script was launched in Step 4 (to allow the session to initialize on Kobiton), then open the session in the user's browser.

**Determine the portal URL:** Read `.mcp.json` to get the MCP server URL, then map it to the portal base URL:

| MCP Server | Portal Base URL |
|------------|----------------|
| `api.kobiton.com` | `https://portal.kobiton.com` |
| `api-test-green.kobiton.com` | `https://portal-test.kobiton.com` |

**Build the launch URL:**

```
<portal-base-url>/devices/launch?id=<deviceId>
```

Where `<deviceId>` is the ID of the selected device from Step 2 (returned by `listDevices`, `getDeviceStatus`, or `reserveDevice`).

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

After opening the browser, call `listSessions` with `deviceId=<deviceId>` (from Step 2) and `state='START'` to find the session that just triggered. Use the most recent session (first result) as the match.

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
- `reserveDevice` fails (device already taken): call `listDevices` again to find another available device.
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
