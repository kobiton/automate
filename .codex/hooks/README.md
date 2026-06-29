# Hooks (Claude Code-specific)

This directory contains Claude Code [hooks](https://code.claude.com/docs/en/hooks) — two advisory `PreToolUse` / `PostToolUse` handlers that surface a known platform timing window around the plugin's MCP tool calls.

**These hooks are Claude Code-only.** Other MCP clients (Cursor, ChatGPT, Codex, Gemini CLI, Continue) have no equivalent hook system. For cross-client observability the right substrate is server-side OpenTelemetry instrumentation, not client-side hooks.

## What the hooks do

| Hook | Event | Matcher | What it does |
|------|-------|---------|--------------|
| `advise-pre-terminate-cooldown` | PreToolUse | `terminateSession` | Allows the call but injects a notice that the device enters ~5min cleanup cooldown post-termination (see closed issue [#36](https://github.com/kobiton/automate/issues/36)). |
| `advise-post-terminate-cooldown` | PostToolUse | `terminateSession` | Confirms the cooldown window post-termination with `sessionId` for traceability. |

> **Note on app-upload polling.** An earlier draft of this bundle included a third advisory (`advise-app-upload-poll`) for the `confirmAppUpload` async-parse race (originally filed as [#34](https://github.com/kobiton/automate/issues/34), F25/F26). That timing window is now handled server-side: as of [v1.5.0](https://github.com/kobiton/automate/releases/tag/v1.5.0), `confirmAppUpload` returns a structured `next_step` block pointing at the new `getAppParsingStatus(versionId)` tool, and the guidance reaches every MCP host in-band rather than via a Claude-Code-only hook. The advisory was dropped here to avoid a redundant second copy of the same instruction.

## Design constraint: advisory-only, no authenticated API calls

An earlier design had the hooks themselves call `getApp` to poll for state transitions. A multi-reviewer pre-flight (code-reviewer + security-auditor + test-automator) flagged that design with multiple BLOCKERs — primarily around credential strategy, SSRF surface, and PII echo from the response body into agent context.

The current design eliminates the auth-needing surface entirely. **Hooks never make HTTP requests.** They emit text advisories into the agent's context window; the agent itself uses its already-authenticated `getApp` / `listDevices` / etc. MCP tools to do any real polling or follow-up. Same outcome, no security blast radius.

See [`THREAT-MODEL.md`](./THREAT-MODEL.md) for the threat model and the explicit non-goals.

## Install requirements

- Claude Code (any version that supports the `hooks/hooks.json` plugin convention)
- Node 20+ (already a plugin requirement per `CONTRIBUTING.md`)

Hooks run on the end-user's machine, not the Kobiton MCP server. Disable them globally with `--no-hooks` if needed, or delete the matcher entry in `hooks.json` to disable a single hook.

## Running the tests

Tests live alongside the scripts and use the plugin's existing vitest runner:

```bash
pnpm test
```

The vitest default include pattern picks up `hooks/scripts/*.test.mjs` without configuration changes.

## Adding a new hook

1. Add the handler script to `hooks/scripts/<name>.mjs`. Follow the conventions in the existing scripts:
   - Read stdin once; never read `process.env.CLAUDE_HOOKS_INPUT_JSON` (it does not exist)
   - No outbound network calls
   - Validate all numeric IDs before interpolating into output text
   - Output via `hookSpecificOutput` envelope, not top-level `decision` (top-level is silently ignored for PreToolUse)
   - Use exec form in `hooks.json` (`"command": "node", "args": [...]`), not shell form — Windows WSL2 fails on shell form
   - Use `${CLAUDE_PLUGIN_ROOT}` not `${CLAUDE_PROJECT_DIR}`
2. Add a test file `hooks/scripts/<name>.test.mjs` covering valid input, boundary cases, missing fields, malformed JSON, and PII-leakage negative tests.
3. Update `hooks.json` with a new matcher entry.
4. Re-run `pnpm test` and `pnpm run validate`.

## References

- [Claude Code hooks spec](https://code.claude.com/docs/en/hooks)
- Closed issues with platform-behavior detail: [#34](https://github.com/kobiton/automate/issues/34), [#36](https://github.com/kobiton/automate/issues/36)
