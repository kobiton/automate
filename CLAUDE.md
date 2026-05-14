# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Audience.** Human contributors should read [`CONTRIBUTING.md`](./CONTRIBUTING.md) first — that is the canonical contributor contract. This file is the deeper context Claude Code reads, and doubles as an architecture map for any human who wants more depth than CONTRIBUTING covers. Where the two overlap, CONTRIBUTING is authoritative; this file extends it.

## Commands

```bash
pnpm install                     # Node 18+ minimum (CI pins Node 20), pnpm 8+ minimum (CI pins pnpm 9)
pnpm run validate                # JSON/YAML/manifest/frontmatter structural checks
pnpm test                        # vitest — see "Where tests live" below for the file map; run `pnpm test` for current counts
pnpm run test:watch              # vitest watch mode while iterating
pnpm run build                   # emits dist/tool-definitions.yaml (for S3 publish, not runtime)

# Single-test file
pnpm exec vitest run scripts/validate.test.js
pnpm exec vitest run skills/run-automation-suite/scripts/render-capabilities.test.js
pnpm exec vitest run hooks/scripts/validate-userintent.test.mjs
```

CI (`.github/workflows/ci.yml`) runs `pnpm run validate && pnpm test` on every push/PR to `main` with Node 20 / pnpm 9. Both checks should pass before merging — branch protection is not enforced, so the discipline is on reviewers. There is no lint step.

**Where tests live**:

| Path | Covers |
|------|--------|
| `scripts/validate.test.js` | structural validation: manifest, tools, skills, frontmatter |
| `skills/run-automation-suite/scripts/render-capabilities.test.js` | Appium capability renderer |
| `hooks/scripts/*.test.mjs` (one per hook) | per-hook valid-input, boundary, malformed-JSON, PII-leak negatives |

Run `pnpm test` for the current count.

**If CI fails:** run `pnpm run validate && pnpm test` locally — both surface line-level errors. For validation, the fixture in `scripts/validate.test.js` documents the expected shape; mirror it. For hook tests, see `hooks/THREAT-MODEL.md` for the negative cases each handler must cover.

## Fork sync (this working copy only)

This checkout is a fork — `origin` points at `jeremylongshore/automate`, `upstream` at `kobiton/automate`. Keep `main` in sync before cutting a PR branch:

```bash
git fetch upstream
git checkout main && git merge --ff-only upstream/main && git push origin main
```

Feature branches should always be cut from a freshly-synced `main`.

## Architecture

**This is a thin plugin pointing at a remote MCP server.** Nothing in this repo implements the 12 Kobiton tools — they live server-side at `api.kobiton.com/mcp`. The repo is manifests + one skill + reference schemas.

```text
┌────────────────┐  OAuth/API-key ┌──────────────────────────┐
│  Claude Code   │ ──────────────▶│  api.kobiton.com/mcp     │
│  (this plugin) │   HTTPS        │  (12 tools live here)    │
└────────┬───────┘                └──────────┬───────────────┘
         │                                   │
         │ runs locally                      │ source of truth mirrored to
         ▼                                   ▼
  skills/run-automation-suite         tools/*.yaml  ──build──▶  dist/tool-definitions.yaml  ──▶  S3
  agents/ (Claude Code only)          (reference schemas only,
  hooks/  (Claude Code only,           NOT consumed at runtime —
          advisory-only)               server is authoritative)
  AGENTS.md (cross-tool brief
          for Gemini CLI, Codex,
          ChatGPT Apps SDK, etc.)
```

**Cross-tool brief at `AGENTS.md`:** the repo root has an `AGENTS.md` file consumed by Gemini CLI (via `contextFileName`), Codex CLI, and GitHub Copilot CLI as their equivalent of `SKILL.md`. When extending the skill's workflow or known-limitations list, mirror substantive changes into `AGENTS.md` so non-Claude clients stay current. See [`AGENTS.md`](./AGENTS.md) for the full client-compatibility matrix.

**Three `.mcp.*.json` variants, one purpose each:**

| File | When loaded | Auth |
|------|-------------|------|
| `.mcp.json` | default, user installs | OAuth 2.1 browser flow |
| `.mcp.apikey-example.json` | CI/headless — user copies over `.mcp.json` | `Authorization: ${KOBITON_AUTH}` (base64 `user:key`) |
| `.mcp.dev-local.json` | Kobiton dev work against `localhost:3000/mcp` | — |

