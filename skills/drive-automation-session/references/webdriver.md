# WebDriver reference

Shared by `drive-automation-session` and `run-interactive-session`.
Both skills drive the device through the same W3C WebDriver / Appium endpoints and differ only in how a call is sent ([Transports](#transports)).
Everything after that section is transport-neutral: an operation is a method, a `<path>` relative to `/session/{id}/`, and a JSON body.

## Transports

| | `run-interactive-session` (CLI session) | `drive-automation-session` (automation session) |
|---|---|---|
| `POST <path>` with `<body>` | `$KOBITON_BIN wd post <path> '<body>'` | `node appium.js --method POST --url /session/$SID/<path> --req-body '<body>' --session-dir $DIR` |
| `GET <path>` | `$KOBITON_BIN wd get <path>` | `node appium.js --method GET --url /session/$SID/<path> --session-dir $DIR` |
| Which session | The one `session create` opened (implicit) | `$SID` in the URL |
| Success | The unwrapped result on stdout — the envelope's `value` alone, for every call: a find prints `{"ELEMENT":"…","element-6066-11e4-a52e-4f735466cecf":"…"}`, a call with no result prints `null`; exit 0 | The full envelope `{"sessionId":…,"status":0,"value":…}` on stdout, also saved as `response-<ts>.json`; exit 0 |
| Failure | A top-level `{"error":"…","message":"…"}` on stdout, exit 0 — check `.error`, not `$?` | Nothing on stdout; `{"status":N}` plus the raw body on stderr, also saved as `error-<ts>.json`; exit 0 |
| Page source, screenshot | `wd get source` / `wd get screenshot` print the raw XML / base64 PNG (the unwrapped result, like every call); save them as [Observe](#observe) describes | The `screen` helper saves both and prints the file names ([Observe](#observe)) |

Both transports take the element id out of a find call's stdout with the same extractor:

```bash
jq -r '(.value? // .) | if type == "object" then (.ELEMENT // .["element-6066-11e4-a52e-4f735466cecf"]) else . end'
```

It reads `value` from the `appium.js` envelope and the CLI's unwrapped result as printed, then returns the id from either key, or a bare id string as is.

The rest of each transport stays with its skill: `run-interactive-session/SKILL.md` for `wd --help` and the CLI's non-WebDriver commands; [`endpoint-reference.md`](endpoint-reference.md) for the `appium.js` helpers, the capture allowlist and the session lifecycle; [`loop-discipline.md`](loop-discipline.md) for the turn loop and its artifacts.

## Operations

`<el>` is an element id from a find call ([Find an element, then act on it](#find-an-element-then-act-on-it)).
`{}` is an empty JSON body; `—` means the call has no body.

| Operation | Method | `<path>` | Body |
|---|---|---|---|
| Find an element by accessibility id | POST | `element` | `{"using":"accessibility id","value":"<content-desc or name>"}` |
| Find an element by id | POST | `element` | `{"using":"id","value":"<resource-id>"}` |
| Find an element by XPath | POST | `element` | `{"using":"xpath","value":"<xpath>"}` |
| Find an element by CSS selector (web context) | POST | `element` | `{"using":"css selector","value":"<css>"}` |
| Find an element by class name | POST | `element` | `{"using":"class name","value":"<class>"}` |
| Find every match | POST | `elements` | Same bodies as `element`; returns a list |
| Get the focused element | POST | `element/active` | `{}` |
| Click | POST | `element/<el>/click` | `{}` |
| Type text | POST | `element/<el>/value` | `{"text":"<text>"}` |
| Clear text | POST | `element/<el>/clear` | `{}` |
| Get an element's text | GET | `element/<el>/text` | — |
| Tap at coordinates | POST | `actions` | [Tap](#gesture-bodies) |
| Long-press at coordinates | POST | `actions` | [Tap](#gesture-bodies) with a ~1000 ms pause |
| Swipe, drag or scroll | POST | `actions` | [Swipe](#gesture-bodies) |
| Press a key (W3C) | POST | `actions` | [Key press](#gesture-bodies) |
| Long-press an element | POST | `touch/longclick` | `{"element":"<el>","duration":1000}` |
| Long-press at coordinates (legacy) | POST | `touch/longclick` | `{"x":N,"y":N,"duration":1000}` |
| Multi-step touch gesture (legacy) | POST | `touch/perform` | `{"actions":[{"action":"press","options":{"x":N,"y":N}},{"action":"wait","options":{"ms":1000}},{"action":"release"}]}` |
| Press back (Android) | POST | `back` | `{}` |
| Press home (Android) | POST | `appium/device/press_keycode` | `{"keycode":3}` |
| Press another hardware key (Android: back 4, volume up 24, power 26) | POST | `appium/device/press_keycode` | `{"keycode":N}` |
| Press a hardware key by script (Android) | POST | `execute/sync` | `{"script":"mobile: pressKey","args":[{"keycode":N}]}` |
| Hide the keyboard | POST | `appium/device/hide_keyboard` | `{}` |
| Send keys to the focused element | POST | `keys` | `{"value":["<char>","<char>"]}` |
| Accept an alert | POST | `execute` | `{"script":"kobiton:alerthandler","args":{"auto":"accept"}}` |
| Dismiss an alert | POST | `execute` | `{"script":"kobiton:alerthandler","args":{"auto":"dismiss"}}` |
| Page source | GET | `source` | — |
| Screenshot (base64 PNG) | GET | `screenshot` | — |
| Window size | GET | `window/rect` | — |
| Get the orientation | GET | `orientation` | — |
| Set the orientation | POST | `orientation` | `{"orientation":"LANDSCAPE"}` or `{"orientation":"PORTRAIT"}` |
| Set the geolocation | POST | `location` | `{"location":{"latitude":N,"longitude":N,"altitude":N}}` |
| Open a URL | POST | `url` | `{"url":"<url>"}` |
| Get the current URL | GET | `url` | — |
| List contexts | GET | `contexts` | — |
| Get the current context | GET | `context` | — |
| Switch context | POST | `context` | `{"name":"NATIVE_APP"}` or `{"name":"WEBVIEW_<suffix>"}` |
| Set timeouts | POST | `timeouts` | `{"implicit":N}` |
| Run an Appium `mobile:` command | POST | `execute/sync` | `{"script":"mobile: <command>","args":[{}]}` — argument shapes differ by driver (UiAutomator2 vs XCUITest); take them from the Appium driver docs |
| Run JavaScript (web context) | POST | `execute` | `{"script":"<js>","args":[]}` |

Send every `mobile:` command to `execute/sync` with its arguments as a one-element array, `"args":[{…}]`.
The hub also accepts `execute`, and `args` as a bare object.

### Gesture bodies

W3C `actions` bodies with placeholders; coordinates come from the lean view ([Coordinates](#coordinates)).

Tap (raise the pause to ~1000 ms for a long-press):

```json
{"actions":[{"type":"pointer","id":"finger1","parameters":{"pointerType":"touch"},"actions":[{"type":"pointerMove","duration":0,"x":<x>,"y":<y>},{"type":"pointerDown","button":0},{"type":"pause","duration":50},{"type":"pointerUp","button":0}]}]}
```

Swipe from `(<x1>,<y1>)` to `(<x2>,<y2>)` over `<ms>` (300–500 is typical):

```json
{"actions":[{"type":"pointer","id":"finger1","parameters":{"pointerType":"touch"},"actions":[{"type":"pointerMove","duration":0,"x":<x1>,"y":<y1>},{"type":"pointerDown","button":0},{"type":"pointerMove","duration":<ms>,"x":<x2>,"y":<y2>},{"type":"pointerUp","button":0}]}]}
```

Key press (`<key>` is a W3C key value):

```json
{"actions":[{"type":"key","id":"keyboard1","actions":[{"type":"keyDown","value":"<key>"},{"type":"keyUp","value":"<key>"}]}]}
```

## Selectors

Build every selector from attributes you can see in the latest lean view ([Observe](#observe)) — never invent one.
A guessed id or class name that "should" exist is the most common cause of `no such element`.

**Native context (UiAutomator2 / XCUITest), in preference order:**

1. **`accessibility id`** — `content-desc` on Android, `name` on iOS.
   Fastest lookup, exposed for testing, most stable across releases; use it whenever that attribute is present and meaningful.
2. **`id`** — `resource-id` on Android, `name` on iOS.
   Stable within an app version, less so across versions.
   This is the Appium `id` strategy, not the opaque element id a find call returns.
3. **`xpath`, relative** — `//*[@content-desc='settings_btn']`, `//XCUIElementTypeButton[@name='Settings']`, `//android.widget.Button[@text='Continue']`.
   Slow but expressive; use it when the target has no accessibility id or id but has a distinctive `text`, `label`, `value` or combination of attributes.
4. **`class name`** — the widget class (`android.widget.Button`, `XCUIElementTypeButton`).
   Almost always ambiguous; avoid it as a top-level strategy.

**Web context (a browser session or a `WEBVIEW_*` context), in preference order:**

1. **`css selector`** — anchored on stable attributes: `[aria-label='Search']`, `#search_query`, `input[name='q']`, `[data-testid='result-0']`.
2. **`xpath`, relative** — when CSS can't express the target, for example by visible text: `//button[normalize-space()='Continue']`.

Anchor web selectors on `aria-label`, `id`, `name`, `href`, `data-testid`, `role` or `class`.

**In every context:**

- Decode XML entities in the value first: the lean view shows `Date &amp; Time`, the selector value is `Date & Time`.
- Never build a selector from position — no `[3]`, `:nth-child`, or absolute paths such as `/hierarchy/android.widget.FrameLayout[1]/…`.
  The lean view drops wrapper elements (native) and whole tags (webview), so a positional path read from it does not match the live tree, and any layout change breaks it.
- Join XPath steps with `//` (descendant), not `/` (child): an element's parent in the lean view may be a grandparent in the live tree.
- When two elements share an attribute, narrow with an ancestor predicate joined by `//` — `//*[@resource-id='com.example.app:id/dialog']//android.widget.Button[@text='Continue']` — not with an index.
  If an index really is the only distinguishing feature, take it from the full source, not from the lean view.
- In a shell-quoted JSON body, write XPath string literals with escaped double quotes: `'{"using":"xpath","value":"//*[@text=\"Display\"]"}'`.
- On iOS web content, check the element's actual `XCUIElementType` in the source before writing an XPath by type: web controls often surface as `Link` or `StaticText` rather than `Button`.

## Find an element, then act on it

Every call that targets an element follows the same steps:

```
1. observe              → the lean view (Observe)
2. read the lean view   → the target node and its attributes
3. POST element         → {"using":"<strategy>","value":"<selector>"}
                        ← result {"element-6066-11e4-a52e-4f735466cecf":"<id>"},
                          {"ELEMENT":"<id>"} (older drivers), or both keys
                          (the CLI prints the result; appium.js nests it under "value")
4. extract the id       → the extractor in Transports; the id is opaque
5. act on it            → POST element/<id>/click, element/<id>/value, element/<id>/clear,
                          touch/longclick with {"element":"<id>"}, …
```

Example: the lean view holds

```xml
<android.widget.ImageButton resource-id="com.example.app:id/settings_btn" content-desc="Open Settings" clickable="true" bounds="[864,1872][1008,2016]" />
```

Its `content-desc` is meaningful, so find it by accessibility id and click the id that comes back:

| Step | Method | `<path>` | Body | Result (the envelope's `value`) |
|---|---|---|---|---|
| Find | POST | `element` | `{"using":"accessibility id","value":"Open Settings"}` | `{"element-6066-11e4-a52e-4f735466cecf":"el-9"}` |
| Click | POST | `element/el-9/click` | `{}` | `null` |

The same find body matches `<XCUIElementTypeButton name="Open Settings" …/>` on iOS.
To type, find the field (`{"using":"id","value":"com.example.app:id/email_input"}`) and POST `element/<id>/value` with `{"text":"user@example.com"}`.

An element id is valid only for the screen state it was found on.
After the screen changes (a successful tap, a navigation), observe again and re-find: reusing the old id fails with `stale element reference`.

### Coordinates

Prefer element calls: they survive layout changes and read better in a saved test case.
Use coordinates where no element call reaches the target:

- scrolling a list, page or other scrollable container — [Operations](#operations) has no element-anchored scroll, so a scroll is a [swipe](#gesture-bodies) through `actions` (in `drive-automation-session`, the `actions` helper builds it);
- dragging on a canvas (drawing, signature pad, map);
- swiping a carousel that ignores element-level swipes;
- tapping a region of an image that has no element.

Coordinates come from the lean view too, never invented: Android `bounds="[x1,y1][x2,y2]"`, iOS `x` / `y` / `width` / `height`.

- Center of an element: `((x1+x2)/2, (y1+y2)/2)`.
- A scroll swipe starts and ends inside the container's bounds and clear of the status and navigation bars: for example from 80% to 20% of the container's height at its horizontal centre, rather than a fixed offset from its edge.
  A container that fills the screen reaches into those bars, so a fixed offset from its edge can land the finger on them.

Example: a list with `bounds="[0,300][1080,2100]"` is 1800 px tall with its horizontal centre at x = 540; to scroll its content down, POST `actions` with a swipe whose finger moves up, from 80% of its height to 20%: `(540, 1740)` to `(540, 660)` over 300 ms.
Swap the direction to scroll back up; for a horizontal container, take the same fractions of its width at its vertical centre.

## Web content

What the native tree shows of a web page differs by platform:

- **iOS** exposes web content in the native hierarchy: the source of a Safari page includes its text, links and buttons, so in-page elements (cookie dialogs, page buttons) are findable and clickable with native locators.
- **Android** UiAutomator does not see inside a WebView: the same dialog is invisible in the native source.
  Switch to the `WEBVIEW_*` context and use web selectors, or tap by coordinates.

In a browser session or a `WEBVIEW_*` context, default to web interactions (find, then click or value; `execute` for scripts).
Switch to `NATIVE_APP` only when the web path can't do the job:

- something covers the page that isn't in the DOM — a native modal, system dialog, permission prompt or address-bar autofill (the screenshot shows it, the source doesn't);
- a web click succeeds at the HTTP layer but the page doesn't react (synthetic clicks lack user activation), and re-issuing it changes nothing.

After switching, treat the native tree as the source of truth: observe, find and tap natively.
If the target has no native mirror, tap by coordinates — from the native bounds when the surrounding nodes pinpoint it, otherwise from `getBoundingClientRect` run in the `WEBVIEW_*` context for viewport coordinates; a coordinate tap works from any context.
List the contexts (`GET contexts`) before switching back rather than reusing a cached name: the `WEBVIEW_*` suffix can change after a `NATIVE_APP` round-trip.

## Observe

Both skills save the same three files per observation under `.kobiton/sessions/<session-id>/`, named with the epoch-second timestamp `<ts>` of the capture:

| File | What it holds | When you read it |
|---|---|---|
| `source-<ts>.xml` — the lean view | Only the elements you can target or read, with their bounds | Every observation — this is the default read |
| `source-<ts>.full.xml` — the full source | The raw `/source` body, unchanged | Only for the cases in [When to open the full source](#when-to-open-the-full-source) |
| `screenshot-<ts>.png` | The screen as drawn | On demand — see [Screenshot](#screenshot) |

`drive-automation-session`'s `screen` helper writes all three in one call and prints their names; `run-interactive-session` writes them with `wd get source`, `wd get screenshot` and the lean-view filter (its Step 4).
The filter is `drive-automation-session/scripts/ui-tree.js`: `node ui-tree.js <source-file>` prints the lean view.

When a source file is large — over about 30 KB, typical of a web page, whose lean view often runs 70–175 KB — `grep` it for the target (its id, `name`, text, `aria-label` or a CSS hook) rather than reading it whole, the same targeted search the full source gets ([When to open the full source](#when-to-open-the-full-source)).
`screen` reports the sizes as `xmlBytes` (lean) and `fullXmlBytes` (full).

### What the lean view keeps

What the lean view is depends on what `/source` returned, not on the session type: an HTML page gives the stripped DOM, a native tree gives the native filter.
A browser session can return the native tree before a page has loaded, so its first observation may be native.

- **Native Android (UiAutomator2):** every element with a non-empty `resource-id`, `content-desc` or `text`, or with `clickable`, `long-clickable`, `checkable` or `scrollable="true"`.
  Each keeps `resource-id`, `content-desc`, `text`, `hint`, `bounds`, the state flags that are `true` (`clickable`, `long-clickable`, `scrollable`, `password`, `selected`), `checked` on any checkable element, and `enabled="false"` when an element is disabled.
- **Native iOS (XCUITest):** every element with a non-empty `name`, `label` or `value`, `accessible="true"`, or a scroll container (`Table`, `CollectionView`, `ScrollView`, `WebView`).
  Each keeps `name`, `label`, `value`, `x`, `y`, `width`, `height`, plus `enabled` / `visible` when they are `false`.
- **HTML page** (a loaded page in a browser session or a `WEBVIEW_*` context): the stripped DOM — `<script>` / `<style>` / `<head>` / `<noscript>` and inline base64 images removed, attributes pruned to text, ids, names, classes, `aria-*`, `role`, `href`, `data-testid` and form-control attributes.

Element tag names (`android.widget.Button`, `XCUIElementTypeButton`, `div`) are preserved, so `//<tag>[@attr='…']` selectors built from the lean view resolve against the live session.
In native trees, wrapper elements that carry none of the above are dropped and their children move up one level, so nesting depth in the lean view is not the real depth.
Attribute values are copied byte for byte (XML entities such as `&amp;` stay escaped).
Source that is none of the three kinds passes through unchanged.

### When to open the full source

Open the full source for one observation, find what you need, then go back to the lean view on the next one:

- You need a positional or index-based XPath because the target has no identifying attribute at all.
- An element you expect (visible in the screenshot, or named in the intent) is not in the lean view.
- A selector built from the lean view returned `no such element` twice in a row.

Search the full source for the specific element (`grep` for its text, id or label) rather than reading the whole file — it is several times larger than the lean view.

In `drive-automation-session`, `screen --full` writes the pre-lean output (stripped webview DOM, raw native tree) to `source-<ts>.xml`; use it when you need the full tree as your primary read for a stretch of turns.

### Screenshot

The screenshot shows what the source cannot: native overlays, system dialogs and permission prompts drawn over the app or the web page.
Read it on the first observation after launching an app or opening a browser (welcome cards and permission prompts appear there), and whenever the lean view doesn't explain the screen — an action that changed nothing, a dialog you suspect, or a visual check (layout, image, animation).
Otherwise it is on demand: don't read it every turn.

## Responses and errors

The hub answers every call with a JSON envelope whose `value` is the result.
`appium.js` prints the whole envelope; the CLI prints only the result, for every `wd` call ([Transports](#transports)).
The rules below describe the result.

- A null or empty result means success: click, value, clear, actions, orientation, url, and scripts that return nothing.
- A non-null result is the answer: a string (`element/<el>/text`, `url`, `orientation`), an object (`window/rect` returns `{"width":N,"height":N,"x":N,"y":N}`), or a script's return value.
- A find returns the element id under `ELEMENT`, under `element-6066-11e4-a52e-4f735466cecf` (the CLI prints both keys), or as a bare string; the extractor in [Transports](#transports) covers every shape on both transports, and `elements` returns a list of them.
- A failure is `{"error":"<error>","message":"…"}` with an HTTP 4xx or 5xx status: the CLI prints it at the top level of stdout (exit 0), and `appium.js` prints the hub's body, with the same fields under `value`, on stderr.
  Read `message` when `error` alone doesn't explain it.

| `error` | Meaning | Next move |
|---|---|---|
| `no such element` | The selector matched nothing | Re-read the lean view and try another strategy or a more specific value; on the second miss for the same target, open the full source ([When to open the full source](#when-to-open-the-full-source)) |
| `stale element reference` | The element id belongs to an earlier screen state | Observe again and re-find |
| `invalid selector` | The XPath, CSS or strategy syntax is wrong | Fix the syntax |
| `invalid argument` | The body doesn't match what the endpoint expects | Check the body against [Operations](#operations) |
| `timeout` | Appium timed out, often during an implicit element wait | Retry, or relax the wait with `timeouts` |
| `invalid session id` | The session ended on the server | Stop sending calls to it; it can't be resumed |
