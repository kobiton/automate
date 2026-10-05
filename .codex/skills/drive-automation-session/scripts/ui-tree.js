// Lean UI-tree view shared by the WebDriver skills (drive-automation-session's
// `screen` helper and run-interactive-session's page-source step). Node ESM,
// no deps. The lean view keeps only the elements an agent can target or read
// (ids, labels, text, interactive flags) with their bounds; the raw /source
// stays on disk next to it as the escape hatch (see references/observe.md).
//
// CLI: node ui-tree.js <source-file>   → lean view on stdout

import {readFileSync, realpathSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {stripWebviewDom} from './strip-webview-dom.js'

// ---- Kind detection ---------------------------------------------------------

// Webview check looks at the first 200 bytes, not strictly position 0 — some
// drivers prepend an XML declaration, DOCTYPE or BOM. Native trees never carry
// `<html` near the start.
const WEBVIEW_HEAD = 200
const NATIVE_HEAD = 2048

export function detectKind(source) {
  if (typeof source !== 'string' || source.length === 0) return 'unknown'
  if (/<html[\s>]/i.test(source.slice(0, WEBVIEW_HEAD))) return 'webview'
  const head = source.slice(0, NATIVE_HEAD)
  if (/<(AppiumAUT|XCUIElementType\w+)[\s/>]/.test(head)) return 'ios'
  if (/<(hierarchy|android\.[\w.$]+)[\s/>]/.test(head)) return 'android'
  return 'unknown'
}

// ---- Tokenizer ---------------------------------------------------------------

// One sticky regex walks the document. Attribute values are kept raw (quotes
// included), so XML entities pass through exactly as the driver emitted them.
const TOKEN = new RegExp([
  '(<\\?[\\s\\S]*?\\?>)',                                  // 1 declaration / PI
  '(<!--[\\s\\S]*?-->)',                                   // 2 comment
  '(<!\\[CDATA\\[[\\s\\S]*?\\]\\]>)',                      // 3 CDATA
  '(<!DOCTYPE[^>]*>)',                                     // 4 doctype
  '<\\/([^\\s>]+)\\s*>',                                   // 5 close tag name
  '<([^\\s/>!?]+)((?:\\s+[^\\s=/>]+\\s*=\\s*(?:"[^"]*"|\'[^\']*\'))*)\\s*(\\/?)>', // 6 open tag, 7 attrs, 8 self-close
  '([^<]+)'                                                // 9 text
].join('|'), 'y')

const ATTR = /([^\s=/>]+)\s*=\s*("[^"]*"|'[^']*')/g

function parseAttrs(raw) {
  const attrs = []
  if (!raw) return attrs
  ATTR.lastIndex = 0
  let m
  while ((m = ATTR.exec(raw)) !== null) attrs.push({name: m[1], raw: m[2], value: m[2].slice(1, -1)})
  return attrs
}

// Returns the root element node, or null when the input isn't a well-formed
// element tree (the caller then passes the source through unchanged).
function parseTree(xml) {
  const stack = []
  let root = null
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < xml.length) {
    const start = TOKEN.lastIndex
    const m = TOKEN.exec(xml)
    if (!m || TOKEN.lastIndex === start) return null
    if (m[5] !== undefined) {
      const node = stack.pop()
      if (!node || node.tag !== m[5]) return null
      continue
    }
    if (m[6] !== undefined) {
      const node = {tag: m[6], attrs: parseAttrs(m[7]), children: []}
      if (stack.length) stack[stack.length - 1].children.push(node)
      else if (root) return null
      else root = node
      if (!m[8]) stack.push(node)
      continue
    }
    if (m[9] !== undefined && m[9].trim() && !stack.length) return null
    // Declarations, comments, CDATA, doctype and text between native elements
    // carry nothing the agent targets — native drivers put text in attributes.
  }
  if (stack.length || !root) return null
  return root
}

// ---- Native filter -------------------------------------------------------------

