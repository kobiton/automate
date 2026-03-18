---
name: run-automation-suite
description: Run automation tests against Kobiton devices. Guides you through app upload, device selection, and choosing between native sessions or Appium WebDriver sessions.
---

## Workflow

### 1. Identify the app

Ask the user which app to test, or detect from the project context (look for .apk, .ipa, .zip files or build output directories).

Call `listApps` to check if a matching build already exists on Kobiton.

If no build exists, choose the upload path:
- **Portal app** (permanent, visible in app repository) -> `uploadAppToStore`
- **Quick test run** (ephemeral, for automation only) -> `uploadAppForRunner`

Both are two-step: call the tool to get a pre-signed URL, then upload the file via PUT.

### 2. Select a device

Ask the user which device or platform to target.

Call `listDevices` with the relevant platform filter to show available options.

If the user has a specific device in mind, confirm its availability with `getDeviceStatus`.

Reserve the device with `reserveDevice` if needed.

### 3. Choose session type

Ask the user which session type to use (if not already clear from context):

- **Native session** (`startNativeSession`) — Server-managed execution via POST /v2/sessions/native. Best for CI/CD pipelines and server-side test frameworks (UIAUTOMATOR, XCUITEST, XIUM, APPIUM, GAMEDRIVER).
- **Appium WebDriver session** (`startAppiumSession`) — Standard Appium via POST /wd/hub/session. Best for running local Appium scripts or when the agent needs to generate and execute test code.

### 4. Execute

**If native session:**

Call `startNativeSession` with:
- `testFramework` (required)
- `app` or `testRunner` (from upload step)
- Device targeting: `udid`, `deviceName`, `deviceGroup`, `deviceTags`
- Session config: `sessionName`, `noReset`, `fullReset`, timeouts

**If Appium WebDriver session:**

Call `startAppiumSession` with:
- `desiredCapabilities` (legacy format) or `capabilities` (W3C `{alwaysMatch, firstMatch}`)
- Common capabilities: `sessionName`, `deviceName`, `platformName`, `platformVersion`, `udid`, `app`, `automationName`, `deviceGroup`
- Kobiton extensions: `kobiton:visualValidation`, `kobiton:flexCorrect`, `kobiton:scriptlessEnable`, etc.

Then either:
- **No script**: The tool returns `hubUrl`, `sessionId`, `credentials`, and `capabilities`. The agent writes and executes an Appium test script using these.
- **With script**: Pass `scriptPath` to a local .js test file. The agent injects the hub URL and capabilities (not credentials) and executes it. The tool returns `scriptOutput` and `exitCode`.

### 5. Monitor (native session)

If using `startNativeSession`, poll `getSession` with the returned session ID until the session state is COMPLETE or TERMINATED.

### 6. Collect results

Call `getSession` with the session ID to get detailed results.

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
