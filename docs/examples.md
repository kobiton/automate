# Kobiton MCP Tools — Examples

A guide to every tool available in the Kobiton MCP server, organized by domain. Each tool includes a description and natural-language prompt examples you can use directly in Claude Code.

---

## Table of Contents

| # | Domain | Tools |
|---|--------|-------|
| 1 | [Device Management](#1-device-management) | `listDevices`, `getDeviceStatus`, `reserveDevice`, `terminateReservation`, `listDeviceBundles` |
| 2 | [Session Management](#2-session-management) | `startAppiumSession`, `startNativeSession`, `listSessions`, `getSession`, `getSessionArtifacts`, `terminateSession` |
| 3 | [App Management](#3-app-management) | `listApps`, `getApp`, `uploadAppToStore`, `uploadAppForRunner` |
| 4 | [Scriptless Testing](#4-scriptless-testing) | `listTestCases`, `getTestCase`, `listTestSuites`, `getTestSuite`, `createTestRun`, `listTestRuns`, `getTestRun`, `terminateTestRun` |

---

## 1. Device Management

### `listDevices`

List available devices filtered by platform, availability, device group, name, or UDID. Returns device name, UDID, platform, OS version, and availability.

**Prompt examples:**

> "Show me all available Android devices"

> "List available iPhones in the cloud device group"

> "Find any Pixel devices in my private group"

> "Check if the device with UDID R58M20D1ELE is available"

---

### `getDeviceStatus`

Get real-time status of a specific device including availability, current session info, battery level, and connection state.

**Prompt examples:**

> "What is the status of device 1234?"

> "Is device 5678 currently in use?"

---

### `reserveDevice`

Reserve a device for exclusive use during testing. Prevents other users from starting sessions on the device. Use the UDID from `listDevices`.

**Prompt examples:**

> "Reserve the Galaxy S20 with UDID R58M20D1ELE for 60 minutes"

> "Lock device 19031FDF6003LP for me for 30 minutes"

---

### `terminateReservation`

Release a reserved device by terminating its reservation.

**Prompt examples:**

> "Release reservation 4521"

> "I'm done with my reserved device, terminate reservation 4521"

---

### `listDeviceBundles`

List device bundles for matrix testing. A bundle is a predefined group of devices for running test suites across multiple device/OS combinations.

**Prompt examples:**

> "Show me all Android device bundles"

> "List iOS device bundles available for matrix testing"

---

## 2. Session Management

### `startAppiumSession`

Start an Appium WebDriver session on Kobiton. Supports both legacy `desiredCapabilities` and W3C `capabilities` format. Optionally provide a `scriptPath` to a local `.js` test script — the agent injects hub URL and capabilities, then executes it.

**Prompt examples:**

> "Start an Appium session on a Galaxy S20 running Android 13 with the app kobiton-store:v3"

> "Run the test script at resources/auto/testappandroid.js on an Android device"

> "Start an Appium session on an iPhone with Safari browser using W3C capabilities"

> "Start an Appium session with useAppium true so it uses the Appium runtime"

---

### `startNativeSession`

Start a Kobiton native automation session. The server manages test execution end-to-end. Use `getSession` to poll for status.

**Prompt examples:**

> "Run my UIAutomator tests on device 19031FDF6003LP with the test runner I just uploaded"

> "Start a native XCUITest session on an iOS device using app kobiton-store:v71286"

> "Upload resources/apps/app.jar.zip as a test runner, then start a native session with 'mvn test' on a Galaxy S20"

---

### `listSessions`

List test sessions with filters. Returns session ID, status, device info, duration, and timestamps.

**Prompt examples:**

> "Show me all running sessions"

> "List my last 5 failed iOS sessions"

> "Show sessions running on Pixel devices"

---

### `getSession`

Get detailed info about a specific session including commands executed, device info, desired capabilities, and test results.

**Prompt examples:**

> "Get details for session 12345"

> "What device and capabilities were used in session 502?"

---

### `getSessionArtifacts`

Get download URLs for session artifacts: video recording, device logs, screenshots, and test reports.

**Prompt examples:**

> "Download the video and logs from session 12345"

> "Get the test report artifacts for session 502"

---

### `terminateSession`

Stop a running test session before it completes naturally.

**Prompt examples:**

> "Stop session 12345, it's been running too long"

> "Terminate my running session 6789"

---

## 3. App Management

### `listApps`

List uploaded app builds for the current organization. Returns app ID, name, version, platform, upload date, and status.

**Prompt examples:**

> "Show me all uploaded Android apps"

> "List my iOS apps in the Kobiton store"

---

### `getApp`

Get detailed info about an app including name, platform, state, and optionally all version history.

**Prompt examples:**

> "Get details for app 42"

> "Show me all versions of app 42"

---

### `uploadAppToStore`

Upload an app to Kobiton Store for permanent storage. The app appears in the portal's app repository. **Two-step process**: this tool returns a pre-signed URL, then the file must be uploaded to that URL.

**Prompt examples:**

> "Upload resources/apps/GS.apk to the Kobiton app store as an Android app"

> "Upload resources/apps/LeaderboardApp.ipa to the store for iOS"

---

### `uploadAppForRunner`

Upload an app to S3 for test runner consumption. Not visible in the portal. **Two-step process**: returns a pre-signed URL and `test_runner_id`, then the file must be uploaded. Use the returned path when starting native sessions.

**Prompt examples:**

> "Upload resources/apps/app.jar.zip as a test runner"

> "Prepare my test APK for a native automation session"

---

## 4. Scriptless Testing

### `listTestCases`

List scriptless test cases with pagination and search. Test cases are recorded from manual sessions and can be replayed via test runs.

**Prompt examples:**

> "List all my scriptless test cases"

> "Search for test cases with keyword 'login'"

> "Show Android test cases, page 2"

---

### `getTestCase`

Get details of a scriptless test case including test steps, app data, and device capabilities from the original recording.

**Prompt examples:**

> "Show me the steps for test case TC-001"

> "Get version 3 of test case TC-001 with app data"

---

### `listTestSuites`

List test suites. A suite groups related test cases for batch execution.

**Prompt examples:**

> "List all test suites"

> "Find test suites with 'regression' in the name"

---

### `getTestSuite`

Get test suite details including its test cases and recent test run history.

**Prompt examples:**

> "Show me test suite TS-100 and its test cases"

> "Get details of test suite TS-100 with app data"

---

### `createTestRun`

Start a scriptless test run. Replays recorded test cases on selected devices. Requires test selection (suite or individual cases) and device selection (bundle or specific devices).

**Prompt examples:**

> "Run test suite TS-100 on device bundle 5"

> "Run test case TC-001 on a Galaxy S20 (UDID: R58M20D1ELE) with cross-device strategy"

> "Create a test run named 'Regression v2.0' using test suite TS-100 on individual devices: Pixel 6 and Galaxy S21"

---

### `listTestRuns`

List scriptless test runs with pagination. Shows run status, device count, and pass/fail summary.

**Prompt examples:**

> "Show me the latest test runs"

> "List all Android test runs sorted by name"

---

### `getTestRun`

Get test run details including per-device execution status, test case results, and failure information.

**Prompt examples:**

> "Show me the results for test run TR-200"

> "Get test run TR-200 details with remediation actions for failures"

---

### `terminateTestRun`

Terminate a running scriptless test run. Stops all in-progress device executions.

**Prompt examples:**

> "Stop test run TR-200"

> "Terminate the running test run TR-200, something went wrong"
