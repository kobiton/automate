# Endpoint Reference

The drive-specific half of this skill's WebDriver docs: how `appium.js` sends a call and reports its result, which endpoints Kobiton's scriptless capture records, the helpers, the session lifecycle and the loop-control sentinels.
Operations (`<path>` and body), selectors, the find-then-act workflow, what to observe and the response and error shapes are shared with `run-interactive-session` in [`webdriver.md`](webdriver.md).

## Calling appium.js

There is no synthetic action language: the AI host sends raw WebDriver calls through `appium.js`.

- **Generic mode:** `node appium.js --method <GET|POST|DELETE> --url /session/$SID/<path> [--req-body '<json>' | --req-body @<file>] --session-dir $DIR` — take `<path>` and the body from [`webdriver.md` § Operations](webdriver.md#operations).
- **Helpers:** `screen` (observe), `actions` and `touch-perform` (gestures whose bodies are too verbose to type), and `control` (end the cycle) — see [Helpers](#helpers).

`appium.js` reads `~/.kobiton/.credentials` (written by `/automate:setup`) on each invocation; there are no credential flags or env vars.
It always exits 0.

**Reading the result.** Read it from the call's own output.
On success stdout is the raw WebDriver response body, the full envelope `{"sessionId":…,"status":0,"value":…}`: pipe it to `jq`, for example through the element-id extractor in [`webdriver.md` § Transports](webdriver.md#transports).
On failure stdout is empty and stderr carries `{"status":N}` plus the raw body, or `{"error","message"}` when the call never reached the hub.
With `--session-dir`, the same content is saved as `response-<ts>.json` or `error-<ts>.json` next to `request-<ts>.json` ([`loop-discipline.md` § Artifact layout](loop-discipline.md#artifact-layout)); re-read the newest one when you need it again later.

Example — the find-then-click from [`webdriver.md`](webdriver.md#find-an-element-then-act-on-it), one call per turn:

```bash
# Turn N: find. stdout carries the element id.
node appium.js --method POST --url /session/$SID/element \
  --req-body '{"using":"accessibility id","value":"Open Settings"}' \
  --session-dir $DIR \
  | jq -r '(.value? // .) | if type == "object" then (.ELEMENT // .["element-6066-11e4-a52e-4f735466cecf"]) else . end'
# → el-9

# Turn N+1: click it.
node appium.js --method POST --url /session/$SID/element/el-9/click \
  --req-body '{}' --session-dir $DIR
```

## Scriptless-capture allowlist

Kobiton records actions on these endpoints into the saveable test case that `saveTestCase` consumes; emit them whenever possible.
Other endpoints work but are not recorded ([Unsupported for capture](#unsupported-for-capture)).
Bodies are in [`webdriver.md` § Operations](webdriver.md#operations).

| Group | Method | `<path>` |
|---|---|---|
| Element discovery and interaction | POST | `element`, `elements`, `element/active`, `element/{el}/click`, `element/{el}/value`, `element/{el}/clear` |
| W3C gestures (tap, long-press, swipe, key press) | POST | `actions` — use the [`actions` helper](#actions) |
| Legacy touch | POST | `touch/longclick`, `touch/perform` — the [`touch-perform` helper](#touch-perform) covers the second |
| Device controls | POST | `appium/device/press_keycode`, `back`, `orientation`, `appium/device/hide_keyboard`, `location`, `keys` |
| Read-only | GET | every GET is allowlisted — `source`, `screenshot`, `context`, `contexts`, `orientation`, the session itself |

For an element-anchored long-press, prefer `touch/longclick` with `{"element":"<el>"}`: it is the endpoint the allowlist recognizes for that gesture.
A swipe through `actions` is captured; prefer it over `execute/sync` with `mobile: scroll` whenever the step should appear in the saved test case.

## Helpers

### screen

`screen` is one of the three per-turn branches ([`loop-discipline.md`](loop-discipline.md)).
Use it when the screen has likely changed: at session start, after a successful act, or to verify mid-flow.
Skip it on a turn that retries a failed act — the latest `source-<ts>.xml` / `screenshot-<ts>.png` is still current.

```
node appium.js screen --session-id $SID --session-dir $DIR [--xml-only | --png-only] [--full]
```

- **Default:** writes `source-<ts>.xml` (the lean view), `source-<ts>.full.xml` (the raw `/source` body) and `screenshot-<ts>.png`; [`webdriver.md` § Observe](webdriver.md#observe) says which to read.
- `--xml-only`: both source files, no screenshot.
- `--png-only`: the screenshot only, no source files.
- `--full`: `source-<ts>.xml` holds the unfiltered tree (stripped webview DOM, raw native source) instead of the lean view; combines with `--xml-only`.
- Prints one JSON line, also saved as `response-<ts>.json`:
  `{"ts":T,"source":"source-T.xml","fullSource":"source-T.full.xml","screenshot":"screenshot-T.png","hash":"<sha256>","mode":"lean"|"full","xmlBytes":N,"fullXmlBytes":F,"pngBytes":M,"turns":K}`, plus `"warning":"<text>"` on a turn-warning call.
  File names are relative to `--session-dir`, and a name is absent when its file wasn't captured.
- `turns` counts the screen and act calls so far, this one included; from 100 turns and every 25 after, `warning` prompts a progress check ([`loop-discipline.md` § Turn warning](loop-discipline.md#turn-warning)).
- The hash covers `source-<ts>.xml` plus the screenshot.
  Track it in your conversation context across turns — repetition is a signal, never a forced stop.
- The screenshot is captured by default because native overlays (Chrome's "notifications" welcome card, OS permission prompts, system dialogs) are not in webview source — [`loop-discipline.md`](loop-discipline.md#why-png-is-captured-by-default).

### actions

Builds the W3C `actions` bodies from [`webdriver.md` § Gesture bodies](webdriver.md#gesture-bodies) and POSTs them.

| Gesture | Command |
|---|---|
| Tap | `node appium.js actions --session-id $SID --type touch --x N --y N [--hold-ms 50] --session-dir $DIR` |
| Long-press at coordinates | `... --type touch --x N --y N --hold-ms 1000` |
| Swipe or drag | `... --type swipe --from-x A --from-y B --to-x C --to-y D [--duration 300]` |
| Key press | `... --type key --key "<W3C key>"` |

The scroll from [`webdriver.md` § Coordinates](webdriver.md#coordinates):

```bash
node appium.js actions --session-id $SID --type swipe \
  --from-x 540 --from-y 1740 --to-x 540 --to-y 660 --duration 300 \
  --session-dir $DIR
```

### touch-perform

`node appium.js touch-perform --session-id $SID --steps @<file> --session-dir $DIR` wraps the steps array in the file into the `touch/perform` body (`{"actions":[…]}`).
Common when reproducing recorded Kobiton test cases.

### control

```
node appium.js control --done    --reason "..." --session-dir $DIR
node appium.js control --blocked --reason "..." --session-dir $DIR
```

No HTTP request.
Writes `control-<ts>.json` and prints the same object with `ts` added — see [Loop-control sentinels](#loop-control-sentinels).

## Session lifecycle

| Intent | Method | URL | Body |
|---|---|---|---|
| Create session | POST | `/session` | W3C `{"capabilities":{"alwaysMatch":{...}}}` — render it with `render-capabilities.js`; a flat caps object is wrapped automatically |
| Session details | GET | `/session/{id}` | — |
| End session | DELETE | `/session/{id}` | none; 404 counts as success (idempotent) |

Context switches and timeouts are ordinary operations ([`webdriver.md` § Operations](webdriver.md#operations)).

## Unsupported for capture

These work, but Kobiton's scriptless capture does not record them as of writing.
The session keeps running; only the step is missing from the `saveTestCase` output.
Use them only when no allowlisted alternative exists.

| Intent | Method | `<path>` | Body |
|---|---|---|---|
| Run an Appium `mobile:` command | POST | `execute/sync` | `{"script":"mobile: <command>","args":[{...}]}` |
| Run JavaScript in a webview | POST | `execute` | `{"script":"...","args":[...]}` |

The allowlist is the W3C / Appium 1.x surface.
Appium 2.x adds gesture commands through `execute/sync` with `mobile:` script names (`mobile: scroll`, `mobile: swipe`, `mobile: dragGesture`, `mobile: longClickGesture`, `mobile: doubleClickGesture`, `mobile: pinchOpenGesture`); they work but are not captured, so pick an allowlisted equivalent whenever capture matters.
When none exists (`mobile: pinchOpenGesture` has no W3C analog), `execute/sync` is the fallback: the skill works, and only the saved test case misses that step.
Arg shapes vary by driver (UiAutomator2 vs XCUITest); treat the Appium project's mobile-command reference as authoritative.
Staying in a webview context and driving it with `execute` has the same capture gap.

`appium.js` appends `ts=<ts> capture-warning=execute/sync url=<url>` (or `capture-warning=execute`) to `session.log` for every script call, so the developer knows that action won't appear in the saved test case.

## Loop-control sentinels

The AI host ends the cycle with `control` instead of an action; it writes `control-<ts>.json`:

```json
{ "control": "DONE",    "reason": "Settings page reached and toggle enabled." }
{ "control": "BLOCKED", "reason": "Two modal dialogs stacked; tapping the visible one dismisses nothing." }
```

`DONE` exits the loop cleanly (the trap ends the session); `BLOCKED` pauses and posts the reason to the conversation.

## How the host picks an endpoint

1. **Default to allowlisted.** If the intent has an allowlisted endpoint, use it.
2. **Use a helper when boilerplate would be error-prone.** `actions` for W3C gestures, `touch-perform` for legacy multi-step touch.
3. **Fall back to `execute/sync` only when nothing else fits.** Say why in the action's reason.
4. **Read the Appium docs** for an `execute/sync` mobile command — the args differ by driver; the plugin doesn't ship them.

## Adding a new gesture

No code change: add a row to [`webdriver.md` § Operations](webdriver.md#operations) with the `<path>` and body, and to the allowlist above when the capture records it.

If the new gesture's body is verbose enough to be error-prone (think: a 6-sub-action W3C sequence with carefully placed pauses), consider adding a helper to `appium.js`.
Helpers should be a thin wrapper around the generic POST plus a body builder, covered by a co-located test that asserts the assembled body.
Use the existing `actions` and `touch-perform` helpers as templates.
