# Observe: lean view first, full source on demand

Shared by `drive-automation-session` (the `screen` helper) and `run-interactive-session` (its page-source step).
Both produce the same two files per observation through `drive-automation-session/scripts/ui-tree.js` (`node ui-tree.js <source-file>` prints the lean view):

| File | What it holds | When you read it |
|---|---|---|
| lean view — `iter-NNN.xml` / `source-<ts>.xml` | Only the elements you can target or read, with their bounds | Every observe turn — this is the default read |
| full source — `iter-NNN.full.xml` / `source-<ts>.full.xml` | The raw `/source` body, unchanged | Only for the escape-hatch cases below |

## What the lean view keeps

- **Native Android (UiAutomator2):** every element with a non-empty `resource-id`, `content-desc` or `text`, or with `clickable`, `long-clickable`, `checkable` or `scrollable="true"`.
  Each keeps `resource-id`, `content-desc`, `text`, `hint`, `bounds` the state flags that are `true` (`clickable`, `long-clickable`, `scrollable`, `password`, `selected`), `checked` on any checkable element, and `enabled="false"` when an element is disabled.
- **Native iOS (XCUITest):** every element with a non-empty `name`, `label` or `value`, `accessible="true"`, or a scroll container (`Table`, `CollectionView`, `ScrollView`, `WebView`).
  Each keeps `name`, `label`, `value`, `x`, `y`, `width`, `height`, plus `enabled` / `visible` when they are `false`.
- **Webview / browser:** the stripped DOM — `<script>` / `<style>` / `<head>` / `<noscript>` and inline base64 images removed, attributes pruned to text, ids, names, classes, `aria-*`, `role`, `href`, `data-testid` and form-control attributes.

Element tag names (`android.widget.Button`, `XCUIElementTypeButton`, `div`) are preserved, so `//<tag>[@attr='…']` selectors built from the lean view resolve against the live session.
In native trees, wrapper elements that carry none of the above are dropped and their children move up one level, so nesting depth in the lean view is not the real depth.
Attribute values are copied byte for byte (XML entities such as `&amp;` stay escaped).
Source that is none of the three kinds passes through unchanged.

## Selector rule

Build selectors from identifying attributes you can see in the lean view: `accessibility id` (`content-desc` / `name`), `id` (`resource-id`), or relative xpath on `text` / `label` / `value` / `aria-label`.
Decode XML entities in the value first: the lean view shows `Date &amp; Time`, the selector value is `Date & Time`.
Never build a selector from position — no `[3]`, `:nth-child`, or absolute paths through wrapper elements.
The lean view drops wrappers (native) and whole tags (webview), so a positional path read from it does not match the live tree.
For the same reason, join xpath steps with `//` (descendant), not `/` (child): an element's parent in the lean view may be a grandparent in the live tree.

Coordinates for gestures come from the target's `bounds` (Android) or `x` / `y` / `width` / `height` (iOS), which the lean view keeps.

## When to open the full source

Open the full source for one observation, find what you need, then go back to the lean view on the next one:

- You need a positional or index-based XPath because the target has no identifying attribute at all.
- An element you expect (visible in the screenshot, or named in the intent) is not in the lean view.
- A selector built from the lean view returned `no such element` twice in a row.

Search the full source for the specific element (`grep` for its text, id or label) rather than reading the whole file — it is several times larger than the lean view.

In `drive-automation-session`, `screen --full` writes the pre-lean output to `iter-NNN.xml` for the whole turn (stripped webview DOM, raw native tree); use it when you need the full tree as your primary read for a stretch of turns.

## Screenshot

The screenshot shows what the source cannot: native overlays, system dialogs and permission prompts drawn over the app or the web page.
Read it on the first observation after launching an app or opening a browser (welcome cards and permission prompts appear there), and whenever the lean view doesn't explain the screen — an action that changed nothing, a dialog you suspect, or a visual check (layout, image, animation).
Otherwise it is on demand: don't read it every turn.
