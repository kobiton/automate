import {describe, it, expect} from 'vitest'
import {readFileSync, writeFileSync, mkdtempSync} from 'node:fs'
import {execFile} from 'node:child_process'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'
import {detectKind, leanNativeTree, leanTree} from './ui-tree.js'
import {stripWebviewDom} from './strip-webview-dom.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(__dirname, 'ui-tree.js')
const fixture = (name) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8')
const ANDROID = fixture('uiautomator2-settings.xml')
const IOS = fixture('xcuitest-settings.xml')
const WEBVIEW = fixture('webview-mobile-sample.xml')

// Every element of a raw tree, with its attributes decoded only far enough to
// test for emptiness (values stay raw).
function rawElements(xml) {
  const out = []
  const re = /<([A-Za-z][\w.$]*)((?:\s+[^\s=/>]+\s*=\s*"[^"]*")*)\s*\/?>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    const attrs = {}
    for (const a of m[2].matchAll(/([^\s=/>]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2]
    out.push({tag: m[1], attrs})
  }
  return out
}

function leanLines(lean) {
  return lean.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('<') && !l.startsWith('</'))
}

function hasLine(lines, tag, attrs) {
  return lines.some((l) => l.startsWith(`<${tag} `) || l.startsWith(`<${tag}>`)
    ? Object.entries(attrs).every(([k, v]) => l.includes(` ${k}="${v}"`))
    : false)
}

describe('detectKind', () => {
  it('detects webview HTML, tolerating a declaration, DOCTYPE, BOM, whitespace and case', () => {
    expect(detectKind('<html><body/></html>')).toBe('webview')
    expect(detectKind('<?xml version="1.0"?><html><body/></html>')).toBe('webview')
    expect(detectKind('<!DOCTYPE html><html lang="en"></html>')).toBe('webview')
    expect(detectKind('﻿<html></html>')).toBe('webview')
    expect(detectKind('\n  <HTML><body/></HTML>')).toBe('webview')
    expect(detectKind(WEBVIEW)).toBe('webview')
  })

  it('detects UiAutomator2 trees by <hierarchy or android.* tags', () => {
    expect(detectKind(ANDROID)).toBe('android')
    expect(detectKind('<hierarchy rotation="0"><node/></hierarchy>')).toBe('android')
    expect(detectKind('<android.widget.FrameLayout bounds="[0,0][1,1]"/>')).toBe('android')
  })

  it('detects XCUITest trees by <AppiumAUT or XCUIElementType* tags', () => {
    expect(detectKind(IOS)).toBe('ios')
    expect(detectKind('<AppiumAUT><x/></AppiumAUT>')).toBe('ios')
    expect(detectKind('<SCREEN><XCUIElementTypeApplication name="App"/></SCREEN>')).toBe('ios')
  })

  it('returns unknown for anything else', () => {
    expect(detectKind('')).toBe('unknown')
    expect(detectKind(null)).toBe('unknown')
    expect(detectKind('<root><child/></root>')).toBe('unknown')
    expect(detectKind('plain text')).toBe('unknown')
  })
})

describe('leanTree on a UiAutomator2 settings screen', () => {
  const {kind, lean} = leanTree(ANDROID)
  const lines = leanLines(lean)
  const raw = rawElements(ANDROID)

  it('is classified android and is at least 60% smaller than the raw source', () => {
    expect(kind).toBe('android')
    expect(raw.length).toBeGreaterThanOrEqual(60)
    expect(1 - Buffer.byteLength(lean) / Buffer.byteLength(ANDROID)).toBeGreaterThanOrEqual(0.6)
  })

  it('keeps every element with a resource-id, content-desc, text or clickable flag, with its bounds and tag', () => {
    const targetable = raw.filter(({attrs}) => attrs['resource-id'] || attrs['content-desc'] || attrs.text || attrs.clickable === 'true')
    expect(targetable.length).toBeGreaterThan(40)
    for (const {tag, attrs} of targetable) {
      const expected = {bounds: attrs.bounds}
      for (const k of ['resource-id', 'content-desc', 'text']) if (attrs[k]) expected[k] = attrs[k]
      if (attrs.clickable === 'true') expected.clickable = 'true'
      expect(hasLine(lines, tag, expected), `${tag} ${JSON.stringify(expected)}`).toBe(true)
    }
  })

  it('keeps scrollable containers and the switch state, and the root element', () => {
    expect(hasLine(lines, 'androidx.recyclerview.widget.RecyclerView', {scrollable: 'true'})).toBe(true)
    expect(hasLine(lines, 'android.widget.Switch', {checked: 'false', clickable: 'true'})).toBe(true)
    expect(lean.startsWith('<hierarchy>\n')).toBe(true)
    expect(lean.trimEnd().endsWith('</hierarchy>')).toBe(true)
  })

  it('drops attributes an agent never targets and boolean attributes that are false', () => {
    for (const attr of ['package=', 'index=', 'class=', 'focusable=', 'focused=', 'displayed=', 'checkable=', 'enabled="true"', 'clickable="false"', 'password="false"', 'text=""']) {
      expect(lean).not.toContain(` ${attr}`)
    }
    expect(lean).not.toContain('<?xml')
  })

  it('passes entity-escaped values through verbatim', () => {
    expect(lean).toContain('text="Network &amp; internet"')
    expect(lean).toContain('content-desc="Account &amp; profile"')
    expect(lean).not.toContain('&amp;amp;')
  })
})

describe('leanTree on an XCUITest settings screen', () => {
  const {kind, lean} = leanTree(IOS)
  const lines = leanLines(lean)
  const raw = rawElements(IOS)

  it('is classified ios and is at least 60% smaller than the raw source', () => {
    expect(kind).toBe('ios')
    expect(raw.length).toBeGreaterThanOrEqual(60)
    expect(1 - Buffer.byteLength(lean) / Buffer.byteLength(IOS)).toBeGreaterThanOrEqual(0.6)
  })

  it('keeps every element with a name, label, value or accessible flag, with its frame and tag', () => {
    const targetable = raw.filter(({attrs}) => attrs.name || attrs.label || attrs.value || attrs.accessible === 'true')
    expect(targetable.length).toBeGreaterThan(40)
    for (const {tag, attrs} of targetable) {
      const expected = {x: attrs.x, y: attrs.y, width: attrs.width, height: attrs.height}
      for (const k of ['name', 'label', 'value']) if (attrs[k]) expected[k] = attrs[k]
      expect(hasLine(lines, tag, expected), `${tag} ${JSON.stringify(expected)}`).toBe(true)
    }
  })

  it('keeps scroll containers, drops unnamed wrappers and redundant attributes', () => {
    expect(hasLine(lines, 'XCUIElementTypeTable', {x: '0', y: '0'})).toBe(true)
    expect(lean.startsWith('<AppiumAUT>\n')).toBe(true)
    expect(lean).not.toContain('<XCUIElementTypeWindow')
    for (const attr of ['type=', 'index=', 'accessible=', 'enabled="true"', 'visible="true"']) {
      expect(lean).not.toContain(` ${attr}`)
    }
  })

  it('passes entity-escaped values through verbatim', () => {
    expect(lean).toContain('label="Privacy &amp; Security"')
    expect(lean).not.toContain('&amp;amp;')
  })
})

describe('leanNativeTree rules', () => {
  it('hoists the qualifying descendants of dropped wrappers to the wrapper depth', () => {
    const src = [
      '<hierarchy rotation="0">',
      '  <android.widget.FrameLayout index="0" class="android.widget.FrameLayout" text="" resource-id="" clickable="false" bounds="[0,0][1080,2400]">',
      '    <android.widget.LinearLayout index="0" text="" resource-id="" clickable="false" bounds="[0,0][1080,2400]">',
      '      <android.widget.Button index="0" text="OK" resource-id="" clickable="true" enabled="true" bounds="[10,10][200,90]" />',
      '    </android.widget.LinearLayout>',
      '  </android.widget.FrameLayout>',
      '</hierarchy>'
    ].join('\n')
    expect(leanNativeTree(src)).toBe([
      '<hierarchy>',
      '  <android.widget.Button text="OK" clickable="true" bounds="[10,10][200,90]" />',
      '</hierarchy>',
      ''
    ].join('\n'))
  })

  it('keeps enabled="false" and other true-valued state flags; drops false ones', () => {
    const src = '<hierarchy><android.widget.EditText text="" hint="Email" resource-id="app:id/email" password="true" enabled="false" selected="false" long-clickable="true" bounds="[0,0][1,1]" /></hierarchy>'
    expect(leanNativeTree(src)).toBe([
      '<hierarchy>',
      '  <android.widget.EditText hint="Email" resource-id="app:id/email" password="true" enabled="false" long-clickable="true" bounds="[0,0][1,1]" />',
      '</hierarchy>',
      ''
    ].join('\n'))
  })

  it('keeps iOS enabled / visible only when false', () => {
    const src = '<AppiumAUT><XCUIElementTypeButton type="XCUIElementTypeButton" name="Pay" label="Pay" enabled="false" visible="false" accessible="true" x="1" y="2" width="3" height="4" index="0"/></AppiumAUT>'
    expect(leanNativeTree(src)).toBe([
      '<AppiumAUT>',
      '  <XCUIElementTypeButton name="Pay" label="Pay" enabled="false" visible="false" x="1" y="2" width="3" height="4" />',
      '</AppiumAUT>',
      ''
    ].join('\n'))
  })

  it('passes numeric and quote entities through verbatim', () => {
    const src = '<hierarchy><android.widget.TextView text="Line&#10;two &quot;quoted&quot; &lt;b&gt;" bounds="[0,0][1,1]" /></hierarchy>'
    expect(leanNativeTree(src)).toContain('text="Line&#10;two &quot;quoted&quot; &lt;b&gt;"')
  })

  it('returns malformed native input unchanged', () => {
    const src = '<hierarchy><android.widget.Button text="OK" bounds="[0,0][1,1]"></hierarchy>'
    expect(leanNativeTree(src)).toBe(src)
  })
})

describe('leanTree dispatch', () => {
  it('webview input returns exactly the stripWebviewDom output', () => {
    const {kind, lean} = leanTree(WEBVIEW)
    expect(kind).toBe('webview')
    expect(lean).toBe(stripWebviewDom(WEBVIEW))
  })

  it('unknown input passes through unchanged', () => {
    const src = '<root><child a="1"/></root>'
    expect(leanTree(src)).toEqual({kind: 'unknown', lean: src})
    expect(leanTree('')).toEqual({kind: 'unknown', lean: ''})
  })
})

describe('ui-tree.js CLI', () => {
  const run = (args) => new Promise((res) => {
    execFile('node', [SCRIPT, ...args], {timeout: 5000}, (err, stdout, stderr) => res({code: err ? err.code : 0, stdout, stderr}))
  })

  it('writes the lean view of a source file to stdout', async () => {
    const r = await run([join(__dirname, '__fixtures__', 'uiautomator2-settings.xml')])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe(leanTree(ANDROID).lean)
  })

  it('unwraps a WebDriver {"value": ...} envelope', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ui-tree-'))
    const file = join(dir, 'source.json')
    writeFileSync(file, JSON.stringify({value: IOS}))
    const r = await run([file])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe(leanTree(IOS).lean)
  })

  it('exits non-zero with a usage line when no file is given', async () => {
    const r = await run([])
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('usage')
  })
})
