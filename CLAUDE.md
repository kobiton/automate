# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Getting started

The user journey the plugin serves, end to end: `/automate:setup` → list/reserve a device → drive it (one skill, below) → save the session as a test case (`saveTestCase`) → optionally create and monitor a test run.
Every skill is a step on that path; route by intent:

| Reach for this when the user wants… | Skill |
|---|---|
| to run local Appium scripts (Node.js/Python/.NET/Java) on Kobiton devices | `run-automation-suite` |
| a clean hands-off run of a described flow, saveable as a test case | `drive-automation-session` |
| quick inspection / troubleshooting — poke at a device, pull logs, push files | `run-interactive-session` |
| to kick off a test run from a test case or suite | `create-test-run` |
| to watch a running test run and catch blockers | `monitor-test-run` |

Vocabulary the skills assume: **session** (one recorded device connection), **test case** (saved replayable steps, usually from a session), **test run** (execution of a case/suite across devices), **test suite** (ordered collection of cases), **reservation** (exclusive device hold), **device UDID** (unique device identifier), **live remediation** (browser takeover to fix a blocked execution mid-run).

**Ambiguous prompts** (*"test the login screen of app ABC"* — goal named, method not): route by signal — script files mentioned → `run-automation-suite`; flow described / wants it repeatable → `drive-automation-session`; diagnostic verbs (explore, poke, logs, adb, push/pull) → `run-interactive-session`; names an existing case/suite → `create-test-run`; run already in flight → `monitor-test-run`.
With no deciding signal, ask ONE question (scripts / agent-driven / hands-on) and recommend `drive-automation-session` — any platform, plain-language goal, and the session stays saveable via `saveTestCase`.
Never silently pick `run-interactive-session` for a "test X" goal: CLI sessions don't feed `saveTestCase`, so that route forfeits the saveable outcome.

