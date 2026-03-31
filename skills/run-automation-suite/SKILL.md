---
name: run-automation-suite
description: Run local Appium test scripts against Kobiton devices. Guides you through app upload, device selection, script capability parsing, and local execution.
---

## Workflow

### 1. Identify the app

Ask the user which app to test, or detect from the project context (look for .apk, .ipa, .zip files or build output directories).

Upload via `uploadAppToStore` (permanent, visible in app repository).

This is a three-step process: call the tool to get a pre-signed URL, upload the file via PUT, then confirm the upload.

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

Read the script file and extract key capabilities from the source code:

- `platformName` (Android / iOS)
- `udid` (hardcoded or parameterized)
- `app` (app URL or kobiton-store reference)
- `sessionName`, `sessionDescription`
- `automationName` (UiAutomator2, XCUITest, etc.)
- `browserName` (if browser-based test)
- `deviceOrientation`
- Any `kobiton:*` vendor extensions (especially `kobiton:runtime`)

Identify how the UDID is passed into the script (CLI argument, environment variable, or hardcoded) so it can be overridden with the selected device.

**Appium runtime:** Check if the script contains `'kobiton:runtime': 'appium'` or equivalent. If it does NOT, do not inject it — the default Kobiton runtime will be used. Only if the user explicitly asks to use the Appium runtime should you suggest adding `'kobiton:runtime': 'appium'` to the script's capabilities.

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

Wait for user confirmation, then execute the command via the Bash tool.

### 5. Collect results

Call `getSession` with the session ID to get detailed results.

Call `getSessionArtifacts` with the session ID to retrieve:

- Video recording URL
- Device logs URL
- Screenshots
- Test reports

### Error handling

- `listDevices` returns empty: suggest broadening filters (remove platform/group constraints) or trying again later when devices free up.
- Upload fails or times out: retry the upload. Pre-signed URLs expire after 30 minutes — if expired, call the upload tool again to get a fresh URL.
- Session stuck in a non-terminal state: poll `getSession` with a reasonable timeout. If still running, offer to call `terminateSession` and retry.
- `reserveDevice` fails (device already taken): call `listDevices` again to find another available device.
- Script execution fails: check error output for missing dependencies (e.g. `wd`, `appium`), incorrect UDID, or network issues. Suggest fixes.

### 6. Summarize

Present a summary to the user:

- Pass/fail status
- Session link in Kobiton portal
- Video recording link
- Key error messages (if failed)
- Execution duration
