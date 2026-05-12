---
name: run-automation-suite
description: >-
  Run local Appium test scripts against Kobiton devices — guides you through
  app upload, device selection, capability parsing, and local execution.
  Use when the user asks to run mobile tests on Kobiton, validate an APK or
  IPA on real devices, or kick off a Kobiton automation run from a local
  script directory. Trigger with "run kobiton tests" or "execute on kobiton
  devices".
version: 1.0.2
author: Kobiton Inc.
license: MIT
tags: [mobile, testing, appium, automation, devices, kobiton]
compatibility: "Designed for Claude Code; requires Node.js >= 18 and Appium 2.x for local script execution."
allowed-tools: "Read, Write, Edit, Bash(node:*), Bash(python:*), Bash(dotnet:*), Bash(mvn:*), Bash(java:*), Bash(open:*), Bash(xdg-open:*)"
---

# Run Automation Suite

## Overview

Execute Appium-based mobile test automation suites on Kobiton's device cloud. Given a directory of local test scripts, identify the target app, select an available device, parse and reconcile capabilities, run the suite, and surface results back to the user with session links and artifacts.

Use this skill when the user asks to run mobile tests on Kobiton, validate an APK or IPA on real devices, or trigger a Kobiton-hosted automation run from a local script directory.

## Prerequisites

Before beginning the workflow, confirm:

- A Kobiton MCP server connection is configured (one of `.mcp.json`, `.mcp.apikey-example.json`, or `.mcp.dev-local.json`).
- The user has a directory of Appium test scripts (`.js`, `.py`, `.cs` / `.csproj`, or `.java`) ready to execute.
- The render-capabilities helper at `skills/run-automation-suite/scripts/render-capabilities.js` is reachable from the working directory.

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

Detect the language and runtime from the file extension:

| Extension | Runtime | Command |
|-----------|---------|---------|
| `.js` | Node.js | `node <script> <udid>` |
| `.py` | Python | `python <script> <udid>` |
| `.cs` / `.csproj` | .NET | `dotnet test` |
| `.java` | Java | `mvn test` or `java -cp ...` |

Read the script file and extract key capabilities from the source code. The full field list, the Appium-runtime opt-in special case, and the per-field comparison policy live in [`references/capabilities.md`](references/capabilities.md).

Identify how the UDID is passed into the script (CLI argument, environment variable, or hardcoded) so it can be overridden with the selected device.

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

Apply the per-field comparison policy from [`references/capabilities.md`](references/capabilities.md) to reconcile the rendered output against the parsed script capabilities (must-match → auto-edit, suggested-default → ask, user-controlled → leave untouched).

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

Wait for user confirmation, then execute the command via the Bash tool **in the background** (use `run_in_background: true`).

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

## Output

After the test executes, collect session artifacts and summarize the run for the user.

### Collect session artifacts

After opening the browser, call `listSessions` with `deviceId=<deviceId>` (from Step 2) and `state='START'` to find the session that just triggered. Use the most recent session (first result) as the match.

Call `getSession` with the matched session ID to get detailed results.

Call `getSessionArtifacts` with the session ID to retrieve:

- Video recording URL
- Device logs URL
- Screenshots
- Test reports

### Summarize

Present a summary to the user:

- Pass/fail status
- Session link in Kobiton portal
- Video recording link
- Key error messages (if failed)
- Execution duration

## Error Handling

- `listDevices` returns empty: suggest broadening filters (remove platform/group constraints) or trying again later when devices free up.
- Upload fails or times out: retry the upload. Pre-signed URLs expire after 30 minutes — if expired, call the upload tool again to get a fresh URL.
- Session stuck in a non-terminal state: poll `getSession` with a reasonable timeout. If still running, offer to call `terminateSession` and retry.
- `reserveDevice` fails (device already taken): call `listDevices` again to find another available device.
- Script execution fails: check error output for missing dependencies (e.g. `wd`, `appium`), incorrect UDID, or network issues. Suggest fixes.

## Examples

<!-- Worked end-to-end examples are addressed in a separate PR (closes fork #6 / upstream kobiton/automate#15). -->

## Resources

<!-- Curated reference links are addressed in a separate PR (closes fork #8 / upstream kobiton/automate#14). -->
