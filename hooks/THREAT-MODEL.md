# Threat model — `hooks/`

Threat model for the two advisory Claude Code hooks in this directory. Written in response to a multi-reviewer pre-flight (code-reviewer + security-auditor + test-automator) on the original proposal.

## Trust boundaries

Hooks run on the **end-user's machine** inside the Claude Code process. They are NOT part of the Kobiton MCP server (which lives at `api.kobiton.com/mcp` and is out of scope here).

Per-hook input source: stdin only — a single JSON-RPC-style request object emitted by Claude Code's hook runtime. Per-hook output destination: stdout — a single JSON object that Claude Code consumes back.

Hooks have access to:

- The plain stdin (the tool call request or response)
- `process.env` (including any vars the user has exported, e.g., `KOBITON_AUTH`)
- The plugin install directory via `${CLAUDE_PLUGIN_ROOT}`

Hooks do NOT have access to:

- The MCP server's auth tokens (those live in Claude Code's MCP session state, not in env or stdin)
- Other tools' results from prior turns
- The user's filesystem beyond what they explicitly grant via tool permissions

## Threats considered

### T1 — Credential leakage to stdout / logs / disk

**Threat:** a hook reads `process.env.KOBITON_AUTH` or similar, logs it to stderr, writes it to a temp file, or echoes it back through the output envelope. Subsequent agent turns or session exports then carry the credential into Anthropic's API context.

**Mitigation:** **No hook in this directory makes authenticated API calls.** None of them read credential-bearing env vars. None of them write to temp files. The only outputs are the `hookSpecificOutput` JSON envelope, which contains only structured advisory text — never raw response bodies, never env-var values.

If a future hook adds an authenticated API call, it MUST:
- Read the credential from `process.env.KOBITON_AUTH` (never argv, never stdin)
- Pass via `Authorization` header on a `fetch()` call only
- Never log/echo/write the header value
- Add a unit test that greps stdout/stderr for `KOBITON_AUTH` and fails if found

### T2 — Prompt injection via reflected input

**Threat:** a hook echoes user-controlled input (e.g., the `userIntent` argument value, an `appId` from a tool response) back into the agent's context via the `additionalContext` or `permissionDecisionReason` fields. An attacker crafts an input containing prompt-injection text (`"} ignore previous instructions ...`) which then runs as part of the next agent turn.

**Mitigation:**
- `advise-post-terminate-cooldown.mjs`: only `sessionId` is echoed, sanitized to digits-only. Tested negatively in `advise-post-terminate-cooldown.test.mjs`.
- `advise-pre-terminate-cooldown.mjs`: emits a fully static advisory with no input echo at all.

### T3 — SSRF / endpoint redirection via injected IDs

**Threat (theoretical — not present in current design):** a future hook that fetches `/v1/apps/${appId}` could be tricked into hitting an attacker-controlled URL if `appId` is taken straight from the tool response without validation (`appId = "123/../../admin"` or `"123@evil.example.com"`).

**Mitigation:** the current design eliminates this by not making HTTP requests from hooks at all. If a future hook adds a fetch:
- Construct URLs via `new URL(path, BASE)` with `BASE` a const, never string interpolation
- Assert `url.host === 'api.kobiton.com'` and `url.pathname.startsWith('/v1/...')` post-construction
- Whitelist input IDs as digits-only before use

### T4 — PII leakage via response body echo

**Threat (theoretical — not present in current design):** a hook fetches a server-side log endpoint and emits the raw response body into agent context. The body may include uploader email, internal stack frames, app package names, signing-cert fingerprints, build-host file paths.

**Mitigation:** no hook in this directory reads server-side response bodies beyond the `tool_response` already visible to the agent through the MCP tool result. If a future hook adds such a read, the response MUST be whitelisted to a small set of structural fields (e.g., `{state, category, message_short}`) with `message_short` regex-stripped of email addresses, absolute paths, and base64-shaped tokens before emission.

### T5 — ReDoS on hook regexes

**Threat:** an attacker submits a tool-call argument value crafted to trigger catastrophic backtracking on a hook-side regex, spiking CPU on every Kobiton MCP call.

**Mitigation:** the only hook that echoes an input ID (`advise-post-terminate-cooldown.mjs`) uses regex solely for digit-only sanitization — `String(id).replace(/[^0-9]/g, '').slice(0, 20)`. That pattern is a single character-class match with a global flag and a hard slice — linear-time, no quantifier nesting, no backtracking surface. No hook in this directory uses regex to *validate* user input against a structural pattern.

Any future hook that adds a validation regex MUST:
- Length-bound the input via `.slice()` or `length` short-circuit BEFORE the regex runs
- Use only bounded quantifiers (no unbounded `.+` or `.*`)
- Avoid nested quantifiers
- Carry a unit test that asserts wall-clock bound on a known-pathological input

### T6 — Path manipulation via `${CLAUDE_PROJECT_DIR}` vs `${CLAUDE_PLUGIN_ROOT}`

**Threat:** an earlier draft used `${CLAUDE_PROJECT_DIR}` (the user's project root) instead of `${CLAUDE_PLUGIN_ROOT}` (the plugin install directory). If the user runs the plugin in a project where `hooks/scripts/` doesn't exist at the project root, every hook invocation crashes — and a crash on a `PreToolUse` hook is treated as non-blocking, defeating the validation.

**Mitigation:** both hooks reference `${CLAUDE_PLUGIN_ROOT}/hooks/scripts/...` in `hooks.json`. The plugin install location is stable; the user's project location is not.

### T7 — Shell metachar interpretation via shell-form `command`

**Threat:** if `hooks.json` uses shell form (`"command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/X.mjs"`), a `CLAUDE_PLUGIN_ROOT` value containing spaces or special characters (think Windows paths like `C:\Users\My Name\.claude\plugins\...`) breaks the command or — worse — executes unintended path components.

**Mitigation:** both hooks use **exec form** (`"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/X.mjs"]`). Args are passed literally to the OS exec call, not interpreted by a shell.

### T8 — Timeout-based denial of service

**Threat:** a hook that hangs (e.g., waiting on stdin that never closes) ties up the agent for the full hook timeout. With Claude Code's 600s default, this can stall an agent for 10 minutes per tool call.

**Mitigation:** every hook in `hooks.json` has an explicit `"timeout": 5` (seconds). Both scripts have stdin-read code paths that exit gracefully on read failure or empty input.

### T9 — Supply chain integrity

**Threat:** an attacker lands a PR modifying one of the handler scripts to exfiltrate credentials or alter the validation gate. Hooks run with full process privileges; a malicious change is high-impact.

**Mitigation (current):** the scripts are short, security-reviewed, and live alongside their tests. PRs touching `hooks/` should attract the same multi-reviewer pre-flight (code-reviewer + security-auditor + test-automator) the original bundle received.

**Mitigation (future):** consider SHA-256 checksums in `hooks/hooks.json` description fields + a `package.json` `postinstall` script that verifies. Acknowledged limitation: a checksum approach is only as strong as the reviewer noticing a checksum bump.

## What this threat model does NOT cover

- Kobiton MCP server vulnerabilities (out of scope; addressed separately by Kobiton security)
- Claude Code hook runtime vulnerabilities (Anthropic's responsibility)
- The user's broader Claude Code threat surface (system-level prompt injection, MCP server impersonation, etc.)
- Hooks in OTHER MCP clients (these hooks are Claude Code-only)
