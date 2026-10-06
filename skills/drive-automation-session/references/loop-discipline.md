# Loop Discipline

The skill is turn-based. Each turn, the AI host runs **exactly one** of three branches against `appium.js`: observe (`screen`), act (an Appium call), or control (end the cycle). The branch the host picks depends on what happened the previous turn — see "Branch decision guide" below.

## One branch per turn

Every `appium.js` call with `--session-dir` takes one timestamp `<ts>` (epoch seconds) and names all of its artifacts with it; when two calls land in the same second, the later one takes the next free second, so names stay unique and sort in call order.

| Branch | Command | Effect |
|---|---|---|
| **screen** | `node appium.js screen --session-id <id> --session-dir <d>` [`--xml-only` \| `--png-only`] [`--full`] | Default writes the lean `source-<ts>.xml`, the raw `source-<ts>.full.xml` and `screenshot-<ts>.png`. Prints `{ts, source, fullSource, screenshot, hash, mode, xmlBytes, fullXmlBytes, pngBytes}` on stdout. What to read is in [`webdriver.md` § Observe](webdriver.md#observe). |
| **act** | `node appium.js <argv> --session-dir <d>` | Issues the Appium call. Prints the raw response body on stdout (success) or `{status}` plus the body on stderr (any failure: Appium error, network, parse, usage). Writes `request-<ts>.json` + either `response-<ts>.json` or `error-<ts>.json` with the same content. |
| **control** | `node appium.js control --done\|--blocked --reason "..." --session-dir <d>` | Writes `control-<ts>.json` and prints it with `ts`; no HTTP call. Signals the host to end the cycle. |

The host picks one branch per turn. The script always exits 0; a call failed when it printed to stderr (and wrote `error-<ts>.json`).

### Why PNG is captured by default

Native overlays (Chrome's "notifications" welcome card, OS-level permission prompts, system dialogs that appear over the app/webview) are NOT reflected in the webview's `/source` XML — the chromedriver page-source layer only sees the in-page DOM, not what's drawn on top. A turn that captures XML-only can completely miss a blocking dialog and lead the host to act on a stale picture.

The first pilot run hit exactly this: it opened Chrome, captured `about:blank` XML, and tried to navigate without seeing the "Chrome notifications make things easier — Continue / No thanks" welcome card. PNG-by-default catches that class of failure on iteration 1.

`--xml-only` captures the source and no screenshot — for turns where nothing can be drawn over the source (e.g., confirming a hash change on a known-stable native screen). `--png-only` captures the screenshot and no source — for verification turns where layout is the only signal that matters (e.g., confirming an animation finished, checking image rendering). Capturing a file and reading it are separate choices: [`webdriver.md` § Observe](webdriver.md#observe) says when the screenshot and the full source are worth reading.

## Branch decision guide

Pick the next turn's branch based on what just happened:

| Previous turn outcome | Next branch | Why |
|---|---|---|
| `screen` just ran | **act** | You have a fresh observation; decide what to do. |
| `act` succeeded | **screen** | The screen probably changed; observe before the next decision. |
| `act` returned `no such element` / `invalid selector` / `invalid argument` / bad-input | **act** (again, with a corrected call) | The action didn't fire, so the screen didn't change. The latest `source-<ts>.xml` is still current — re-read it from disk if needed; don't burn a turn on a fresh `screen`. A second `no such element` on the same target is the cue to open the matching `source-<ts>.full.xml` ([`webdriver.md`](webdriver.md#when-to-open-the-full-source)). |
| `act` returned `stale element reference` | **screen** | The element id is from a prior state; you need fresh element ids from a new observation. |
| `act` returned HTTP 5xx / network timeout | **act** (retry the same call) | Transient failure; retry once. If it fails twice, `control --blocked`. |
| Goal reached | **control --done** | End the cycle cleanly. |
| Stuck (per "Stuck patterns" below) | **control --blocked** | End the cycle and surface the reason to the user. |

The host is responsible for remembering which `source-<ts>.xml` represents the current screen state — `screen` prints its name. After a successful `act`, the latest `source-<ts>.xml` is stale until the next `screen`. After a failed `act`, it is still current.

For how to construct the `act` call from the observed XML — selectors, the find-then-act workflow, when to fall back to coordinates — see [`webdriver.md`](webdriver.md); for how `appium.js` sends it, [`endpoint-reference.md`](endpoint-reference.md).

## Artifact layout

```
.kobiton/sessions/<session-id>/
  caps.json                       ← desired caps used to open the session
  request-1759700000.json         ← {argv: [...]} — what the host invoked (screen and act calls)
  source-1759700000.xml           ← lean view of the page source (unfiltered with `--full`); see webdriver.md § Observe
  source-1759700000.full.xml      ← raw /source — the escape hatch; written whenever the source is captured
  screenshot-1759700000.png       ← skipped only when `--xml-only` is passed
  response-1759700000.json        ← the call's stdout on success (raw Appium response; for `screen`, its JSON line)
  request-1759700004.json
  error-1759700004.json           ← the call's stderr on failure (line 1 = {status}; line 2+ = body)
  ...
  control-1759700031.json         ← only when the host emitted `control` (instead of an Appium call)
  session.log                     ← human-readable timeline
```

Every file one call writes shares its `<ts>`, and timestamps increase in call order.
Workspace-relative, NOT `/tmp`, with the same `<kind>-<ts>.<ext>` names `run-interactive-session` uses, so post-session tooling (test-case authoring, video pickup) finds artifacts in the same place.

## Iteration ceiling

Hard cap at `MAX_ITERS=100` iterations per session, counted from disk: every `screen` and `act` call writes one `request-<ts>.json`, so their number is the turn count. When the count reaches the cap, end with `exit 0`; the trap cleans up. Override per session with `MAX_ITERS=<n>`. Disk is not rotated (a 100-turn session is ~50MB worst case with screenshots); the workspace's per-session directory is the user's to clean up.

This is a pure safety net against runaway cycles (host logic bugs, pathological flows). It is NOT the stuck-detection mechanism — see "Stuck patterns" below. Most real flows complete in 10-30 turns, well under the cap.

## Stuck patterns — host decides

The script does NOT enforce blocker thresholds. There is no `N_REPEAT`, no `N_UNCHANGED`, no `LAST_*` shell var. Mobile-Appium behavior is too diverse for fixed thresholds — a screen unchanged for 5 turns is normal during a lazy-load wait, but pathological after a tap on a "Submit" button. Only the AI host has the conversation context (intent, prior actions, prior observations) to make that call.

What the script provides:

- **`screen` prints `{ts, hash, …}`** on stdout. Track the hash across turns in your conversation context to detect repetition.
- **`request-<ts>.json`** — every prior call's audit, available for re-reading.
- **`error-<ts>.json`** — full raw Appium error from any recoverable failure.

What the host decides:

- When to keep going.
- When to wait (re-run `screen` without an act — a "no-op observe" turn).
- When to emit `control --blocked` to pause and ask the user.
- When to emit `control --done` because the intent is satisfied.

### Stuck-pattern examples

#### 1. Same-call repetition (selector misses)

You tapped an xpath, got `no such element`. You try the same xpath again, same error. Two consecutive identical recoverable errors on the same selector → that selector is wrong. Either pick a different strategy/value, or `control --blocked` if you genuinely can't tell what the right selector is.

```
turn 5: actions --session-id S --type touch ...  → "no such element"
turn 6: actions --session-id S --type touch ...  → "no such element"
       (same argv, same error)
Decision: don't repeat a third time. Open the latest source-<ts>.full.xml for
the element's real attributes (webdriver.md § Observe) and build a different
selector, or control --blocked with reason "selector missed twice; need user".
```

#### 2. Screen oscillation (A → B → A)

You tapped to navigate to B, then tapped back to A. Your conversation memory shows this hash existed two turns ago. Programmatic same-call detection misses this (the argvs differ); only your context catches it.

```
turn 3: hash=aaa…  (Settings screen)
turn 4: tap "Bluetooth" → hash=bbb… (Bluetooth screen)
turn 5: tap "Back" → hash=aaa… (Settings screen again)
turn 6: tap "Bluetooth" → hash=bbb…
turn 7: tap "Back" → hash=aaa…
       (your prior 4 turns formed an A-B-A-B loop)
Decision: control --blocked with reason "navigated in a circle between
Settings and Bluetooth without completing the intent".
```

#### 3. Lazy load / no visible animation

You tapped a "Load more" button. The list re-fetches over the network with no spinner. The hash from `screen` doesn't change for several turns. Don't panic — the page is loading. Re-run `screen` as a no-op observe to wait.

```
turn 8: tap "Load more"
turn 9: screen → hash=X (page still loading)
turn 10: screen (no act) → hash=X
turn 11: screen → hash=Y (page rendered)
Decision: re-emit `screen` for as many turns as the use case suggests is
reasonable. Track the hash yourself; an unchanged hash is data, not a
deadline.
```

A useful timeout heuristic: ~10–15 no-op-observe turns ≈ 30s at typical Appium latency. If the screen still hasn't changed by then, that's evidence (not proof) the load failed — re-tap, change strategy, or `control --blocked`.

#### 4. Credentials prompt / OAuth / WebView login

The screen shows a username/password form, a "Sign in with Google" SSO redirect, or any flow that needs human input the host can't supply. This is a hard block — emit `control --blocked` immediately.

```
Decision: control --blocked with reason "Sign-in screen detected; need user
credentials to proceed".
```

#### 5. CAPTCHA / robot-check

Visual challenges, slider puzzles, reCAPTCHA iframes. Same as #4 — emit `control --blocked`.

#### 6. Network spinner indefinitely

A spinner is present in the source XML and isn't going away. After enough no-op observes (your judgment — typically ≥10 turns with no change AND a visible spinner), conclude the request is hung.

```
Decision: control --blocked with reason "Network request stuck for ~30s;
recommend retry or check connectivity".
```

#### 7. Modal stack you can't dismiss

Two modals overlap. Tapping the visible one's dismiss button doesn't reach the underlying one.

```
Decision: control --blocked with reason "Two stacked modals; the top one
won't dismiss with available controls". User may need to suggest a swipe
or a hardware-back-button approach.
```

When you emit `control --blocked`, post one concise line in the conversation: `I can't make progress. <observed condition>. What would you like me to do?` — actionable, lets the user redirect.

## Termination

The cycle ends when **any one** of these is true:

- AI host runs `node appium.js control --done --reason "..."`. Reason is appended to `session.log`; the trap ends the WebDriver session.
- User issues a stop command (or Ctrl-C). The trap cleans up.
- Kobiton platform-side session termination. The next `appium.js` call returns exit 3 with `error: session-not-found` or `error: invalid session id`. The trap cleans up (no-op since the session is already gone).

There is no arbitrary action-count cap. There is no wall-clock cap inside this skill. The platform-side session-duration cap (set by the org plan; not configurable here) is the absolute ceiling.

## Try/finally cleanup contract

```bash
SESSION_ID=""
trap 'cleanup' EXIT INT TERM

cleanup() {
  [ -z "$SESSION_ID" ] && return 0
  delete_err=$(node "$SCRIPT_DIR/scripts/appium.js" \
    --method DELETE --url "/session/$SESSION_ID" 2>&1 >/dev/null)
  if [ -z "$delete_err" ]; then
    printf '%s session=%s end-via-trap status=COMPLETE\n' "$(date -u +%FT%TZ)" "$SESSION_ID" >> "$SESSION_DIR/session.log"
  else
    printf '%s session=%s end-via-trap delete-failed err=%s\n' "$(date -u +%FT%TZ)" "$SESSION_ID" "$delete_err" >> "$SESSION_DIR/session.log"
  fi
}
```

`appium.js` treats `DELETE /session/{id}` returning 404 as success (idempotent), so the trap is safe to fire even if the session has already been ended by the loop's DONE path or by Kobiton's platform-side cap. The `DELETE` is the **only** cleanup path — it ends the WebDriver session cleanly and Kobiton records the session state as `COMPLETE`.

Do NOT call the `terminateSession` MCP tool as a belt-and-braces follow-up: it marks the session `TERMINATED` (treated as an abnormal exit by the recording pipeline, distinct from `COMPLETE`). Reserve it for the force-kill case where the `DELETE` is genuinely unreachable AND the user asks to force-kill. If the `DELETE` fails silently, the session times out on its own per `appium:newCommandTimeout` — preferable to a `TERMINATED` mark.

## Reading errors

`appium.js` exits 0 for **all** Appium calls — successful and failed. The script does NOT classify "recoverable" vs "fatal". That classification is the host's judgment, made by reading the failed call's stderr (and the prior conversation context).

When a call fails, stdout is empty and stderr carries the error: `{status}` plus the raw body for an HTTP error, or the script's own `{error, message}` JSON when the call never reached the server. `error-<ts>.json` holds the same error:

- **Line 1:** a `{status}` JSON summary (HTTP status code; `0` for runtime errors like timeout / parse / network).
- **Line 2+:** the raw response body verbatim. For Appium HTTP errors this is typically `{value: {error, message, stacktrace}}`. For runtime errors (script never reached the server) it's the script's own `{error, message}` JSON. For non-Appium error pages (HTML, plaintext from a misconfigured proxy, etc.) it's whatever the server sent.

The host detects failure by the call's stderr output (the per-turn bookkeeping in SKILL.md also checks for `error-<ts>.json`). Read it before emitting the next turn's call.

### Re-plannable Appium errors (typically: continue, try again)

The W3C error values where the right move is usually a re-plan — `no such element`, `stale element reference`, `invalid selector`, `invalid argument`, `timeout` — and the next move for each are in [`webdriver.md` § Responses and errors](webdriver.md#responses-and-errors); the "Branch decision guide" above says which branch that next move takes.
One more is specific to this transport:

- **HTTP 408** (gateway timeout) — the Kobiton hub didn't get an answer in time. Retry once; if it fails again, that's a stronger signal.

### Likely-fatal errors (typically: end the cycle with `control --blocked`)

- **`invalid session id`** (HTTP 404) — the session is gone server-side. The trap will clean up. Nothing to do but report to the user.
- **HTTP 5xx** — Kobiton platform error. Retry once; if it fails again, the platform may be having issues. `control --blocked`.
- **HTTP 401 / 403** — credentials expired or invalid. Tell the user to re-run `/automate:setup` or re-authenticate MCP.
- **Non-Appium error pages** (HTML, plaintext, empty body) — something is very wrong with the request path or the platform. Report to the user.
- **`status: 0` with `error: "request-timeout"`** — network timeout (script-side). Retry once; if it fails again, network issue.
- **`status: 0` with `error: "runtime"`** — uncaught script exception. Real bug. Report.

### Judgment cases

When you're not sure, read the full body. The Appium `message` and `stacktrace` fields often contain hints about the cause. If after reading you still can't tell whether to retry or stop, emit `control --blocked` with the error summary as the reason — the user can redirect.

## Capture-warning for unsupported endpoints

See [`endpoint-reference.md` § Unsupported for capture](endpoint-reference.md#unsupported-for-capture) for which endpoints are NOT in the Kobiton scriptless-capture allowlist (today, `/execute/sync` for `mobile:` commands). Actions hitting those endpoints still execute, but they won't appear in `saveTestCase` output. Pick an allowlisted endpoint when capture matters.
