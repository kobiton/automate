# Contributing to Kobiton Automate

Thanks for your interest in contributing! This guide covers how to get started.

## Getting Started

1. Fork the repo and clone your fork
2. Install dependencies: `pnpm install`
3. Run validation: `pnpm run validate`
4. Run tests: `pnpm test`

## Development Setup

You need:
- Node.js 18+
- pnpm 8+

The repo has no build step. Tool schemas are YAML files in `tools/`, skills are Markdown files in `skills/`.

## Making Changes

### Tool Schema Conventions (`tools/*.yaml`)

Each tool definition must have:
- `name` (camelCase, <= 64 characters)
- `description` (clear, specific to what the tool does)
- `inputSchema` (JSON Schema for arguments)

Optional but recommended:
- `title` (human-readable display name, e.g., "List Test Cases")
- `annotations` with `readOnlyHint` and `destructiveHint`

**Description writing style:**
- Describe what the tool returns or does, not how to call it
- First sentence should be a verb phrase: "List...", "Get...", "Start...", "Terminate..."
- Mention related concepts that help the LLM pick the right tool (e.g., "Test cases are recorded from manual sessions and can be replayed via test runs")

**Annotation rules:**

| Tool type | `readOnlyHint` | `destructiveHint` |
|-----------|----------------|-------------------|
| `list*`, `get*` | `true` | `false` |
| `create*`, `start*`, `upload*`, `reserve*` | `false` | `false` |
| `terminate*`, `delete*` | `false` | `true` |

**Input schema patterns:**
- Mark parameters as `required` only when the tool cannot function without them
- Use `enum` for fixed value sets (e.g., platform: `[ANDROID, IOS]`)
- Provide `default` values for pagination (`page: 1`, `rowsPerPage: 10`)
- Use `description` on every parameter — the LLM reads these to decide what to pass

**Grouping rules** — add new tools to the appropriate existing YAML file:

| File | Scope |
|------|-------|
| `devices.yaml` | Device listing, status, reservations |
| `device-bundles.yaml` | Device bundle / matrix configurations |
| `sessions.yaml` | Session lifecycle and artifacts |
| `apps.yaml` | App listing, details, uploads |
| `automation.yaml` | Starting test sessions (native, Appium) |
| `scriptless-test-management.yaml` | Test cases, suites, runs |

Only create a new YAML file if the tool doesn't fit any existing group.

**Response size:** MCP tool results must stay under 25,000 tokens. If a Kobiton API returns large payloads, trim unnecessary fields in the dlm/api handler (not in the YAML schema).

### Skill Conventions (`skills/*/SKILL.md`)

Each skill file must have YAML frontmatter with `name` and `description`.

**Structure:**
- Numbered steps (`### 1. Step name`) — each step maps to one tool call or user decision
- Steps should flow linearly: gather info -> confirm with user -> execute -> report results

**Writing style:**
- Imperative tone, written FOR Claude (the AI), not for the end user
- "Ask the user which device to target" not "You should ask the user..."
- "Call `listDevices` with the relevant platform filter" not "The listDevices tool can be used to..."

**When to ask the user vs infer:**
- Ask: ambiguous choices (which device, which app, which session type)
- Infer: values available from context (platform from app type, device from previous step)

**Tool references:**
- Use backtick-wrapped tool names matching the YAML `name` field exactly: `` `listTestCases` ``
- When a step uses multiple tools conditionally, explain when to use each

**Error handling:**
- Include guidance for common failure modes (device not available, upload timeout, session terminated unexpectedly)
- Always end with a summary step that presents results to the user

### Adding New Tools or Skills to Validation

When you add a new tool YAML file or skill directory:

1. Add the filename to the `toolFiles` array in `scripts/validate.js`
2. Add the skill directory name to the `skillDirs` array in `scripts/validate.js`
3. Update the test fixtures in `scripts/validate.test.js` (`setupValidProject` function)
4. Run `pnpm run validate && pnpm test` to confirm

### Validation

Before submitting, ensure both pass:

