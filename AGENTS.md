# AGENTS.md — Kobiton Automate

Cross-tool agent instructions for the Kobiton mobile testing platform's MCP plugin. This file is the host-agnostic equivalent of `skills/run-automation-suite/SKILL.md` — it's read by Gemini CLI (via `contextFileName`), Codex CLI, GitHub Copilot CLI, ChatGPT Apps SDK, and other agentic CLIs that don't consume Claude Code's skill format.

## What this plugin does

Kobiton is a real-device mobile cloud for Android + iOS testing. This MCP plugin gives AI agents 12 tools to:

- **Devices** — list, get status, reserve, terminate reservation
- **Apps** — list, upload, confirm upload, get details
- **Sessions** — list, get, get artifacts, terminate

The MCP server runs at `https://api.kobiton.com/mcp`. Authentication is OAuth 2.1 (default) or API key (CI/headless).

## When the user asks to run tests on Kobiton

Default workflow (matches the `run-automation-suite` skill for Claude Code users):

1. **Identify the app** — ask the user whether to upload a new app build or reuse an existing one. Do NOT auto-upload without confirmation.
2. **Select a device** — call `listDevices` with the right platform filter. Confirm with the user before reserving.
3. **Parse capabilities** — read the local Appium test script (Node / Python / .NET / Java), extract the capabilities literal, reconcile against the selected device per the must-match / suggested-default / user-controlled policy in `skills/run-automation-suite/references/capabilities.md`.
4. **Confirm and execute** — present the summary, get user confirmation, run the script in the background, open the live-view URL.
5. **Collect artifacts** — after the session terminates, call `getSession` + `getSessionArtifacts` for video, logs, screenshots, test reports. Surface session link + pass/fail.

Detailed step-by-step instructions live in `skills/run-automation-suite/SKILL.md` — read those if you support Claude Code's skill format.

## Known limitations

Several behaviors of the current Kobiton MCP server have known gaps that agents should plan around (full details with workarounds in `skills/run-automation-suite/SKILL.md` § "Known Limitations"):

- **`confirmAppUpload` async race** — returns 200 OK before the parser finishes. Poll `getApp(appId)` until state is `READY` or `FAILURE_PARSING` before downstream calls.
- **`reserveDevice` ambiguous conflict** — `device_unavailable` lumps 4 failure modes. Don't retry the same device; broaden the filter and pick a different device.
- **W3C `/se/log` silently breaks legacy `driver.getLogs()`** — Kobiton's Appium endpoint is W3C-strict. Warn the user if their test script uses the legacy log API.
- **`deleteSession` ~5min cooldown** — device enters cleanup after termination; `reserveDevice` on the same device may return `device_unavailable` for ~5min.
- **Per-command session data not exposed** — no plugin-side way to save a session as a test case; direct the user to the Kobiton portal manually.

## userIntent format

Every tool call requires a `userIntent` argument summarizing what the user is trying to accomplish. The plugin's audit logging consumes this.

For automated / pipeline use, the strict format is:

```
[partner=<name>] <verb-phrase, 20-80 chars> | contact:<email>
```

For interactive end-users, a short natural-language summary is fine:

```
"reserve a Pixel 7 to run the checkout suite"
```

## Cross-host install

| Host | Install path |
|---|---|
| Claude Code | `/plugin install automate@kobiton` (uses `.mcp.json` + `skills/` + `agents/` + `hooks/`) |
| Gemini CLI | `gemini extensions install kobiton/automate` (uses `gemini-extension.json` + this `AGENTS.md`) |
| Cursor | Add `.cursor/mcp.json` config (see README) |
| Codex CLI | `~/.codex/config.toml` (see README) |
| GitHub Copilot CLI | See README install section |
| ChatGPT Apps SDK | Add `https://api.kobiton.com/mcp` in ChatGPT developer mode |
| Continue / Cline | Add to `~/.continue/config.json` or equivalent (see README) |

Hooks (the `hooks/` directory) and the `agents/` directory are Claude Code-specific today; other hosts will ignore them.

## Reference

- Plugin source: https://github.com/kobiton/automate
- Kobiton platform documentation: https://docs.kobiton.com
- Appium 2.x: https://appium.io
- MCP specification: https://modelcontextprotocol.io/specification/2025-06-18