const ANDROID_FLAGS = ['clickable', 'long-clickable', 'checkable', 'scrollable']
const ANDROID_KEEP = new Set([
  'resource-id', 'content-desc', 'text', 'hint', 'bounds', 'clickable', 'long-clickable',
  'checked', 'scrollable', 'password', 'selected', 'enabled'
])
const ANDROID_NONEMPTY = new Set(['resource-id', 'content-desc', 'text', 'hint'])
const IOS_KEEP = new Set(['name', 'label', 'value', 'x', 'y', 'width', 'height', 'enabled', 'visible'])
const IOS_NONEMPTY = new Set(['name', 'label', 'value'])
// iOS has no scrollable flag; keep scroll containers so swipe targets keep their frame.
const IOS_SCROLL_CONTAINER = /^XCUIElementType(Table|CollectionView|ScrollView|WebView)$/

function attrMap(node) {
  const map = {}
  for (const a of node.attrs) map[a.name] = a.value
  return map
}

function qualifiesAndroid(a) {
  if (a['resource-id'] || a['content-desc'] || a.text) return true
  return ANDROID_FLAGS.some((f) => a[f] === 'true')
}

function qualifiesIos(a, tag) {
  return Boolean(a.name || a.label || a.value) || a.accessible === 'true' || IOS_SCROLL_CONTAINER.test(tag)
}

function keepAttrAndroid(attr, a) {
  const {name, value} = attr
  if (!ANDROID_KEEP.has(name)) return false
  if (ANDROID_NONEMPTY.has(name)) return value !== ''
  if (name === 'bounds') return true
  if (name === 'enabled') return value === 'false'
  // A switch / checkbox that is off is still worth knowing about.
  if (name === 'checked') return value === 'true' || a.checkable === 'true'
  return value === 'true'
}

function keepAttrIos(attr) {
  const {name, value} = attr
  if (!IOS_KEEP.has(name)) return false
  if (IOS_NONEMPTY.has(name)) return value !== ''
  if (name === 'enabled' || name === 'visible') return value === 'false'
  return true
}

function render(node, depth, isRoot, rules, lines) {
  const a = attrMap(node)
  if (!isRoot && !rules.qualifies(a, node.tag)) {
    // Dropped wrapper: hoist its qualifying descendants to this depth.
    for (const child of node.children) render(child, depth, false, rules, lines)
    return
  }
  const pad = '  '.repeat(depth)
  const kept = node.attrs.filter((attr) => rules.keep(attr, a)).map((attr) => ` ${attr.name}=${attr.raw}`).join('')
  const childLines = []
  for (const child of node.children) render(child, depth + 1, false, rules, childLines)
  if (childLines.length === 0) {
    lines.push(`${pad}<${node.tag}${kept} />`)
    return
  }
  lines.push(`${pad}<${node.tag}${kept}>`)
  for (const l of childLines) lines.push(l)
  lines.push(`${pad}</${node.tag}>`)
}

const RULES = {
  android: {qualifies: qualifiesAndroid, keep: keepAttrAndroid},
  ios: {qualifies: qualifiesIos, keep: keepAttrIos}
}

// Lean view of a UiAutomator2 / XCUITest tree. Input that is not a native tree
// (or does not parse) is returned unchanged.
export function leanNativeTree(xml, kind = detectKind(xml)) {
  const rules = RULES[kind]
  if (!rules || typeof xml !== 'string') return xml
  const root = parseTree(xml)
  if (!root) return xml
  const lines = []
  render(root, 0, true, rules, lines)
  return lines.join('\n') + '\n'
}

// The one entry point both skills use.
export function leanTree(source) {
  const kind = detectKind(source)
  if (kind === 'webview') return {kind, lean: stripWebviewDom(source)}
  if (kind === 'android' || kind === 'ios') return {kind, lean: leanNativeTree(source, kind)}
  return {kind, lean: source}
}

// ---- CLI -------------------------------------------------------------------------

// Accept either the raw source or a WebDriver `{"value": "<source>"}` envelope.
function unwrapSource(text) {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('{')) return text
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed.value === 'string') return parsed.value
  }
  catch {}
  return text
}

function isMain() {
  if (!process.argv[1]) return false
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) }
  catch { return false }
}

if (isMain()) {
  const file = process.argv[2]
  if (!file) {
    process.stderr.write('usage: node ui-tree.js <source-file>   (lean view on stdout)\n')
    process.exit(2)
  }
  let text
  try { text = readFileSync(file, 'utf8') }
  catch (err) {
    process.stderr.write(`cannot read ${file}: ${err.message}\n`)
    process.exit(1)
  }
  process.stdout.write(leanTree(unwrapSource(text)).lean)
}