```bash
pnpm run validate   # checks all YAML schemas, skill frontmatter, plugin manifests
pnpm test           # runs unit tests
```

## Branch Naming

Use a prefix that describes the type of change, followed by a short kebab-case description:

| Prefix | Use for | Example |
|--------|---------|---------|
| `feat/` | New tools, skills, or capabilities | `feat/add-crash-logs-tool` |
| `fix/` | Bug fixes | `fix/validate-skill-case` |
| `docs/` | Documentation only | `docs/update-troubleshooting` |
| `chore/` | CI, deps, repo maintenance | `chore/update-ci-workflow` |


## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short description>

[optional body]
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`

Examples:
```
feat: add getSessionLogs tool
fix: correct SKILL.md case in validator
docs: add OAuth troubleshooting steps
chore: bump pnpm to v9
```

## Developer Certificate of Origin (DCO)

All contributions must be signed off to certify you have the right to submit them under the MIT License. Add a `Signed-off-by` line to your commits:

```bash
git commit -s -m "feat: add getSessionLogs tool"
```

This adds:
```
Signed-off-by: Your Name <your.email@example.com>
```

By signing off, you agree to the [Developer Certificate of Origin](https://developercertificate.org/). PRs without sign-off will not be merged.

> **Tip:** Configure git once with `git config --global user.name "Your Name"` and `git config --global user.email "your@email"`, then always use `git commit -s`.

## Pull Request Process

1. Create a branch from `main` following the naming convention above
2. Make your changes in focused, logical commits (signed off with `-s`)
3. Run `pnpm run validate && pnpm test` locally
4. Open a PR against `main` using the PR template
5. Wait for CI to pass and a maintainer to review

## Review Expectations

- All PRs require **1 maintainer approval** before merge
- Maintainers aim to provide initial review within **3 business days**
- Trivial fixes (typos, formatting) may be merged directly by maintainers
- For new tools or skills, expect discussion on naming, description quality, and schema design
- If your PR goes stale (no activity for 14 days after review feedback), a maintainer may close it with a note — feel free to reopen when ready

## Issue Labels

We use these labels to triage issues and PRs:

| Label | Description |
|-------|-------------|
| `bug` | Something isn't working |
| `enhancement` | New tool, skill, or improvement |
| `documentation` | Docs, README, CONTRIBUTING changes |
| `good-first-issue` | Simple and well-scoped — great for new contributors |
| `help-wanted` | Community contributions welcome |
| `breaking-change` | Requires a major version bump |
| `needs-triage` | Not yet reviewed by a maintainer |
| `wontfix` | Out of scope or not planned |

Issues with no activity for **60 days** may be closed as stale. If the issue is still relevant, comment to reopen it.

## Reporting Issues

Use the [issue templates](https://github.com/kobiton/automate/issues/new/choose) for bug reports and feature requests.

For security vulnerabilities, see [SECURITY.md](SECURITY.md).

## Code Style

- **YAML**: 2-space indentation, no trailing whitespace
- **Markdown**: one sentence per line where practical
- **JavaScript** (validation scripts): no semicolons, single quotes, Stroustrup braces
- **Tool names**: camelCase (e.g., `listTestCases`, `getSessionArtifacts`)
- **Skill directories**: kebab-case (e.g., `run-automation-suite/`)
- **Skill files**: uppercase `SKILL.md`

## Versioning

This project follows [Semantic Versioning](https://semver.org/):

- **Major** (2.0.0): Breaking changes to tool schemas or skill contracts
- **Minor** (1.1.0): New tools, skills, or backward-compatible enhancements
- **Patch** (1.1.1): Bug fixes, documentation, non-functional changes

## Release Process

Releases are managed by maintainers only. The process:

1. Update `version` in `.claude-plugin/plugin.json`
2. Add a new section to `CHANGELOG.md` following the existing format
3. Commit: `chore: release vX.Y.Z`
4. Tag: `git tag vX.Y.Z`
5. Push: `git push origin main --tags`
6. Create a GitHub Release from the tag with the changelog entry as the body

Contributors do **not** need to bump versions or update the changelog — maintainers handle this during release.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
