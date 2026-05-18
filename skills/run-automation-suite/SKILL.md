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
author: Kobiton Inc. <support@kobiton.com>
license: MIT
tags: [mobile, testing, appium, automation, devices, kobiton]
compatibility: "Designed for Claude Code; requires Node.js >= 20 and Appium 2.x for local script execution."
allowed-tools: "Read, Write, Edit, Bash(node:*), Bash(python:*), Bash(dotnet:*), Bash(mvn:*), Bash(java:*), Bash(open:*), Bash(xdg-open:*), Bash(sleep:*)"
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

## Authentication

This skill calls tools served by the Kobiton MCP server at `api.kobiton.com/mcp`. Three authentication configurations ship with the plugin; one of them must be active before any MCP tool will respond:

| Config file | Auth mechanism | When to use |
|---|---|---|
| `.mcp.json` (default) | OAuth 2.1 browser flow | Interactive Claude Code session for an end user |
| `.mcp.apikey-example.json` | Basic auth header — `Authorization: Basic base64(username:apikey)` from the `KOBITON_AUTH` env var | CI / headless / scripted invocations; copy this file over `.mcp.json` |
| `.mcp.dev-local.json` | Direct connection to `localhost:3000/mcp` | Kobiton internal development against a local MCP server build |

If the skill is invoked and no MCP connection is established, abort step 1 and surface a clear error: the user needs to authenticate via `claude mcp` before any device or session call can succeed. Do NOT attempt to recover by retrying — the auth context is fixed at session start.

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

The following are demonstration scenarios drawn from the workflow's currently-supported branches. Each one maps to a documented Step in the workflow above. Adjust the specific apps, devices, and prompt phrasing to whatever Kobiton's customers most often ask for.

### Run an Android suite on the first available matching device

> "Run the test scripts in `./tests/checkout/` on a Pixel 7 if available, otherwise any Android device with API 33 or higher."

The skill identifies the test directory, queries `listDevices` filtered to Android API 33+ (preferring Pixel 7), reserves the device, parses capabilities from the test config, executes the suite via the Bash tool in the background, opens the live session in the user's browser, and returns the Kobiton portal session URL with collected artifacts (video, logs, screenshots, reports).

### Reuse an existing app build on a specific device + version

> "Use the app at `kobiton-store:v72107` and run my login tests on a Galaxy S22 with Android 13."

The skill takes the existing-app branch in Step 1 (no upload), confirms the requested device is available via `getDeviceStatus`, reserves it via `reserveDevice`, parses the user's login tests, executes, and returns the session summary on completion.

### Run a browser-based web test instead of a native app

> "Run my Selenium tests in `./tests/web/` against Chrome on a recent Android device."

The skill renders capabilities with `--browserName chrome --testingType web` (the `web` branch of Step 3) instead of `--app`, parses the script as a browser-based test, and collects the same artifact set on completion.

## Resources

The links below cover the canonical Kobiton and Appium surfaces relevant to this skill. Kobiton-side, the team should refine specific deep-link URLs (e.g., the Kobiton capability builder's exact docs path) to whatever the platform team currently considers authoritative.

- [Kobiton platform overview](https://kobiton.com) — the device cloud the skill targets; account signup
- [Kobiton documentation](https://docs.kobiton.com) — Kobiton-side reference for desired capabilities, vendor extensions, and platform behavior
- [Appium official documentation](https://appium.io) — Appium project reference, including driver-specific capabilities and the Appium 2.x driver model
- [Plugin source on GitHub](https://github.com/kobiton/automate) — issues, contributions, releases
- [Sample prompt examples](https://github.com/kobiton/automate/blob/main/docs/examples.md) — one natural-language prompt example per tool, maintained alongside the plugin

### Related skills

<!-- Cross-link other Kobiton-published skills here as they ship. -->

## Known Limitations

The full set of documented behavioural gaps in the Kobiton MCP surface — and the recommended agent workaround for each — lives in [`references/known-limitations.md`](references/known-limitations.md). Consult that file when a tool call returns an unexpected result and the symptom matches one of the categories below:

- App upload state ambiguity, async parser races, or empty `FAILURE_PARSING` bodies
- `reserveDevice` conflict ambiguity, post-`terminateSession` cooldown windows
- W3C-strict Appium endpoint silently rejecting legacy `driver.getLogs()` calls
- Per-command session data, screenshots, or assertion semantics not surfacing from any tool
- Read-side field-naming divergence between `getSession` and `getSessionArtifacts`
- `listSessions` 25k-token response cap, or a returned session count that doesn't match the requested `limit`
- `getSession.video_url` null where video may exist; missing `has_video` indicator
- `getSessionArtifacts` missing the documented `screenshots` category
- `getDeviceStatus` returning only 3 fields when richer detail (battery, current session, network state) was expected
- `getApp.is_expired` and `listApps.is_expired` disagreeing for the same app id
- `uploadAppToStore` confirm-upload response carrying contradictory v1/v2 path strings

Each entry in `references/known-limitations.md` carries: the upstream issue link, the symptom in plain language, severity for plugin DX, and the documented agent workaround. Reference rather than recite when the symptom matches.