**The one piece of runtime code in this repo:** `skills/run-automation-suite/scripts/render-capabilities.js`. It reads `references/templates/appium.ejs`, applies CLI-flag values + hardcoded defaults, and emits JSON Appium capabilities for the skill to compare against the user's test script. This is the only code that executes on the user's machine at skill-invocation time.

**Tool schemas are reference documents, not runtime.** `tools/devices.yaml`, `sessions.yaml`, `apps.yaml` describe the 12 tools' input schemas so humans and the Kobiton backend stay in sync. `pnpm run build` concatenates them into `dist/tool-definitions.yaml` that Kobiton publishes to S3. Changing a YAML here does **not** change plugin behavior — the MCP server is authoritative.

## When adding a new tool or skill

Three files must stay in sync or CI fails:

1. The YAML (`tools/<domain>.yaml`) or skill dir (`skills/<name>/`)
2. `scripts/validate.js` — add filename to `toolFiles` array or skill dir to `skillDirs` array
3. `scripts/validate.test.js` — update `setupValidProject` fixtures to match

Tool name must be camelCase ≤64 chars. Skill dir is kebab-case; skill file is uppercase `SKILL.md` with frontmatter `name` + `description`.

Tool YAML must include `inputSchema` (JSON Schema). Annotation rules (extends [`CONTRIBUTING.md`](./CONTRIBUTING.md) § Annotations with the two newer MCP hints):

| Tool verb | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
|-----------|:--------------:|:------------------:|:----------------:|:----------------:|
| `list*`, `get*` | true | false | true | false |
| `create*`, `upload*`, `reserve*` | false | false | false | false |
| `confirm*` | false | false | true | false |
| `terminate*`, `delete*` | false | true | false | false |

`openWorldHint: false` is uniform across all 12 Kobiton tools (server is bounded, not open internet). `idempotentHint` follows verb semantics — read paths and confirmation paths are idempotent; reservation/upload create new resources and are not.

Tool response payloads **must stay under 25,000 tokens** — trim in the backend handler (not the schema).

Skill structure: numbered `### N. Step` blocks, imperative tone written FOR Claude (not the end user), ask on ambiguity / infer from context, always end with an error-handling section and a summary step.

**When adding a new agent** (`agents/<name>.md`):

- Clean Anthropic agent spec only — `name` + `description` + optional `tools` allowlist. Do NOT use deprecated IS-extension fields (`capabilities`, `expertise_level`, `activation_priority`).
- `description` ≤ 200 characters (marketplace warning threshold).
- Body should cite source-of-truth references it reads from (SKILL.md, `references/capabilities.md`, upstream issue references).

**When adding a new hook** (`hooks/scripts/<name>.mjs`):

- **Advisory-only** — no authenticated API calls from hook scripts. The agent has authenticated MCP tools already; hooks only inject text into context.
- Use `${CLAUDE_PLUGIN_ROOT}` not `${CLAUDE_PROJECT_DIR}` in `hooks.json`.
- Exec form only: `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/X.mjs"]`. Not shell form.
- `hookSpecificOutput` envelope for decisions, not top-level `decision` (top-level is silently ignored on PreToolUse).
- Co-locate test file `hooks/scripts/<name>.test.mjs` covering valid input, boundary cases, missing fields, malformed JSON, and PII-leakage negative tests.
- See `hooks/THREAT-MODEL.md` for the 9 threat categories (T1-T9) that any new hook must address.

## Commits & PRs

- **DCO sign-off is required.** Use `git commit -s`. PRs without `Signed-off-by:` will not be merged.
- **Conventional Commits:** `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.
- **Branches:** `feat/…`, `fix/…`, `docs/…`, `chore/…` (kebab-case description).
- **Style:** YAML 2-space, no trailing whitespace; JS no-semicolons, single-quotes, Stroustrup braces; Markdown one-sentence-per-line where practical.
- **Review:** 1 maintainer approval, 3-business-day initial review SLA, stale after 14 days inactive.
- **Releases:** maintainers only — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) § Release Process. Contributors do not bump versions.

## Security

Vulnerabilities in **this plugin** → email `security@kobiton.com` (never a public GitHub issue). Vulnerabilities in the **Kobiton platform** (API, portal, devices) → Kobiton Trust Center.
