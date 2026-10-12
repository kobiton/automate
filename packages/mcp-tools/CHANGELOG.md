# Changelog

## 1.1.0

- `getSession` documents `scan_status` (a type reads `in_progress` for at most 24 hours after the session ends), and the six per-type validation list tools say that an empty or short result may be partial while the session's validation scan is still running; after a few checks minutes apart, report it as partial instead of waiting longer.
  `getAccessibilityValidationsSummary` documents `scan_complete`, `listCrashValidations` documents `pending_count`, and `getTestRun` documents the per-execution scanning statuses.
- `listTestCases`, `listTestSuites` and `listTestRuns` document `rowsPerPage` as default 10, max 20.
  `getUserInputEvents` `limit` is default 10, max 20 (was 50 and 200).
- `listDevices` documents the per-list totals and the effective `limit`.

## 1.0.0

First release: `tool-definitions.yaml`, the combined catalog built from `tools/*.yaml`.