**Intent synonyms**: "rerun / run again / revisit / replay a **test case**" → `create-test-run`; "rerun a **session**" → `saveTestCase` first, then `create-test-run` (sessions aren't rerun directly); "replay / review the **recording**" → `getSessionArtifacts` / session portal page, not a new run; "watch / follow / track" → `monitor-test-run`.

**Session model** (the UX facts routing relies on): every session has a type — `AUTOMATION` (script/agent Appium), `CLI` (bundled CLI wrapper), `MANUAL` (human in the portal live view); a human interacting in the live view during an automation session makes it `MIXED`.
Test cases are session-based (`saveTestCase` on a completed session; requires `kobiton:scriptlessCapture` + allowlisted endpoints — see `skills/drive-automation-session/references/endpoint-reference.md`).
A test run **revisits** a case's steps per device (`getTestRun.revisit_executions[]`).
Clean Appium session end (`DELETE /wd/hub/session/{id}`) records `COMPLETE` (what `saveTestCase` expects); `terminateSession` records `TERMINATED`.
Live remediation is flag-dependent: flag ON → a blocked execution pauses (`BLOCKED_WAITING`), the human fixes it live, and the **same** run resumes; flag OFF → the execution fails and a portal-submitted resolution applies on the **next** rerun.

Prerequisites: a Kobiton account, credentials via `/automate:setup`, and a supported host.
`run-interactive-session`'s bundled CLI is macOS-only (an x86_64 binary — native on Intel, Rosetta 2 on Apple Silicon) — on other platforms route to `run-automation-suite` or `drive-automation-session`.
README's [Getting Started](README.md#getting-started) carries the full narrated path and a copy-pasteable worked example.

## Commands

```bash
pnpm install                     # CI runs Node 20 / pnpm 9; older versions untested
pnpm run validate                # validate.js + sync-codex-artifacts.js --check + sync-version.js --check
pnpm test                        # vitest run
pnpm run test:watch              # vitest watch mode

pnpm run build                   # = build:tools && build:codex && build:version
pnpm run build:tools             # concatenate tools/*.yaml into dist/tool-definitions.yaml
pnpm run build:codex             # mirror skills/ assets/ scripts/ hooks/ into .codex/
pnpm run build:version           # propagate package.json `version` into all host manifests

# Single test file
pnpm exec vitest run scripts/validate.test.js
pnpm exec vitest run skills/run-automation-suite/scripts/render-capabilities.test.js
```

CI runs `pnpm install --frozen-lockfile && pnpm run validate && pnpm test` on every push/PR to `main` (`.github/workflows/ci.yml`). A second workflow runs CodeQL (`.github/workflows/codeql.yml`). No lint step.

**Test files** — all under `scripts/` plus one skill test. The `.codex/` mirror copy of `render-capabilities.test.js` is excluded by `vitest.config.js` (`exclude: ['.codex/**']`) so the same suite doesn't run twice.

| File | Covers |
|---|---|
| `scripts/validate.test.js` | structural validation across manifests, tool YAMLs, skill frontmatter |
| `scripts/build-tool-definitions.test.js` | tool-definition YAML concatenation |
| `scripts/sync-codex-artifacts.test.js` | `.codex/` mirror sync + `--check` parity |
| `scripts/sync-version.test.js` | version field sync across host manifests + `CHANGELOG.md` top-entry match |
| `skills/run-automation-suite/scripts/render-capabilities.test.js` | Appium capability renderer |

When adding a new tool YAML or skill that hits a new validation path, extend `setupValidProject` in `scripts/validate.test.js`. Pure additions to an existing pattern don't require a fixture update.

## Architecture

Hosts (Claude Code, Copilot CLI, Gemini CLI, Codex CLI, Cursor CLI) read a host-specific MCP config from this repo, then open an MCP connection to `https://api.kobiton.com/mcp` where the actual tools live. **This repo ships manifests, schemas, skills, slash commands, and one SessionStart hook — none of the tool logic is local.** `tools/*.yaml` are the public input-shape contract Kobiton publishes to S3 as `dist/tool-definitions.yaml`; the running MCP server owns the canonical schema. A YAML edit here affects the published contract on next maintainer release; it does not change server behavior.

There is no local way to test that a new tool YAML matches a deployed server-side tool. Schema changes are validated structurally by `pnpm run validate`; functional verification happens after Kobiton deploys the corresponding server change. Coordinate via an issue before adding new tool YAMLs.

### Tool inventory

`tools/` holds 5 YAML files auto-discovered by `scripts/validate.js` (no manual array maintenance):

| File | Tools |
|---|---|
| `tools/devices.yaml` | `listDevices`, `getDeviceStatus`, `reserveDevice`, `terminateReservation` |
| `tools/sessions.yaml` | `listSessions`, `getSession`, `getSessionArtifacts`, `getUserInputEvents`, `terminateSession` |
| `tools/apps.yaml` | `listApps`, `uploadAppToStore`, `confirmAppUpload`, `getAppParsingStatus`, `getApp` |
| `tools/user.yaml` | `getCredential` |
| `tools/test-management.yaml` | 14 test-case / test-run / test-suite CRUD tools |

`tools/devices.yaml`, `tools/sessions.yaml`, `tools/apps.yaml` set the full 4-hint annotation block (`readOnlyHint`, `destructiveHint`, `idempotentHint` where meaningful, `openWorldHint: false`). `tools/user.yaml` and `tools/test-management.yaml` currently use the older 2-hint shape (`readOnlyHint` + `destructiveHint` only) — when modifying those files, prefer adding the missing hints rather than leaving them inconsistent.

### Skills

`skills/` is auto-discovered by `scripts/validate.js`:

| Skill | Runtime | Notes |
|---|---|---|
| `run-automation-suite` | `scripts/render-capabilities.js` parses Appium test scripts and reconciles capabilities against the selected device | refs: `references/capabilities.md`, `references/templates/appium.ejs` |
| `run-interactive-session` | `scripts/run.sh` wraps the bundled `skills/run-interactive-session/bin/kobiton` CLI for natural-language WebDriver / device / file commands | binary ships as **x86_64 macOS only** (native on Intel, Rosetta 2 on Apple Silicon); other platforms can use `run-automation-suite` instead |
| `drive-automation-session` | `scripts/appium.js` (`node:https`-only Appium HTTP client) drives an automation-type session from a natural-language intent; `scripts/strip-webview-dom.js` shrinks webview source | refs: `references/endpoint-reference.md`, `references/loop-discipline.md`, `references/capabilities.md` |
| `create-test-run` | Conversational glue over the `createTestRun` MCP tool (no local runtime): fills defaults from the createTestRun schema, confirms a summary, creates the run, then offers monitoring in one prompt and delegates to `monitor-test-run` | uses `Skill` to delegate; no `scripts/` |
| `monitor-test-run` | `scripts/poll-test-run.js` (`node:https`-only; reads `~/.kobiton/.credentials`) polls run state over REST and emits only on change; host streams it (Claude Code: `Monitor` tool). Surfaces blockers + the live-remediation URL; auto-opens the window via the shared chromeless launcher when opted in | refs: the bundled poller; reuses `run-automation-suite`'s `chromeless-launcher.*` |

### Build pipeline

`pnpm run build` runs three sub-steps. Each has a corresponding `--check` mode wired into `pnpm run validate`:

1. `build:tools` (`scripts/build-tool-definitions.js`) — concatenates `tools/*.yaml` into `dist/tool-definitions.yaml`. Kobiton publishes this artifact to S3; gitignored locally.
2. `build:codex` (`scripts/sync-codex-artifacts.js`) — mirrors `skills/`, `assets/`, `scripts/`, `hooks/` into `.codex/`. Codex CLI's plugin installer silently skips symlinks, so the mirror must ship real files. **`.cursor/mcp.json` is NOT mirrored** — Cursor reads MCP config natively at install time.
3. `build:version` (`scripts/sync-version.js`) — writes `package.json`'s `version` into every host manifest (`.claude-plugin/plugin.json`, `.codex/.codex-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `gemini-extension.json`, plus the plugin entry in both `.claude-plugin/marketplace.json` and `.cursor-plugin/marketplace.json`) and verifies the top `## X.Y.Z` entry in `CHANGELOG.md` matches.

`package.json` is the single source of truth for `version`; never hand-edit a manifest's `version` field. `dist/` is gitignored.

## Cross-tool surface

The plugin ships configs for five AI CLI hosts. Source-of-truth is the root files; `.codex/` is a generated mirror, while `.cursor/mcp.json` and the `.cursor-plugin/` manifests are hand-authored.

| Host | MCP config | Plugin manifest | Context file |
|---|---|---|---|
| Claude Code | `.mcp.json` (OAuth) + `.mcp.apikey-example.json` (API key) | `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` | `skills/*/SKILL.md` |
| GitHub Copilot CLI | `.mcp.json` (shared) | `.agents/plugins/marketplace.json` (reuses `.codex/` as source) | `AGENTS.md` |
| Gemini CLI | `gemini-extension.json` (inlines `mcpServers`) | extension descriptor IS the manifest | `AGENTS.md` (via `contextFileName`) |
| Codex CLI | `.codex/.mcp.json` | `.codex/.codex-plugin/plugin.json` | `.codex/skills/*/SKILL.md` (mirror) |
| Cursor CLI / IDE | `.cursor/mcp.json` | `.cursor-plugin/plugin.json` + `.cursor-plugin/marketplace.json` | `AGENTS.md` |

**Header field-name differs by host.** Claude / Copilot / Gemini / Cursor use `headers` in MCP config; Codex uses `http_headers` (snake_case wrapper). The `X-AI-Tool-Name` value also differs per host (`Claude` / `Codex` / `Gemini` / `Cursor`). When adding a new host config, copy from the closest existing one — don't mix idioms across hosts.

`AGENTS.md` is the cross-tool brief read by every non-Claude-Code host. When extending a skill's workflow or known-limitations list, mirror substantive changes into `AGENTS.md` so non-Claude hosts stay current. `AGENTS.md` currently covers `run-automation-suite`, `run-interactive-session`, `drive-automation-session`, `create-test-run`, and `monitor-test-run`. Note `create-test-run`/`monitor-test-run` reference Claude Code's `Monitor` tool for streaming the poller; non-Claude hosts must substitute their own streamed-shell / watch / loop affordance (see the `monitor-test-run` SKILL.md host table).

### Skill compatibility matrix

The table above answers *where config lives*. This one answers *whether a given skill can run here at all* — what each skill needs from its host. Every cell is derivable from the skill's `allowed-tools` frontmatter and its bundled scripts, so a reviewer can re-verify it. **This matrix is the single source of truth** — `AGENTS.md` carries a prose summary that links here rather than a second copy, and each skill states its own requirements at the top of its `## Prerequisites`. If a skill's host support changes, update this table and that skill's Prerequisites.

| Skill | Supported hosts | Needs local file access | Local binary / OS constraint | Needs streamed-watch affordance | Pure MCP (chat-safe) |
|---|---|---|---|---|---|
| `create-test-run` | any MCP-aware host, **including file-access-less chat hosts** | no | no | no — delegates the watch | **yes**, for the create-and-stop path (opting into monitoring hands off to `monitor-test-run`, which is not chat-safe) |
| `monitor-test-run` | CLI hosts with local FS | **yes** — bundled `scripts/poll-test-run.js` reads `~/.kobiton/.credentials` | Node 18+ | **yes** — Claude Code's `Monitor`; other hosts substitute a streamed shell / watch / loop (see the host table in the skill) | no |
| `drive-automation-session` | any CLI host with local FS | **yes** — writes and reads `iter-N.*.json` turn files | Node 18+; cross-platform (`node:https` only, no native binary) | no | no |
| `run-automation-suite` | any CLI host with local FS | **yes** — reads the user's local Appium script directory | Node 18+, Appium 2.x, plus the script's own language runtime (npm / python / java / dotnet / ruby) | no | no |
| `run-interactive-session` | CLI hosts on **macOS only** | **yes** — bundled CLI binary + `~/.kobiton/.credentials` | **macOS only.** The bundled `bin/kobiton` is a single-slice **x86_64** Mach-O: native on Intel Macs, and on Apple Silicon it runs **under Rosetta 2**. Unavailable on Linux and Windows — route to `run-automation-suite` or `drive-automation-session` | no | no |

**Chat vs CLI, in one line:** `create-test-run` is the only skill that is pure MCP glue, so it is the only one safe in a host with no local filesystem (e.g. Claude Chat, or the MCP-only surfaces listed at the bottom of `AGENTS.md`'s Cross-host install table). Every other skill reads or writes local files — a script directory, turn files, a credentials file, or a bundled binary — and needs a CLI host such as Claude Code, Codex CLI, Gemini CLI, Copilot CLI, or Cursor. When a required affordance is missing, say so and name the alternative rather than starting a workflow that cannot finish.

## Slash commands

Two commands ship in two file formats so each host can read its preferred one. Markdown is the format Claude Code historically reads (and what Copilot CLI and Cursor read today); TOML is Gemini CLI's native format. Codex CLI uses its SessionStart hook instead of slash commands. Cursor reads the Markdown commands but registers them **without the `automate` namespace** — they surface as `/setup` and `/doctor` (disambiguate from Cursor's built-ins by the Kobiton description).

| Command | Claude Code / Copilot CLI | Gemini CLI |
|---|---|---|
| `/automate:setup` | `commands/setup.md` | `commands/automate/setup.toml` |
| `/automate:doctor` | `commands/doctor.md` | `commands/automate/doctor.toml` |

- `/automate:setup` — bootstraps `~/.kobiton/.credentials` from the authenticated MCP session by calling the `getCredential` tool. Also re-installs the `~/.kobiton/bin/kobiton` symlink the `run-interactive-session` skill depends on (Codex CLI installs it automatically via SessionStart; other CLIs run setup once).
- `/automate:doctor` — read-only health check: CLI install, credentials file, active profile, required fields.

Gemini CLI derives `/automate:setup` from the directory path `commands/automate/setup.toml`. Claude Code and Copilot CLI read `commands/setup.md` with the plugin name (`automate`) supplying the namespace. When changing one command's behavior, change both file formats so cross-host parity holds.

## Hooks

`hooks/hooks.json` ships a single `SessionStart` command hook that runs `bash ${CLAUDE_PLUGIN_ROOT}/scripts/install-cli.sh` to install the `~/.kobiton/bin/kobiton` symlink. The Codex mirror at `.codex/hooks/hooks.json` carries the same hook, and `.cursor/hooks/hooks.json` carries a `sessionStart` equivalent (`${CURSOR_PLUGIN_ROOT}` interpolation). On Codex, the user trusts the hook once via `/hooks`; subsequent sessions run it silently. On Claude Code it runs every session. Cursor ships the hook but does not currently execute SessionStart hooks for plugins — Cursor users run `/setup` once instead.

When modifying `scripts/install-cli.sh` (or adding any new script that hooks invoke), run `pnpm run build:codex` to refresh the `.codex/scripts/` mirror — the `--check` mode in `pnpm run validate` will otherwise fail CI. Hook scripts should be idempotent.

## Tool schema conventions

`scripts/validate.js` auto-discovers tool YAMLs. To add a tool: drop a YAML in `tools/` and run `pnpm run validate`. No `validate.js` edit required.

**Annotation hints currently in use** — pattern by tool verb (matches the as-of-today YAML, not aspiration):

| Tool verb | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
|---|:-:|:-:|:-:|:-:|
| `list*`, `get*` (read-only) | true | false | *omit* | false |
| `reserve*`, `upload*` (creates resource) | false | false | false | false |
| `confirm*` (idempotent finalize) | false | false | true | false |
| `terminate*` (destructive but idempotent) | false | true | true | false |

`idempotentHint` is omitted on `readOnlyHint: true` tools per MCP 2025-06-18 — the field is defined as meaningful only for non-read-only operations, so an explicit value adds noise. `terminate*` carries `idempotentHint: true` because a repeat-terminate against an already-terminated resource is a no-op (HTTP DELETE pattern).

The `test-management.yaml` and `user.yaml` tools currently ship the older 2-hint subset (`readOnlyHint` + `destructiveHint` only); when touching those files, extend with `idempotentHint` and `openWorldHint: false` per the patterns above.

Tool response payloads must stay under 25,000 tokens — trim in the backend handler, not the schema.

Other YAML conventions: tool `name` is camelCase ≤ 64 chars; each tool needs `description`, `annotations`, `inputSchema` (JSON Schema). `CONTRIBUTING.md` § Tool Schema Conventions has the broader contract — note that its "add to `toolFiles` / `skillDirs` array" guidance under "Adding New Tools or Skills to Validation" is stale (the validator auto-discovers; only the fixture update in `setupValidProject` is still relevant).

## Skill conventions

Skill directories under `skills/` are auto-discovered. To add a skill:

1. Create `skills/<name>/SKILL.md` with frontmatter (`name`, `description`, plus standard skill fields). Body is numbered `### N. Step` blocks, imperative tone written for the AI host (not the end user), end with an error-handling section and a summary step.
2. Co-locate runtime under `skills/<name>/scripts/` and references under `skills/<name>/references/`.
3. Run `pnpm run build:codex` to populate the `.codex/skills/<name>/` mirror.

## Commits & PRs

- **DCO sign-off required.** `git commit -s`. PRs without `Signed-off-by:` won't be merged.
- **Conventional Commits.** `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`. Use a `BREAKING CHANGE:` footer for any change requiring a major version bump (tool removed, required input added, response shape narrowed).
- **Branches.** `feat/…`, `fix/…`, `docs/…`, `chore/…` (kebab-case).
- **Style.** YAML 2-space; JS no-semicolons, single-quotes, Stroustrup braces; Markdown one-sentence-per-line where practical.
- **Review.** 1 maintainer approval; 3-business-day initial review SLA; stale after 14 days inactive.
- **Releases.** Maintainers only. See `CONTRIBUTING.md` § Release Process. Contributors do not hand-edit any manifest `version` field — `package.json` is the single source of truth; `pnpm run build:version` propagates it.
- **CHANGELOG.md.** Maintainers manage. They keep a single `## Unreleased` section between releases and rename it to `## X.Y.Z - YYYY-MM-DD` at release cut. Contributors should not add new version sections in PRs.

## Surfaces owned by maintainers / build scripts (don't hand-edit)

- `.codex/**` — regenerated by `pnpm run build:codex`
- `dist/**` — build output, gitignored
- `CHANGELOG.md` — maintainer-managed at release cut
- Every host manifest's `version` field — `pnpm run build:version` propagates from `package.json`

## Security

Vulnerabilities — plugin or platform — go to `security@kobiton.com`. See `SECURITY.md`. Never file as a public GitHub issue.
