# `run-automation-suite` cross-client architecture — one-pager

**Response to [`kobiton/automate#53`](https://github.com/kobiton/automate/issues/53)**

This is the one-pager committed to in [`#53` comment-4481683618](https://github.com/kobiton/automate/issues/53#issuecomment-4481683618). It maps each ask in `#53` to one of three architectural layers so Kobiton can decide where each lever lives, lands soonest, and is worth investing in. It is a structural / decision-support doc, not a roadmap.

---

## TL;DR

- **`#53` asks span three architectural layers**: the MCP protocol (where SEP proposals live; multi-quarter horizon), the client implementation (skill loader, `allowed-tools` parser, sandboxed shell + FS — Claude Code and, on the evidence available today, likely Cowork), and tool quality (server-side gaps in `api.kobiton.com/mcp` that affect every MCP client equally).
- **The single highest-leverage near-term lever appears to be Cowork.** Per the [Cowork extensions docs](https://claude.com/docs/cowork/3p/extensions), Cowork uses the same `.claude-plugin/plugin.json` manifest path and supports the same extension types (MCP, skills, hooks, sub-agents) as Claude Code. Cross-surface plugin portability has not been documented by Anthropic and is pending an actual Cowork install test of `run-automation-suite` we've already committed to in `#53`. Cowork also runs a sandboxed Ubuntu 22.04 VM on macOS, reaches user-selected local folders, and has had a plugin marketplace since 2026-02-24, so the structural prerequisites for the workflow are in place.
- **The six server-side findings @mimosa767 surfaced in the audit comment are filed as actionable upstream issues with empirical evidence**: [`#55`](https://github.com/kobiton/automate/issues/55) – [`#60`](https://github.com/kobiton/automate/issues/60) with reading-order anchor [`#61`](https://github.com/kobiton/automate/issues/61). These are the tool-quality column and they lift every MCP client equally when fixed.

---

## The three architectural layers

| Layer | What lives here | Horizon | Who owns it |
|---|---|---|---|
| **L1 — Protocol** | MCP spec — declarative tool chaining ([SEP-1610](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1610)), file-input semantics ([SEP-2356](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2356)), resource streaming ([SEP-2532](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2532)), DCR ([SEP-1032](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1032)), Skills-as-MCP-primitive ([SEP-2640](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640)). SEP proposals tracked at [`modelcontextprotocol`](https://github.com/modelcontextprotocol/modelcontextprotocol). | Multi-quarter; nothing imminent. | MCP working group (Anthropic + community) |
| **L2 — Client implementation** | Skill loader (parses `SKILL.md` frontmatter), `allowed-tools` permission model, sandboxed local shell + FS, plugin install path, scheduled tasks, remote/local MCP transport. | Lands when a Claude client ships it. | Anthropic (per surface) |
| **L3 — Tool quality** | Behaviour and shape of the 12 tools at `api.kobiton.com/mcp`. Bugs, missing fields, contradiction between read endpoints, ignored parameters, response-builder inconsistencies. | Lands on Kobiton's server release cadence. | Kobiton |

A correct architectural answer to a `#53` ask is one of these three layers. Some asks (notably 4 and 6 below) span L1 and L3 — the framework names the layers so the tradeoffs are visible, not to imply each ask lives in only one. Conflating layers (e.g., "Claude Desktop can't run the skill because of the MCP protocol") obscures what's actually fixable and on what timeline.

---

## Mapping each `#53` ask to its layer

### Ask 1 — Reduce visible dependency on Claude

| Layer | What this looks like at this layer |
|---|---|
| **L1 (protocol)** | None directly. Protocol-level work doesn't change customer perception. |
| **L2 (client implementation)** | High leverage. The customer-visible "dependency on Claude" is largely the surface choice. Cowork is a Claude-branded but visually-distinct desktop app aimed at non-technical users; Claude Code is terminal-first. Routing the workflow into Cowork makes it feel like a desktop testing app, not a CLI tied to a separate Claude license. |
| **L3 (tool quality)** | None directly. |

**Recommendation:** Position `run-automation-suite` as a Cowork-installable plugin (the manifest format matches Claude Code's per the Cowork extensions doc; cross-surface portability is pending the install test we already committed to). The Cowork brand surface materially reduces the "buy Claude separately" perception for tester-heavy orgs.

---

### Ask 2 — Claude Desktop parity

| Layer | What this looks like at this layer |
|---|---|
| **L1 (protocol)** | None for the orchestration itself; only the standardized file-input semantics ([SEP-2356](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2356)) would obviate the local-Appium-toolchain assumption. Multi-quarter. |
| **L2 (client implementation)** | This is where the ask actually lives. Claude Desktop is not currently documented as a Skills-capable surface — the [Skills support article](https://support.claude.com/en/articles/12512180-use-skills-in-claude) lists Claude Code, Cowork, Excel, PowerPoint, and claude.ai web, and does not mention Claude Desktop. The absence in that doc is the basis for our recommendation to verify via Cowork rather than port to Desktop. **Cowork has the skill loader and a sandboxed shell already.** The near-term answer to "Claude Desktop parity" is actually "Cowork parity, which gets you most of what testers want and lands today." |
| **L3 (tool quality)** | None directly. |

**Recommendation:** Reframe "Claude Desktop parity" as "Cowork-first" in customer-facing docs. Run a Cowork install test of `run-automation-suite` to confirm `allowed-tools` identifiers bind cleanly. If they don't, the frontmatter adjustment is small. A direct Claude Desktop port would require Anthropic to ship a skill loader in Desktop — bigger lift, not on our side to pull forward.

---

### Ask 3 — Simplified tester-first workflows

| Layer | What this looks like at this layer |
|---|---|
| **L1 (protocol)** | [SEP-1610 declarative multi-step tool chaining](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1610) reduces the number of orchestrated calls a client must make. Multi-quarter horizon, not a near-term lever. |
| **L2 (client implementation)** | Cowork + Dispatch (the phone→Cowork task delegation feature shipped 2026-03-17) makes "tester triggers from phone, Cowork executes on desktop" a real workflow today. Cowork's [scheduled tasks](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork) covers the "nightly regression" pattern. |
| **L3 (tool quality)** | The 6 audit findings (`#55`–`#60`) all touch the tester experience: silent `limit` parameter, missing `has_video` indicator, missing `screenshots` artifact category, etc. Each one fixed makes a tester-driven workflow more reliable. |

**Recommendation:** The tester-first workflow lives at L2 + L3 in combination. Cowork + Dispatch as the surface, the 6 server-side fixes as the tool quality. Neither alone is the answer.

---

### Ask 4 — Native-feeling AI orchestration

| Layer | What this looks like at this layer |
|---|---|
| **L1 (protocol)** | [SEP-1610](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1610) (declarative chaining) is the protocol-level move toward "less client-side orchestration." Worth tracking, not blocking on. |
| **L2 (client implementation)** | Limited lever here — "native-feeling" is partly a UI / brand decision (Cowork helps; Claude Code's terminal-first feel hurts), and partly the absence of skill-loader auto-orchestration on non-Code/Cowork surfaces. |
| **L3 (tool quality)** | **High leverage.** A server-side consolidated upload flow (e.g., a single tool that takes a URL or staging-uploaded reference and handles the three-step `uploadAppToStore` → PUT → `confirmAppUpload` dance internally) compounds with where the spec is going and lifts every MCP client equally. The async-race condition documented in [upstream #34](https://github.com/kobiton/automate/issues/34) is the canonical example — fixing it server-side removes orchestration steps from every client. |

**Recommendation:** L3 is the lever with the best cost-to-value ratio. Kobiton-side orchestration consolidation lands sooner than any L1 SEP and lifts Claude Code, Cowork, Claude Desktop, mobile, and any future MCP client equally.

---

### Ask 5 — Better messaging / documentation

| Layer | What this looks like at this layer |
|---|---|
| **L1 (protocol)** | None. |
| **L2 (client implementation)** | This whole doc + the [Claude surface matrix](#claude-surface-matrix-reference) below + a future README "what runs where" section is exactly this lever. Customer-facing clarity comes from naming the surfaces and what each one can and can't do. |
| **L3 (tool quality)** | None directly. |

**Recommendation:** The Claude surface matrix below is the spine. A `README.md` "Compatibility" section can be derived from it directly. README PR is one of the three end-of-week commitments from [`#53` comment-4481683618](https://github.com/kobiton/automate/issues/53#issuecomment-4481683618).

---

### Ask 6 — Potential future product direction (test generation / requirement parsing / execution orchestration / validation native to Kobiton Automate)

| Layer | What this looks like at this layer |
|---|---|
| **L1 (protocol)** | Standardized file-input ([SEP-2356](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2356)) and resource streaming ([SEP-2532](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2532)) are the protocol primitives that make "client uploads a script, server executes it" tractable. Multi-quarter. |
| **L2 (client implementation)** | A bundled host (covered in a separate sketch — see [`#53` comment-4481683618](https://github.com/kobiton/automate/issues/53#issuecomment-4481683618)) is the implementation-layer expression of "AI native to Kobiton." Three near-term variants worth contrasting: staging-upload pattern, bundled host owns the file picker, Kobiton-hosted test runner. |
| **L3 (tool quality)** | **High leverage if scope expands.** A test-generation tool, requirement-parsing tool, validation tool — each is a new MCP tool at `api.kobiton.com/mcp` that any client can call. Adding them to the existing 12-tool surface is cheaper than building new client implementations. |

**Recommendation:** L3 is the cheapest scope expansion path. Adding `generateTests`, `parseRequirements`, `executeTestRun`, `validateRun` as MCP tools on `api.kobiton.com/mcp` lifts every Claude client and every other MCP client (Cursor, Windsurf, Codex CLI, Gemini CLI, custom code via the API+MCP Connector) without bespoke per-client implementation work.

---

## Claude surface matrix (reference)

Cross-cutting reference for the analysis above. Verified via direct doc fetches 2026-05-18 (see [`#53` comment-4482806767](https://github.com/kobiton/automate/issues/53#issuecomment-4482806767) for per-cell citations).

| # | Surface | Local FS | Local shell | Local stdio MCP | Remote MCP | Loads `.claude-plugin/` skills |
|---|---|:---:|:---:|:---:|:---:|:---:|
| 1 | **claude.ai (web)** | ❌ | ⚠️ Code Execution Tool (beta) | ❌ | ✅ | ⚠️ Customize > Skills |
| 2 | **claude.ai/code (cloud sandbox)** | ❌ user, ✅ cloud | ✅ in cloud sandbox | ❌ | ✅ | ✅ marketplace-installed |
| 3 | **Claude Desktop** | ✅ via `server-filesystem` MCP | ✅ via stdio MCP | ✅ stdio + `.dxt`/`.mcpb` | ✅ HTTP + optional OAuth | ❌ not currently documented as a Skills surface |
| 4 | **Claude Code** (CLI/IDE) | ✅ native | ✅ native + `/sandbox` | ✅ | ✅ | ✅ |
| 5 | **Claude Cowork** | ✅ user-selected folders | ✅ Ubuntu 22.04 VM (macOS) | ✅ | ✅ | ⚠️ likely — see note below table |
| 6 | **Claude for Chrome** | ❌ browser-scoped | ❌ | ❌ | ✅ via paired claude.ai | ❌ |
| 7 | **Claude mobile** (iOS/Android) | ❌ | ❌ | ❌ | ✅ use-only (configure via web) | ❌ |
| 8 | **Claude Code Remote Control** | inherits paired Claude Code | inherits | inherits | inherits | inherits |
| 9 | **Claude Dispatch** | inherits paired Cowork | inherits | inherits | inherits | inherits |
| 10 | **Claude API + MCP Connector** | depends on host | depends on host | ✅ | ✅ | n/a |

**Plugin marketplace** (cross-cutting, not a surface). [`claude.com/plugins`](https://claude.com/plugins) is Anthropic's official catalog. Its "Works with" filter exposes exactly two install destinations: **Claude Code and Cowork**.

**Note on row 5 (Cowork `.claude-plugin/` skill loading):** Cowork uses the same `.claude-plugin/plugin.json` manifest path and supports the same extension types (MCP, skills, hooks, sub-agents) as Claude Code per the [Cowork extensions doc](https://claude.com/docs/cowork/3p/extensions). Cowork also runs a sandboxed Ubuntu 22.04 VM on macOS, reaches user-selected local folders, and supports MCP servers per the [Cowork get-started article](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork). Drop-in plugin portability between Claude Code and Cowork is not formally documented by Anthropic; the install test referenced in the Recommended near-term path below is the empirical step that would close the question.

---

## The tool-quality column — the 6 audit findings from `#53`

@mimosa767's audit reply at [`#53` comment-4476188526](https://github.com/kobiton/automate/issues/53#issuecomment-4476188526) surfaced six server-side findings. All filed upstream with empirical evidence (5 of 6 re-probed against `api.kobiton.com/mcp`; the v1/v2 doc inconsistency is schema-only). Reading-order anchor: [`#61`](https://github.com/kobiton/automate/issues/61).

| Upstream | Tool | Symptom | Severity |
|---|---|---|---|
| [`#55`](https://github.com/kobiton/automate/issues/55) | `listSessions` | `limit` parameter silently ignored | High |
| [`#56`](https://github.com/kobiton/automate/issues/56) | `getSession` | No `has_video` indicator field | Medium |
| [`#57`](https://github.com/kobiton/automate/issues/57) | `getSessionArtifacts` | Documented `screenshots` category absent | Medium |
| [`#58`](https://github.com/kobiton/automate/issues/58) | `getDeviceStatus` | Only 3 fields returned; battery + current session info absent (`is_online` covers coarse connection state) | High |
| [`#59`](https://github.com/kobiton/automate/issues/59) | `getApp` vs `listApps` | `is_expired` contradiction for same app id | Critical |
| [`#60`](https://github.com/kobiton/automate/issues/60) | `uploadAppToStore` | Response `confirm_upload.description` vs `.path` v1/v2 contradiction | Low |

Plugin-side close-out for each (a documented working knowledge entry + agent workaround per finding) is in this PR — the previously documented `listSessions` 25k-token-cap entry has also been amended in this PR to acknowledge that [`#55`](https://github.com/kobiton/automate/issues/55) invalidates its prior client-side `limit=10` mitigation, since the server ignores the `limit` value. The full set of entries now lives at [`skills/run-automation-suite/references/known-limitations.md`](../skills/run-automation-suite/references/known-limitations.md) (loaded on-demand by `SKILL.md` per Anthropic's Agent Skills progressive-disclosure pattern, rather than inlined every invocation).

---

## Recommended near-term path

Ordered by leverage (highest to lowest):

1. **L3 / tool-quality fixes (issues [#55](https://github.com/kobiton/automate/issues/55)–[#60](https://github.com/kobiton/automate/issues/60)).** Kobiton-owned, lift every MCP client. Six discrete server-side fixes with empirical evidence already on hand.
2. **L2 / Cowork install test.** Confirm `run-automation-suite` loads and runs in Cowork. If it does (most likely, given the manifest-path equivalence + extension-types overlap documented at [Cowork extensions](https://claude.com/docs/cowork/3p/extensions)), this answers ask 1 (perceived Claude dependency reduction), most of ask 2 (Claude Desktop parity → reframed as Cowork-first), and the surface-level half of ask 3 (tester-first workflows via Cowork + Dispatch). One-afternoon scope.
3. **L3 / orchestration consolidation.** Server-side consolidated upload + run flows (one tool wraps the multi-step dance). Bigger Kobiton-side scope; biggest cross-client payoff.
4. **L1 / SEP tracking, not SEP blocking.** Watch SEP-1610, SEP-2356, SEP-2532, [SEP-2640](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640) land. None are gating any of the above.

---

## What this one-pager is NOT

- **Not a roadmap.** Each layer's prioritization is Kobiton's decision; this doc maps the levers, not the commit.
- **Not the bundled-host sketch.** A separate sketch — published as the public gist [Bundled-host architectural sketch — Kobiton Automate plugin](https://gist.github.com/jeremylongshore/8e6325b6bb2b438d9fa6d8d9161c3a54) — covers the L2 architectural variants for "AI native to Kobiton Automate" (`#53` ask 6). Four named variants (hybrid pattern; staging-upload; bundled host with file picker; Kobiton-hosted test runner) with tradeoff analysis.
- **Not the README compatibility-matrix PR.** The README PR is the customer-facing distilled version of the surface matrix above. Different audience, different format.

---

## References

- Source issue: [`kobiton/automate#53`](https://github.com/kobiton/automate/issues/53)
- Audit comment (6 server-side findings): [`#53` comment-4476188526](https://github.com/kobiton/automate/issues/53#issuecomment-4476188526)
- Architectural correction (claude.ai web vs Claude Desktop conflation, shim idea): [`#53` comment-4482315819](https://github.com/kobiton/automate/issues/53#issuecomment-4482315819)
- Delivery commitments: [`#53` comment-4481683618](https://github.com/kobiton/automate/issues/53#issuecomment-4481683618)
- Surface matrix (with full per-cell citations): [`#53` comment-4482806767](https://github.com/kobiton/automate/issues/53#issuecomment-4482806767)
- Upstream findings slate anchor: [`kobiton/automate#61`](https://github.com/kobiton/automate/issues/61)
- Plugin-side documented working knowledge: [`skills/run-automation-suite/references/known-limitations.md`](../skills/run-automation-suite/references/known-limitations.md)
- **Bundled-host architectural sketch (companion artifact for `#53` ask 6):** [public gist `8e6325b6`](https://gist.github.com/jeremylongshore/8e6325b6bb2b438d9fa6d8d9161c3a54) — four-variant tradeoff analysis with mermaid diagrams

Anthropic docs verified by direct fetch 2026-05-18:

- [Cowork extensions / 3p plugins](https://claude.com/docs/cowork/3p/extensions) — manifest path + extension types match Claude Code's
- [Get started with Claude Cowork](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork) — sandboxed VM + folder selection + MCP support
- [Use Skills in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude) — Claude Desktop omitted from listed Skills surfaces
- [Custom Connectors](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities)
- [Local MCP servers on Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
- [Code Execution Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool)
- [Claude for Chrome](https://claude.com/blog/claude-for-chrome)
- [Dispatch in Claude Cowork tutorial](https://claude.com/resources/tutorials/dispatch-in-claude-cowork)
- [Claude Code Remote Control](https://code.claude.com/docs/en/remote-control)
- [Help Center release notes](https://support.claude.com/en/articles/12138966-release-notes)
- [Claude Code changelog](https://code.claude.com/docs/en/changelog)
