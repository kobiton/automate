# Changelog

## 1.1.0 - 2026-03-20

### Changed
- Authentication: migrated from static API key (`KOBITON_AUTH` env var) to OAuth 2.1 with automatic browser login
- `.mcp.json`: simplified to minimal config (`type` + `url` only); server-side handles OAuth discovery via `WWW-Authenticate` header
- README: rewritten Installation section with OAuth as primary setup, API key as alternative for CI/headless
- Validation: updated to accept OAuth, API key, and minimal `.mcp.json` formats

### Added
- `.mcp.apikey-example.json`: reference config for API key auth fallback (CI/CD pipelines)
- 4 new validation tests for OAuth, API key, minimal, and invalid OAuth block formats
- Tool annotations (`title`, `readOnlyHint`, `destructiveHint`) to all tool definitions

### Fixed
- Validator case-sensitivity bug: `skill.md` → `SKILL.md` now matches actual filenames

## 1.0.0 - 2026-03-20

- Initial release with 23 MCP tools and 2 skills
- Device management: list, status, reserve, terminate reservation
- Device bundles: list bundles for matrix testing
- Session management: list, details, artifacts, terminate
- App management: list, details, upload to store, upload for runner
- Scriptless test management: test cases, test suites, test runs
- Automation: start native (XIUM/UIAUTOMATOR/XCUITEST) and Appium sessions
- Skills: run-automation-suite, run-scriptless-test
