# Known Limitations — Kobiton MCP surface

Reference loaded on-demand by `SKILL.md` when the agent encounters a documented behavioural gap. Two batches: the R2 audit (2026-05-04, Intent Solutions pilot) and the post-R3 external audit at [`kobiton/automate#53`](https://github.com/kobiton/automate/issues/53) (mimosa767, 2026-05-18).

Each entry: symptom → upstream issue → severity → agent workaround. When the symptom matches what the user is seeing, follow the workaround. Most fixes require server-side changes at `api.kobiton.com/mcp` — plugin-side mitigations are noted where they exist.

---

## R2 audit entries (filed 2026-05-08)

### `confirmAppUpload` returns before the async parser finishes — [upstream #34](https://github.com/kobiton/automate/issues/34)

**Severity**: High. The tool returns 200 OK with a `versionId` before the platform's app parser has determined READY vs FAILURE_PARSING. Downstream calls (`createSession`, `reserveDevice`) may then fail with no clear root cause.

**Agent workaround**: after `confirmAppUpload` returns, poll `getApp(appId)` until `state` ∈ {`READY`, `FAILURE_PARSING`} before proceeding. Allow up to 60 seconds.

### `FAILURE_PARSING` response body is empty — [upstream #34](https://github.com/kobiton/automate/issues/34)

**Severity**: High. When an upload enters `FAILURE_PARSING`, the API response does not currently carry `parse_error`, `category`, or `message` fields.

**Agent workaround**: surface the bare `FAILURE_PARSING` state to the user with a note that more detail requires checking the Kobiton portal directly.

### `reserveDevice` conflict response lumps four failure modes — [upstream #33](https://github.com/kobiton/automate/issues/33)

**Severity**: High. A `device_unavailable` response can mean: device is offline; device is currently utilizing; device is reserved by another user; or the public-pool target is exhausted. Each implies a different retry strategy, but the current response shape does not distinguish them.

**Agent workaround**: since the underlying mode is not surfaced, retrying the same device may or may not help. The safer default is to broaden the `listDevices` filter and select a different device, or surface to the user.

### `driver.getLogs('logcat'|'browser')` silently fails on the W3C-strict endpoint — [upstream #36](https://github.com/kobiton/automate/issues/36)

**Severity**: Medium. Kobiton's Appium endpoint is W3C-strict; the legacy Selenium `POST /se/log` path returns "Unsupported URI". Older WebdriverIO / Selenium client versions hit this path by default and silently lose log output.

**Agent workaround**: warn the user when their test script uses `driver.getLogs()` with the legacy log API; recommend upgrading the client or switching to the W3C log API.

### Devices enter ~5 minute cleanup cooldown after `terminateSession` — [upstream #36](https://github.com/kobiton/automate/issues/36)

**Severity**: Medium. During cooldown, `reserveDevice` returns the same ambiguous `device_unavailable` as the four conflict modes above.

**Agent workaround**: if `reserveDevice` fails within 5 minutes of a `terminateSession` on the same device, treat the failure as transient cooldown and either wait 5 minutes or select a different device.

### Per-command session data + assertion semantics not exposed — [upstream #37](https://github.com/kobiton/automate/issues/37)

**Severity**: Medium. Session records advertise `execution_data.all_command_data_available: true` and `command_screenshots_available: true`, but no tool currently surfaces the per-command stream, per-command screenshots, or pass/fail assertions. This blocks the `saveTestRun` + IQS test-case CRUD use case at [upstream #24](https://github.com/kobiton/automate/issues/24).

**Agent workaround**: if the user asks to "save this session as a test case", direct them to the Kobiton portal manually — no plugin-side path exists today.

### Read-side shape divergence between `getSession` and `getSessionArtifacts` — [upstream #35](https://github.com/kobiton/automate/issues/35)

**Severity**: Low. The two endpoints use inconsistent field-naming (`device_name` vs `deviceName`, `start_time` vs `startTime`).

**Agent workaround**: normalize field names when comparing data across the two endpoints.

### `xium-portal` live-view URL asymmetry — [upstream #35](https://github.com/kobiton/automate/issues/35)

**Severity**: Low. `liveViewUrl` returns the full Portal view; `deviceOnlyViewUrl` is the same URL with `?view=device-only` appended. The asymmetry is being documented in [upstream PR #29](https://github.com/kobiton/automate/pull/29).

**Agent workaround**: use `liveViewUrl` for full-chrome demos, `deviceOnlyViewUrl` for embeds or device-only sharing.

### `listSessions` 25k-token response cap — [upstream #35](https://github.com/kobiton/automate/issues/35), interacts with [#55](https://github.com/kobiton/automate/issues/55)

**Severity**: High. Claude Code applies a 25k-token cap on MCP tool responses; `listSessions` responses with verbose `execution_data` per session can approach or exceed this cap. Empirically observed in the R2 audit (2026-05-04) that responses near the cap can drop fields or sessions without an explicit error surfaced to the agent. The plugin's [`tools/sessions.yaml`](https://github.com/kobiton/automate/blob/main/tools/sessions.yaml) sets `default: 10` for the `limit` parameter — but per the post-R3 finding at [upstream #55](https://github.com/kobiton/automate/issues/55), the server silently ignores the `limit` value and returns its default page size regardless. The client-side default does not actually constrain the response.

**Agent workaround**: the only reliable mitigation today is to pre-trim the response: page through `offset` accepting that each page returns the server's default count, and slice client-side to whatever subset you actually need. Until [#55](https://github.com/kobiton/automate/issues/55) lands, plan for ~20-session payloads regardless of the requested `limit`.

---

## Post-R3 external audit entries — mimosa767 ([`#53`](https://github.com/kobiton/automate/issues/53), 2026-05-18)

### `listSessions` silently ignores the `limit` parameter — [upstream #55](https://github.com/kobiton/automate/issues/55)

**Severity**: High. Calling `listSessions(limit=N)` returns the server's default page size (20) regardless of N. Combined with the 25k-token MCP cap above, this can push responses near truncation when only a small slice was requested.

**Agent workaround**: treat the returned count as authoritative. If you need a smaller result, slice the returned `sessions` array client-side. If you need a larger result, page via `offset`.

### `getSession` response has no `has_video` indicator — [upstream #56](https://github.com/kobiton/automate/issues/56)

**Severity**: Medium. `video_url: null` conflates "no video recorded for this session" with "video record temporarily unavailable." No boolean signal distinguishes the two.

**Agent workaround**: if `video_url` is null on a `state: COMPLETE` session and the user needs to know whether video exists, call `getSessionArtifacts(sessionId)` as a secondary probe — its `video` key carries a more authoritative signal.

### `getSessionArtifacts` does not return screenshots — [upstream #57](https://github.com/kobiton/automate/issues/57)

**Severity**: Medium. The tool description documents four artifact categories (video, logs, screenshots, test reports). The response carries three (video, logs, testReport). Screenshots are not surfaced.

**Agent workaround**: if the user asks for screenshots, explain the gap and direct them to the Kobiton portal manually. Do not fabricate a "no screenshots available" answer when the underlying API simply doesn't return them.

### `getDeviceStatus` returns only 3 fields; battery and current session info are absent — [upstream #58](https://github.com/kobiton/automate/issues/58)

**Severity**: High. The tool description documents four functional areas: availability, current session info, battery level, and connection state. The response returns `deviceId`, `is_booked` (availability), and `is_online` (binary connection state) — so availability and a coarse online/offline signal are covered, but battery level and current session info are entirely absent, and richer connection detail (Wi-Fi vs cellular vs none, network state) is not exposed.

**Agent workaround**: use `getDeviceStatus` only to answer "is this device free and online right now?". For battery level, network typing, or who's holding the current session, the only path today is to reserve the device and probe inside the session — there is no cheaper read-path.

### `getApp.is_expired` contradicts `listApps.is_expired` for the same app id — [upstream #59](https://github.com/kobiton/automate/issues/59)

**Severity**: Critical. For the same app id in the same minute, `listApps` and `getApp` can return opposite boolean values for `is_expired`. `listApps` also carries the actual `expiry_date` timestamp; `getApp` drops it.

**Agent workaround**: trust `listApps.latest_version.is_expired` as the authoritative source for expiry decisions. Do not gate uploads or session creation on `getApp.is_expired`.

### `uploadAppToStore` response carries v1/v2 doc inconsistency — [upstream #60](https://github.com/kobiton/automate/issues/60)

**Severity**: Low. The response's `confirm_upload.description` references `/v2/apps` while `confirm_upload.path` references `/v1/apps`. The actual `confirmAppUpload` tool doesn't take a version parameter, so this is downstream-consumer confusion rather than a hard failure.

**Agent workaround**: none needed — call `confirmAppUpload` with the `appPath` and `filename` from the response per the tool description; ignore the v1/v2 strings in the `confirm_upload` sub-object.

---

## Reading order anchor for the post-R3 batch

The six post-R3 entries above (F45–F50) are also tracked as the upstream slate at [`kobiton/automate#61`](https://github.com/kobiton/automate/issues/61), and as the fork-side slate at [`jeremylongshore/automate#53`](https://github.com/jeremylongshore/automate/issues/53). Each upstream issue carries the empirical evidence + repro + architectural-fix proposal in full.

For the broader architectural mapping of these gaps to MCP-protocol (L1) / client-implementation (L2) / tool-quality (L3) layers, see [`docs/issue-53-one-pager.md`](../../../docs/issue-53-one-pager.md).
