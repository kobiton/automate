---
name: run-scriptless-test
description: Run scriptless tests on Kobiton devices. Guides you through test case/suite selection, device selection, test run creation, and result monitoring.
---

## Workflow

### 1. Discover available tests

Use `listTestCases` or `listTestSuites` to show the user what's available.
Ask the user whether they want to run:
- A full test suite
- Individual test cases

### 2. Get test details

Use `getTestCase` or `getTestSuite` to show details of the selected tests.
Confirm the platform (Android/iOS) from the test case data.

### 3. Select devices

Ask the user how to select devices:
- **Device bundle** — use `listDeviceBundles` to show bundles, pick one
- **Individual devices** — use `listDevices` to find matching devices by platform

Ask about allocation strategy:
- **CROSS_DEVICE** (default) — run every test case on every device
- **SINGLE_DEVICE** — assign one test case per device

### 4. Optional app override

Ask if the user wants to override the app version used in the original recording.
If yes, use `listApps` and `getApp` to find the right app version ID.

### 5. Create test run

Use `createTestRun` with the gathered parameters:
- `testSelection` (suite or individual cases)
- `deviceSelection` (bundle or specific devices)
- `appSelections` (if overriding)
- `deviceAllocationStrategy`

### 6. Monitor execution

Poll `getTestRun` every 30 seconds to check execution status.
Report progress: how many devices completed, pass/fail counts.

When all executions finish, summarize:
- Total test cases x devices
- Pass / fail / error counts
- Link to session details for any failures

If the user wants to stop early, use `terminateTestRun`.
