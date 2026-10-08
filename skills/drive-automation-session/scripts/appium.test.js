import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import {execFile} from 'node:child_process'
import {createServer} from 'node:http'
import {createHash} from 'node:crypto'
import {writeFileSync, mkdtempSync, readFileSync, existsSync, readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'

const SCRIPT = resolve(import.meta.dirname, 'appium.js')

const state = {hits: [], handler: () => ({status: 200, body: {value: {}}})}
let server, port

beforeAll(() => new Promise((res) => {
  server = createServer((req, resp) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let parsedBody = null
      if (raw) {
        try { parsedBody = JSON.parse(raw) } catch { parsedBody = raw }
      }
      state.hits.push({method: req.method, path: req.url, body: parsedBody, headers: req.headers})
      const out = state.handler(state.hits[state.hits.length - 1])
      resp.writeHead(out.status, out.headers || {'Content-Type': 'application/json'})
      resp.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body))
    })
  })
  server.listen(0, '127.0.0.1', () => {
    port = server.address().port
    res()
  })
}))

afterAll(() => new Promise((res) => server.close(res)))

function reset(handler) {
  state.hits.length = 0
  state.handler = handler || (() => ({status: 200, body: {value: {}}}))
}

function run(args, env) {
  return new Promise((res) => {
    const childEnv = env ? {...process.env, ...env} : undefined
    execFile('node', [SCRIPT, ...args], {timeout: 5000, env: childEnv}, (err, stdout, stderr) => {
      if (err) res({ok: false, code: err.code, stdout: stdout || '', stderr: stderr || ''})
      else res({ok: true, code: 0, stdout, stderr})
    })
  })
}

function writeTemp(name, content) {
  const dir = mkdtempSync(join(tmpdir(), 'drive-automation-session-'))
  const path = join(dir, name)
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content))
  return path
}

function makeSessionDir() {
  return mkdtempSync(join(tmpdir(), 'drive-automation-session-sess-'))
}

// The one timestamp every artifact in `dir` shares (one appium.js call per dir).
function soleTs(dir) {
  const stamps = new Set(readdirSync(dir).map((f) => f.match(/^[a-z]+-(\d+)\./)?.[1]).filter(Boolean))
  expect(stamps.size).toBe(1)
  return Number([...stamps][0])
}

let credsFilePath
function makeCredsFile({portal = `http://127.0.0.1:${port}`, user = 'u', apiKey = 'k'} = {}) {
  credsFilePath = writeTemp('.credentials', [
    `KOBITON_USER=${user}`,
    `KOBITON_API_KEY=${apiKey}`,
    `KOBITON_PORTAL=${portal}`
  ].join('\n') + '\n')
  return credsFilePath
}
function credEnv(overrides = {}) {
  return {KOBITON_CREDENTIALS_FILE: makeCredsFile(overrides)}
}
function runWithCreds(args, env) {
  return run(args, {...credEnv(), ...(env || {})})
}

describe('appium.js generic mode', () => {
  it('GET prepends /wd/hub to --url automatically', async () => {
    reset(() => ({status: 200, body: {value: '<hierarchy />'}}))
    const r = await runWithCreds(['--method', 'GET', '--url', '/session/sess-1/source'])
    expect(r.ok).toBe(true)
    expect(state.hits[0].method).toBe('GET')
    expect(state.hits[0].path).toBe('/wd/hub/session/sess-1/source')
    expect(JSON.parse(r.stdout).value).toBe('<hierarchy />')
  })

  it('accepts --url with /wd/hub already present', async () => {
    reset(() => ({status: 200, body: {value: '<x/>'}}))
    const r = await runWithCreds(['--method', 'GET', '--url', '/wd/hub/session/sess-2/source'])
    expect(r.ok).toBe(true)
    expect(state.hits[0].path).toBe('/wd/hub/session/sess-2/source')
  })

  it('POST with inline --req-body sends correct body', async () => {
    reset(() => ({status: 200, body: {value: {ELEMENT: 'el-1'}}}))
    await runWithCreds(['--method', 'POST', '--url', '/session/sess-3/element', '--req-body', '{"using":"xpath","value":"//Button"}'])
    expect(state.hits[0].body).toEqual({using: 'xpath', value: '//Button'})
  })

  it('POST with @file --req-body reads from disk', async () => {
    reset(() => ({status: 200, body: {value: {sessionId: 'sess-new'}}}))
    const capsFile = writeTemp('caps.json', {capabilities: {alwaysMatch: {platformName: 'Android'}}})
    await runWithCreds(['--method', 'POST', '--url', '/session', '--req-body', `@${capsFile}`])
    expect(state.hits[0].body).toEqual({capabilities: {alwaysMatch: {platformName: 'Android'}}})
  })

  it('POST /session auto-wraps a flat caps body in the W3C envelope', async () => {
    // render-capabilities.js emits flat caps; the host passes them through
    // without manual wrapping. appium.js wraps them on the fly so the host
    // doesn't have to remember the W3C shape.
    reset(() => ({status: 200, body: {value: {sessionId: 'sess-w3c'}}}))
    const flatCaps = {platformName: 'Android', 'appium:udid': '21161FDF60051K'}
    await runWithCreds(['--method', 'POST', '--url', '/session', '--req-body', JSON.stringify(flatCaps)])
    expect(state.hits[0].body).toEqual({capabilities: {alwaysMatch: flatCaps}})
  })

  it('POST /session leaves an already-wrapped body alone', async () => {
    reset(() => ({status: 200, body: {value: {sessionId: 'sess-pre'}}}))
    const wrapped = {capabilities: {alwaysMatch: {platformName: 'iOS'}}}
    await runWithCreds(['--method', 'POST', '--url', '/session', '--req-body', JSON.stringify(wrapped)])
    expect(state.hits[0].body).toEqual(wrapped)
  })

  it('POST to a non-session URL does NOT auto-wrap (no false positives)', async () => {
    reset(() => ({status: 200, body: {value: 'el-1'}}))
    const elemBody = {using: 'xpath', value: '//Button'}
    await runWithCreds(['--method', 'POST', '--url', '/session/sX/element', '--req-body', JSON.stringify(elemBody)])
    // element-find body has no `capabilities` key but it's NOT /session — must not be wrapped
    expect(state.hits[0].body).toEqual(elemBody)
  })

  it('DELETE /session/{id} treats 404 as success', async () => {
    reset(() => ({status: 404, body: {value: {error: 'invalid session id'}}}))
    const r = await runWithCreds(['--method', 'DELETE', '--url', '/session/gone'])
    expect(r.ok).toBe(true)
  })

  it('Appium error → exit 0; stderr = {status} + raw body (host classifies)', async () => {
    reset(() => ({status: 404, body: {value: {error: 'no such element', message: 'not found'}}}))
    const r = await runWithCreds(['--method', 'POST', '--url', '/session/x/element', '--req-body', '{"using":"xpath","value":"//Missing"}'])
    // Script exits 0 — host reads the stderr (or error-<ts>.json) to classify.
    expect(r.ok).toBe(true)
    const [summary, ...bodyLines] = r.stderr.trim().split('\n')
    expect(JSON.parse(summary).status).toBe(404)
    expect(JSON.parse(bodyLines.join('\n'))).toEqual({value: {error: 'no such element', message: 'not found'}})
  })

  it('invalid session id (non-DELETE) → exit 0; raw body lets host detect "session gone"', async () => {
    reset(() => ({status: 404, body: {value: {error: 'invalid session id'}}}))
    const r = await runWithCreds(['--method', 'POST', '--url', '/session/x/element', '--req-body', '{}'])
    expect(r.ok).toBe(true)
    expect(JSON.parse(r.stderr.trim().split('\n')[0]).status).toBe(404)
  })

  it('5xx server error → exit 0; raw body preserved', async () => {
    reset(() => ({status: 500, body: {value: {error: 'unknown', message: 'server down'}}}))
    const r = await runWithCreds(['--method', 'GET', '--url', '/session/x/source'])
    expect(r.ok).toBe(true)
    expect(JSON.parse(r.stderr.trim().split('\n')[0]).status).toBe(500)
  })

  it('response exceeding the size cap is aborted (exit 0; error surfaced)', async () => {
    // Return a body larger than the test cap (set via env below).
    reset(() => ({status: 200, body: {value: 'x'.repeat(5000)}}))
    const r = await runWithCreds(
      ['--method', 'GET', '--url', '/session/x/source'],
      {KOBITON_MAX_RESPONSE_BYTES: '1024'}
    )
    expect(r.ok).toBe(true) // single exit-code policy
    expect(r.stderr).toMatch(/exceeded 1024 bytes|request/i)
  })
})

describe('appium.js credentials', () => {
  it('reads ~/.kobiton/.credentials and builds the Basic Auth header from it', async () => {
    reset(() => ({status: 200, body: {value: '<x/>'}}))
    await runWithCreds(['--method', 'GET', '--url', '/session/s/source'])
    expect(state.hits[0].headers['authorization']).toBe('Basic ' + Buffer.from('u:k').toString('base64'))
  })

  it('missing credentials file → exit 0; stderr says to run /automate:setup', async () => {
    const r = await run(
      ['--method', 'GET', '--url', '/session/s/source'],
      {KOBITON_CREDENTIALS_FILE: '/nonexistent/path/.credentials'}
    )
    expect(r.ok).toBe(true)
    expect(r.stderr).toMatch(/not found/)
    expect(r.stderr).toContain('/automate:setup')
  })

  it('partial credentials file (missing KOBITON_API_KEY) → exit 0; stderr names the missing key family', async () => {
    const partial = writeTemp('.credentials', 'KOBITON_USER=u\nKOBITON_PORTAL=http://x\n')
    const r = await run(
      ['--method', 'GET', '--url', '/session/s/source'],
      {KOBITON_CREDENTIALS_FILE: partial}
    )
    expect(r.ok).toBe(true)
    expect(r.stderr).toMatch(/missing one or more/)
    expect(r.stderr).toContain('KOBITON_API_KEY')
  })

  it('credentials with shell metacharacters are read as LITERAL strings (no eval)', async () => {
    reset(() => ({status: 200, body: {value: '<x/>'}}))
    const tampered = writeTemp('.credentials',
      'KOBITON_USER=alice; rm -rf /tmp/should-not-execute\n' +
      'KOBITON_API_KEY=secret`whoami`\n' +
      `KOBITON_PORTAL=http://127.0.0.1:${port}\n`
    )
    await run(
      ['--method', 'GET', '--url', '/session/s/source'],
      {KOBITON_CREDENTIALS_FILE: tampered}
    )
    const expected = 'Basic ' + Buffer.from('alice; rm -rf /tmp/should-not-execute:secret`whoami`').toString('base64')
    expect(state.hits[0].headers['authorization']).toBe(expected)
  })

  it('--hub-url overrides the credentials file (legacy / debugging escape hatch)', async () => {
    reset(() => ({status: 200, body: {value: '<x/>'}}))
    const url = `http://${encodeURIComponent('u@x')}:${encodeURIComponent('k:z')}@127.0.0.1:${port}/wd/hub`
    await run(['--hub-url', url, '--method', 'GET', '--url', '/session/s/source'])
    expect(state.hits[0].headers['authorization']).toBe('Basic ' + Buffer.from('u@x:k:z').toString('base64'))
  })

})

describe('appium.js screen helper', () => {
  const NATIVE = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<hierarchy index="0" class="hierarchy" rotation="0" width="1080" height="2400">',
    '  <android.widget.FrameLayout index="0" package="com.example" class="android.widget.FrameLayout" text="" resource-id="" clickable="false" enabled="true" bounds="[0,0][1080,2400]">',
    '    <android.widget.Button index="0" package="com.example" class="android.widget.Button" text="OK" content-desc="confirm" resource-id="com.example:id/ok" clickable="true" enabled="true" focusable="true" bounds="[100,1800][620,1920]" />',
    '  </android.widget.FrameLayout>',
    '</hierarchy>'
  ].join('\n')
  const NATIVE_LEAN = [
    '<hierarchy>',
    '  <android.widget.Button text="OK" content-desc="confirm" resource-id="com.example:id/ok" clickable="true" bounds="[100,1800][620,1920]" />',
    '</hierarchy>',
    ''
  ].join('\n')

  it('default: captures BOTH XML and PNG (so native overlays show up)', async () => {
    const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')
    let callIdx = 0
    reset(() => {
      callIdx += 1
      if (callIdx === 1) return {status: 200, body: {value: NATIVE}}
      return {status: 200, body: {value: pngB64}}
    })
    const dir = makeSessionDir()
    const before = Math.floor(Date.now() / 1000)
    const r = await runWithCreds(['screen', '--session-id', 'sess-s', '--session-dir', dir])
    expect(r.ok).toBe(true)
    expect(state.hits).toHaveLength(2)
    expect(state.hits[0].path).toBe('/wd/hub/session/sess-s/source')
    expect(state.hits[1].path).toBe('/wd/hub/session/sess-s/screenshot')
    const stdout = JSON.parse(r.stdout)
    const ts = stdout.ts
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))
    // stdout names the files it wrote, so the host knows what to read.
    expect(stdout.source).toBe(`source-${ts}.xml`)
    expect(stdout.fullSource).toBe(`source-${ts}.full.xml`)
    expect(stdout.screenshot).toBe(`screenshot-${ts}.png`)
    expect(readdirSync(dir).sort()).toEqual([
      `request-${ts}.json`, `response-${ts}.json`, `screenshot-${ts}.png`, `source-${ts}.full.xml`, `source-${ts}.xml`
    ])
    // Hash covers what the host reads (the lean source-<ts>.xml) plus the PNG.
    const expected = createHash('sha256').update(NATIVE_LEAN).update(Buffer.from(pngB64, 'base64')).digest('hex')
    expect(stdout.hash).toBe(expected)
    expect(stdout.mode).toBe('lean')
    expect(stdout.xmlBytes).toBe(Buffer.byteLength(NATIVE_LEAN))
    expect(stdout.fullXmlBytes).toBe(Buffer.byteLength(NATIVE))
    expect(stdout.pngBytes).toBeGreaterThan(0)
    expect(JSON.parse(readFileSync(join(dir, `response-${ts}.json`), 'utf8'))).toEqual(stdout)
  })

  it('native source: source-<ts>.xml is the lean view; source-<ts>.full.xml is the raw /source', async () => {
    reset(() => ({status: 200, body: {value: NATIVE}}))
    const dir = makeSessionDir()
    const r = await runWithCreds(['screen', '--session-id', 'sess-nv', '--session-dir', dir, '--xml-only'])
    expect(r.ok).toBe(true)
    const stdout = JSON.parse(r.stdout)
    expect(readFileSync(join(dir, stdout.source), 'utf8')).toBe(NATIVE_LEAN)
    expect(readFileSync(join(dir, stdout.fullSource), 'utf8')).toBe(NATIVE)
    expect(stdout.hash).toBe(createHash('sha256').update(NATIVE_LEAN).digest('hex'))
    expect(stdout.mode).toBe('lean')
  })

  it('--xml-only: skips screenshot; only /source is hit', async () => {
    reset(() => ({status: 200, body: {value: NATIVE}}))
    const dir = makeSessionDir()
    const r = await runWithCreds(['screen', '--session-id', 'sess-x', '--session-dir', dir, '--xml-only'])
    expect(r.ok).toBe(true)
    expect(state.hits).toHaveLength(1)
    expect(state.hits[0].path).toBe('/wd/hub/session/sess-x/source')
    const stdout = JSON.parse(r.stdout)
    const {ts} = stdout
    expect(existsSync(join(dir, `source-${ts}.xml`))).toBe(true)
    expect(existsSync(join(dir, `source-${ts}.full.xml`))).toBe(true)
    expect(existsSync(join(dir, `screenshot-${ts}.png`))).toBe(false)
    expect(stdout.screenshot).toBeUndefined()
    expect(stdout.pngBytes).toBe(0)
    expect(stdout.hash).toBe(createHash('sha256').update(NATIVE_LEAN).digest('hex'))
  })

  it('--png-only: skips source; only /screenshot is hit and no XML is written', async () => {
    const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')
    reset(() => ({status: 200, body: {value: pngB64}}))
    const dir = makeSessionDir()
    const r = await runWithCreds(['screen', '--session-id', 'sess-p', '--session-dir', dir, '--png-only'])
    expect(r.ok).toBe(true)
    expect(state.hits).toHaveLength(1)
    expect(state.hits[0].path).toBe('/wd/hub/session/sess-p/screenshot')
    const stdout = JSON.parse(r.stdout)
    const {ts} = stdout
    expect(existsSync(join(dir, `source-${ts}.xml`))).toBe(false)
    expect(existsSync(join(dir, `source-${ts}.full.xml`))).toBe(false)
    expect(existsSync(join(dir, `screenshot-${ts}.png`))).toBe(true)
    expect(stdout.source).toBeUndefined()
    expect(stdout.fullSource).toBeUndefined()
    expect(stdout.screenshot).toBe(`screenshot-${ts}.png`)
    expect(stdout.xmlBytes).toBe(0)
    expect(stdout.fullXmlBytes).toBe(0)
    expect(stdout.pngBytes).toBeGreaterThan(0)
  })

  it('--xml-only AND --png-only is a usage error', async () => {
    const dir = makeSessionDir()
    const r = await runWithCreds(['screen', '--session-id', 'x', '--session-dir', dir, '--xml-only', '--png-only'])
    expect(r.ok).toBe(true) // exit 0 always
    expect(r.stderr).toContain('mutually exclusive')
  })

  it('--full on a native screen writes the raw tree to source-<ts>.xml (the pre-lean behaviour)', async () => {
    reset(() => ({status: 200, body: {value: NATIVE}}))
    const dir = makeSessionDir()
    const r = await runWithCreds(['screen', '--session-id', 'sess-fn', '--session-dir', dir, '--full', '--xml-only'])
    expect(r.ok).toBe(true)
    const stdout = JSON.parse(r.stdout)
    expect(readFileSync(join(dir, stdout.source), 'utf8')).toBe(NATIVE)
    expect(readFileSync(join(dir, stdout.fullSource), 'utf8')).toBe(NATIVE)
    expect(stdout.mode).toBe('full')
    expect(stdout.hash).toBe(createHash('sha256').update(NATIVE).digest('hex'))
    expect(stdout.xmlBytes).toBe(stdout.fullXmlBytes)
    const req = JSON.parse(readFileSync(join(dir, `request-${stdout.ts}.json`), 'utf8'))
    expect(req.argv).toContain('--full')
  })

  it('--full on a webview screen writes the stripped DOM to source-<ts>.xml (same as the lean view)', async () => {
    const raw = '<html><head><script>noise()</script></head><body><div role="button" aria-label="Search" jsdata="x">icon</div></body></html>'
    reset(() => ({status: 200, body: {value: raw}}))
    const dir = makeSessionDir()
    const r = await runWithCreds(['screen', '--session-id', 'sess-fw', '--session-dir', dir, '--full', '--xml-only'])
    expect(r.ok).toBe(true)
    const stdout = JSON.parse(r.stdout)
    const stripped = readFileSync(join(dir, stdout.source), 'utf8')
    expect(stripped).not.toContain('<script')
    expect(stripped).toContain('aria-label="Search"')
    expect(readFileSync(join(dir, stdout.fullSource), 'utf8')).toBe(raw)
    expect(stdout.mode).toBe('full')
  })

  it('--full combined with the default capture still writes the PNG', async () => {
    const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')
    let callIdx = 0
    reset(() => {
      callIdx += 1
      return callIdx === 1 ? {status: 200, body: {value: NATIVE}} : {status: 200, body: {value: pngB64}}
    })
    const dir = makeSessionDir()
    const r = await runWithCreds(['screen', '--session-id', 'sess-fp', '--session-dir', dir, '--full'])
    expect(r.ok).toBe(true)
    expect(state.hits).toHaveLength(2)
    const stdout = JSON.parse(r.stdout)
    expect(existsSync(join(dir, stdout.screenshot))).toBe(true)
    expect(readFileSync(join(dir, stdout.source), 'utf8')).toBe(NATIVE)
  })

  it('persists request-<ts>.json with the audit argv', async () => {
    reset(() => ({status: 200, body: {value: '<y/>'}}))
    const dir = makeSessionDir()
    const r = await runWithCreds(['screen', '--session-id', 'sess-rq', '--session-dir', dir])
    const req = JSON.parse(readFileSync(join(dir, `request-${JSON.parse(r.stdout).ts}.json`), 'utf8'))
    expect(req.argv).toContain('screen')
    expect(req.argv).toContain('sess-rq')
    expect(req.argv).not.toContain('--full')
  })

  it('a failed /source writes error-<ts>.json and no source files (stdout empty)', async () => {
    reset(() => ({status: 404, body: {value: {error: 'invalid session id'}}}))
    const dir = makeSessionDir()
    const r = await runWithCreds(['screen', '--session-id', 'gone', '--session-dir', dir])
    expect(r.ok).toBe(true)
    expect(r.stdout).toBe('')
    expect(JSON.parse(r.stderr.trim().split('\n')[0]).status).toBe(404)
    const ts = soleTs(dir)
    expect(readdirSync(dir).sort()).toEqual([`error-${ts}.json`, `request-${ts}.json`, 'session.log'])
    expect(readFileSync(join(dir, 'session.log'), 'utf8')).toBe(`ts=${ts} error\n`)
  })

  it('requires --session-dir (stderr names --session-dir; exit 0)', async () => {
    const r = await runWithCreds(['screen', '--session-id', 'x'])
    expect(r.ok).toBe(true)
    expect(r.stderr).toContain('--session-dir')
  })

  it('webview source: writes stripped source-<ts>.xml AND raw source-<ts>.full.xml', async () => {
    const raw = '<html><head><script>noise()</script></head><body><div role="button" aria-label="Search YouTube" jsdata="x">icon</div></body></html>'
    reset(() => ({status: 200, body: {value: raw}}))
    const dir = makeSessionDir()
    const r = await runWithCreds(['screen', '--session-id', 'sess-wv', '--session-dir', dir, '--xml-only'])
    expect(r.ok).toBe(true)
    const stdout = JSON.parse(r.stdout)
    const stripped = readFileSync(join(dir, `source-${stdout.ts}.xml`), 'utf8')
    const full = readFileSync(join(dir, `source-${stdout.ts}.full.xml`), 'utf8')
    expect(full).toBe(raw)
    expect(stripped).not.toContain('<script')
    expect(stripped).not.toContain('jsdata=')
    expect(stripped).toContain('aria-label="Search YouTube"')
    // Hash is computed on the stripped XML, not the raw, so screen-hash
    // equality reflects what the host actually reads.
    expect(stdout.hash).toBe(createHash('sha256').update(stripped).digest('hex'))
    expect(stdout.xmlBytes).toBe(Buffer.byteLength(stripped))
    expect(stdout.fullXmlBytes).toBe(Buffer.byteLength(raw))
    expect(stdout.mode).toBe('lean')
  })

  it('webview detection is leading-whitespace tolerant and case-insensitive', async () => {
    const raw = '\n  <HTML><body><div jsdata="x">hi</div></body></HTML>'
    reset(() => ({status: 200, body: {value: raw}}))
    const dir = makeSessionDir()
    const r = await runWithCreds(['screen', '--session-id', 'sess-ws', '--session-dir', dir, '--xml-only'])
    expect(readFileSync(join(dir, JSON.parse(r.stdout).source), 'utf8')).not.toContain('jsdata=')
  })

  it('webview detection accepts an XML declaration before <html (chromedriver path)', async () => {
    // UiAutomator2 chromedriver commonly prepends <?xml version="1.0"?> to
    // webview /source responses. The first 200 bytes still carry <html, so
    // the strip should fire.
    const raw = '<?xml version="1.0" encoding="UTF-8"?><html><body><div jsdata="x">hi</div></body></html>'
    reset(() => ({status: 200, body: {value: raw}}))
    const dir = makeSessionDir()
    const r = await runWithCreds(['screen', '--session-id', 'sess-xml', '--session-dir', dir, '--xml-only'])
    expect(r.ok).toBe(true)
    const stripped = readFileSync(join(dir, JSON.parse(r.stdout).source), 'utf8')
    expect(stripped).not.toContain('jsdata=') // strip actually ran
  })

  it('webview detection accepts a DOCTYPE before <html', async () => {
    const raw = '<!DOCTYPE html><html><body><span jsdata="x">hi</span></body></html>'
    reset(() => ({status: 200, body: {value: raw}}))
    const dir = makeSessionDir()
    const r = await runWithCreds(['screen', '--session-id', 'sess-dt', '--session-dir', dir, '--xml-only'])
    expect(readFileSync(join(dir, JSON.parse(r.stdout).source), 'utf8')).not.toContain('jsdata=')
  })

  it('webview detection accepts a UTF-8 BOM before <html', async () => {
    const raw = '﻿<html><body><i jsdata="x">hi</i></body></html>'
    reset(() => ({status: 200, body: {value: raw}}))
    const dir = makeSessionDir()
    const r = await runWithCreds(['screen', '--session-id', 'sess-bom', '--session-dir', dir, '--xml-only'])
    expect(readFileSync(join(dir, JSON.parse(r.stdout).source), 'utf8')).not.toContain('jsdata=')
  })

  it('native UiAutomator2 source is NOT misclassified as webview (gets the native lean view)', async () => {
    const raw = '<hierarchy><android.widget.FrameLayout text=""><android.widget.Button text="OK"/></android.widget.FrameLayout></hierarchy>'
    reset(() => ({status: 200, body: {value: raw}}))
    const dir = makeSessionDir()
    const r = await runWithCreds(['screen', '--session-id', 'sess-ua2', '--session-dir', dir, '--xml-only'])
    expect(readFileSync(join(dir, JSON.parse(r.stdout).source), 'utf8')).toBe('<hierarchy>\n  <android.widget.Button text="OK" />\n</hierarchy>\n')
    expect(readFileSync(join(dir, JSON.parse(r.stdout).fullSource), 'utf8')).toBe(raw)
  })

  it('native XCUITest source is NOT misclassified as webview (gets the native lean view)', async () => {
    const raw = '<SCREEN><XCUIElementTypeApplication name="App"><XCUIElementTypeOther accessible="false"><XCUIElementTypeButton name="OK"/></XCUIElementTypeOther></XCUIElementTypeApplication></SCREEN>'
    reset(() => ({status: 200, body: {value: raw}}))
    const dir = makeSessionDir()
    const r = await runWithCreds(['screen', '--session-id', 'sess-xc', '--session-dir', dir, '--xml-only'])
    expect(readFileSync(join(dir, JSON.parse(r.stdout).source), 'utf8')).toBe([
      '<SCREEN>',
      '  <XCUIElementTypeApplication name="App">',
      '    <XCUIElementTypeButton name="OK" />',
      '  </XCUIElementTypeApplication>',
      '</SCREEN>',
      ''
    ].join('\n'))
    expect(readFileSync(join(dir, JSON.parse(r.stdout).fullSource), 'utf8')).toBe(raw)
  })

  it('unrecognised source passes through to source-<ts>.xml unchanged', async () => {
    const raw = '<root><child a="1"/></root>'
    reset(() => ({status: 200, body: {value: raw}}))
    const dir = makeSessionDir()
    const r = await runWithCreds(['screen', '--session-id', 'sess-un', '--session-dir', dir, '--xml-only'])
    expect(readFileSync(join(dir, JSON.parse(r.stdout).source), 'utf8')).toBe(raw)
  })
})

describe('appium.js persistence (--session-dir)', () => {
  it('generic call persists request-<ts>.json + response-<ts>.json on success; stdout is the raw body', async () => {
    reset(() => ({status: 200, body: {value: {ELEMENT: 'el-x'}}}))
    const dir = makeSessionDir()
    const r = await runWithCreds(['--method', 'POST', '--url', '/session/s/element', '--req-body', '{"using":"xpath","value":"//B"}', '--session-dir', dir])
    // Act stdout stays the raw WebDriver body (the host pipes it to jq).
    expect(JSON.parse(r.stdout)).toEqual({value: {ELEMENT: 'el-x'}})
    const ts = soleTs(dir)
    expect(readdirSync(dir).sort()).toEqual([`request-${ts}.json`, `response-${ts}.json`])
    const req = JSON.parse(readFileSync(join(dir, `request-${ts}.json`), 'utf8'))
    expect(req.argv).toContain('--method')
    expect(req.argv).toContain('POST')
    const resp = JSON.parse(readFileSync(join(dir, `response-${ts}.json`), 'utf8'))
    expect(resp).toEqual({value: {ELEMENT: 'el-x'}})
  })

  it('generic call persists error-<ts>.json on failure (exit 0, host classifies)', async () => {
    reset(() => ({status: 404, body: {value: {error: 'no such element'}}}))
    const dir = makeSessionDir()
    const r = await runWithCreds(['--method', 'POST', '--url', '/session/s/element', '--req-body', '{"using":"xpath","value":"//Missing"}', '--session-dir', dir])
    // Script exits 0 in all Appium-response cases; the failure shows on
    // stderr (stdout stays empty) and in error-<ts>.json.
    expect(r.ok).toBe(true)
    expect(r.stdout).toBe('')
    const ts = soleTs(dir)
    const err = readFileSync(join(dir, `error-${ts}.json`), 'utf8')
    expect(r.stderr).toBe(err)
    const [summary, ...bodyLines] = err.trim().split('\n')
    expect(JSON.parse(summary).status).toBe(404)
    expect(JSON.parse(bodyLines.join('\n'))).toEqual({value: {error: 'no such element'}})
    expect(existsSync(join(dir, `response-${ts}.json`))).toBe(false)
  })

  it('no --session-dir → no files written', async () => {
    reset(() => ({status: 200, body: {value: '<x/>'}}))
    const dir = makeSessionDir()
    await runWithCreds(['--method', 'GET', '--url', '/session/s/source'])
    // dir is empty; nothing should land there
    expect(readdirSync(dir)).toEqual([])
  })

  it('timestamp already taken by any artifact kind → the next free second', async () => {
    reset(() => ({status: 200, body: {value: '<x/>'}}))
    const dir = makeSessionDir()
    // Occupy the next five seconds with one artifact of each kind, so the
    // call lands on now + 5 even if the clock ticks while the child starts.
    const now = Math.floor(Date.now() / 1000)
    const kinds = ['request-%.json', 'screenshot-%.png', 'source-%.full.xml', 'control-%.json', 'error-%.json']
    kinds.forEach((k, i) => writeFileSync(join(dir, k.replace('%', String(now + i))), ''))
    await runWithCreds(['--method', 'GET', '--url', '/session/s/source', '--session-dir', dir])
    expect(existsSync(join(dir, `request-${now + 5}.json`))).toBe(true)
    expect(existsSync(join(dir, `response-${now + 5}.json`))).toBe(true)
  })

  it('consecutive calls get distinct timestamps that sort in call order', async () => {
    reset(() => ({status: 200, body: {value: '<x/>'}}))
    const dir = makeSessionDir()
    const a = await runWithCreds(['screen', '--session-id', 's', '--session-dir', dir, '--xml-only'])
    const b = await runWithCreds(['screen', '--session-id', 's', '--session-dir', dir, '--xml-only'])
    const c = await runWithCreds(['control', '--done', '--reason', 'r', '--session-dir', dir])
    const [ta, tb, tc] = [a, b, c].map((r) => JSON.parse(r.stdout).ts)
    expect(tb).toBeGreaterThan(ta)
    expect(tc).toBeGreaterThan(tb)
    const requests = readdirSync(dir).filter((f) => f.startsWith('request-')).sort()
    expect(requests).toEqual([`request-${ta}.json`, `request-${tb}.json`])
  })
})

describe('appium.js turn warning and session.log', () => {
  // Stand-ins for earlier screen / act turns: request files stamped well in
  // the past, so the call under test still takes the current second.
  let seedBase = Math.floor(Date.now() / 1000) - 1_000_000
  function seedTurns(dir, n) {
    for (let i = 0; i < n; i += 1) {
      seedBase += 1
      writeFileSync(join(dir, `request-${seedBase}.json`), '{"argv":[]}\n')
    }
  }
  const screen = (dir) => runWithCreds(['screen', '--session-id', 's', '--session-dir', dir, '--xml-only'])
  const logPath = (dir) => join(dir, 'session.log')
  const warningLines = (dir) => existsSync(logPath(dir))
    ? readFileSync(logPath(dir), 'utf8').split('\n').filter((l) => l.endsWith(' warning'))
    : []

  it('screen stdout carries turns: the screen and act calls so far, this one included', async () => {
    reset(() => ({status: 200, body: {value: '<x/>'}}))
    const dir = makeSessionDir()
    const first = JSON.parse((await screen(dir)).stdout)
    expect(first.turns).toBe(1)
    expect(first.warning).toBeUndefined()
    await runWithCreds(['--method', 'POST', '--url', '/session/s/element', '--req-body', '{"using":"id","value":"a"}', '--session-dir', dir])
    const third = JSON.parse((await screen(dir)).stdout)
    expect(third.turns).toBe(3)
    expect(JSON.parse(readFileSync(join(dir, `response-${third.ts}.json`), 'utf8'))).toEqual(third)
    // Successful calls below the threshold write nothing to session.log.
    expect(existsSync(logPath(dir))).toBe(false)
  })

  it('no warning at 99 turns', async () => {
    reset(() => ({status: 200, body: {value: '<x/>'}}))
    const dir = makeSessionDir()
    seedTurns(dir, 98)
    const r = await screen(dir)
    const out = JSON.parse(r.stdout)
    expect(out.turns).toBe(99)
    expect(out.warning).toBeUndefined()
    expect(existsSync(logPath(dir))).toBe(false)
  })

  it('warns at 100 turns on stdout only, and appends ts=<ts> turns=100 warning to session.log', async () => {
    reset(() => ({status: 200, body: {value: '<x/>'}}))
    const dir = makeSessionDir()
    seedTurns(dir, 99)
    const started = '2026-10-08T00:00:00Z session=s started intent=x\n'
    writeFileSync(logPath(dir), started)
    const r = await screen(dir)
    expect(r.stderr).toBe('')
    const out = JSON.parse(r.stdout)
    expect(out.turns).toBe(100)
    expect(out.warning).toBe('100 turns on this session — check whether the flow is progressing (references/loop-discipline.md, Stuck patterns) and end with control --blocked if it is not')
    expect(JSON.parse(readFileSync(join(dir, `response-${out.ts}.json`), 'utf8'))).toEqual(out)
    // Append-only: the host's lines stay.
    expect(readFileSync(logPath(dir), 'utf8')).toBe(`${started}ts=${out.ts} turns=100 warning\n`)
  })

  it('warns at 125 turns when no warning for 125-149 is logged', async () => {
    reset(() => ({status: 200, body: {value: '<x/>'}}))
    const dir = makeSessionDir()
    seedTurns(dir, 124)
    writeFileSync(logPath(dir), 'ts=1 turns=100 warning\n')
    const out = JSON.parse((await screen(dir)).stdout)
    expect(out.turns).toBe(125)
    expect(out.warning).toMatch(/^125 turns on this session/)
    expect(warningLines(dir)).toEqual(['ts=1 turns=100 warning', `ts=${out.ts} turns=125 warning`])
  })

  it('warns once at 100, not on any screen call from 101 to 124, then again at 125', async () => {
    reset(() => ({status: 200, body: {value: '<x/>'}}))
    const dir = makeSessionDir()
    seedTurns(dir, 99)
    const seen = []
    for (let turn = 100; turn <= 125; turn += 1) {
      const r = await screen(dir)
      expect(r.stderr).toBe('')
      const out = JSON.parse(r.stdout)
      expect(out.turns).toBe(turn)
      if (out.warning) seen.push(out.turns)
    }
    expect(seen).toEqual([100, 125])
    expect(warningLines(dir).map((l) => l.replace(/^ts=\d+ /, ''))).toEqual(['turns=100 warning', 'turns=125 warning'])
  }, 60_000)

  it('a threshold reached by an act call warns on the next screen call; act stdout is unchanged', async () => {
    const body = {value: {ELEMENT: 'el-1'}}
    reset((hit) => hit.path.endsWith('/source') ? {status: 200, body: {value: '<x/>'}} : {status: 200, body})
    const dir = makeSessionDir()
    seedTurns(dir, 98)
    expect(JSON.parse((await screen(dir)).stdout).warning).toBeUndefined()   // turn 99
    const act = await runWithCreds(['--method', 'POST', '--url', '/session/s/element', '--req-body', '{"using":"id","value":"a"}', '--session-dir', dir])   // turn 100
    expect(act.stdout).toBe(JSON.stringify(body) + '\n')
    expect(act.stderr).toBe('')
    expect(warningLines(dir)).toEqual([])
    const next = JSON.parse((await screen(dir)).stdout)   // turn 101
    expect(next.turns).toBe(101)
    expect(next.warning).toMatch(/^101 turns on this session/)
    expect(warningLines(dir)).toEqual([`ts=${next.ts} turns=101 warning`])
    const after = JSON.parse((await screen(dir)).stdout)   // turn 102
    expect(after.warning).toBeUndefined()
  })

  it('an execute or execute/sync call appends a capture-warning line to session.log', async () => {
    reset(() => ({status: 200, body: {value: null}}))
    const dir = makeSessionDir()
    await runWithCreds(['--method', 'POST', '--url', '/session/s/execute/sync', '--req-body', '{"script":"mobile: pressKey","args":[{"keycode":3}]}', '--session-dir', dir])
    const ts = soleTs(dir)
    expect(readFileSync(logPath(dir), 'utf8')).toBe(`ts=${ts} capture-warning=execute/sync url=/session/s/execute/sync\n`)
    const other = makeSessionDir()
    await runWithCreds(['--method', 'POST', '--url', '/session/s/element', '--req-body', '{"using":"id","value":"a"}', '--session-dir', other])
    expect(existsSync(logPath(other))).toBe(false)
  })

  it('a failed call appends ts=<ts> error to session.log after the host lines', async () => {
    reset(() => ({status: 404, body: {value: {error: 'no such element'}}}))
    const dir = makeSessionDir()
    const started = '2026-10-08T00:00:00Z session=s started intent=x\n'
    writeFileSync(logPath(dir), started)
    await runWithCreds(['--method', 'POST', '--url', '/session/s/element', '--req-body', '{"using":"id","value":"a"}', '--session-dir', dir])
    const ts = soleTs(dir)
    expect(readFileSync(logPath(dir), 'utf8')).toBe(`${started}ts=${ts} error\n`)
  })

  it('a failed screen call at a threshold logs the error and leaves the warning for the next screen', async () => {
    let fail = true
    reset(() => fail ? {status: 500, body: {value: {error: 'unknown error'}}} : {status: 200, body: {value: '<x/>'}})
    const dir = makeSessionDir()
    seedTurns(dir, 99)
    const r = await screen(dir)   // turn 100, fails
    expect(r.stdout).toBe('')
    expect(readFileSync(logPath(dir), 'utf8')).toMatch(/^ts=\d+ error\n$/)
    fail = false
    const out = JSON.parse((await screen(dir)).stdout)   // turn 101
    expect(out.warning).toMatch(/^101 turns on this session/)
  })
})

describe('appium.js actions helper', () => {
  it('--type touch builds W3C pointer sequence', async () => {
    reset(() => ({status: 200, body: {value: null}}))
    await runWithCreds(['actions', '--session-id', 'sess-t', '--type', 'touch', '--x', '100', '--y', '200'])
    expect(state.hits[0].path).toBe('/wd/hub/session/sess-t/actions')
    const seq = state.hits[0].body.actions[0]
    expect(seq.actions.map(a => a.type)).toEqual(['pointerMove', 'pointerDown', 'pause', 'pointerUp'])
    expect(seq.actions[0]).toMatchObject({x: 100, y: 200})
    expect(seq.actions[2]).toMatchObject({duration: 50})
  })

  it('--type touch --hold-ms 1000 long-tap pause', async () => {
    reset(() => ({status: 200, body: {value: null}}))
    await runWithCreds(['actions', '--session-id', 'sess-lp', '--type', 'touch', '--x', '50', '--y', '60', '--hold-ms', '1000'])
    expect(state.hits[0].body.actions[0].actions[2]).toMatchObject({duration: 1000})
  })

  it('--type swipe builds 4-step sequence', async () => {
    reset(() => ({status: 200, body: {value: null}}))
    await runWithCreds(['actions', '--session-id', 'sess-sw', '--type', 'swipe', '--from-x', '1', '--from-y', '2', '--to-x', '3', '--to-y', '4', '--duration', '350'])
    const seq = state.hits[0].body.actions[0].actions
    expect(seq.map(a => a.type)).toEqual(['pointerMove', 'pointerDown', 'pointerMove', 'pointerUp'])
    expect(seq[2]).toMatchObject({duration: 350, x: 3, y: 4})
  })

  it('--type key builds keyDown/keyUp', async () => {
    reset(() => ({status: 200, body: {value: null}}))
    await runWithCreds(['actions', '--session-id', 'sess-k', '--type', 'key', '--key', 'Enter'])
    expect(state.hits[0].body.actions[0].actions).toEqual([
      {type: 'keyDown', value: 'Enter'},
      {type: 'keyUp', value: 'Enter'}
    ])
  })

  it('unknown --type exits 1', async () => {
    const r = await runWithCreds(['actions', '--session-id', 'x', '--type', 'noop'])
    expect(r.ok).toBe(true)  // exit 0 always; host detects error via stderr / error-<ts>.json
  })

  it('non-numeric swipe coord exits 1', async () => {
    const r = await runWithCreds(['actions', '--session-id', 'x', '--type', 'swipe', '--from-x', 'abc', '--from-y', '0', '--to-x', '0', '--to-y', '0'])
    expect(r.ok).toBe(true)  // exit 0 always; host detects error via stderr / error-<ts>.json
  })
})

describe('appium.js touch-perform helper', () => {
  it('wraps steps into /touch/perform body', async () => {
    reset(() => ({status: 200, body: {value: null}}))
    const stepsFile = writeTemp('steps.json', [{action: 'press', options: {x: 1, y: 2}}, {action: 'release'}])
    await runWithCreds(['touch-perform', '--session-id', 'sess-tp', '--steps', `@${stepsFile}`])
    expect(state.hits[0].path).toBe('/wd/hub/session/sess-tp/touch/perform')
    expect(state.hits[0].body).toEqual({actions: [{action: 'press', options: {x: 1, y: 2}}, {action: 'release'}]})
  })

  it('--steps not an array exits 1', async () => {
    const f = writeTemp('steps.json', {action: 'press'})
    const r = await runWithCreds(['touch-perform', '--session-id', 'x', '--steps', `@${f}`])
    expect(r.ok).toBe(true)  // exit 0 always; host detects error via stderr / error-<ts>.json
  })
})

describe('appium.js control helper', () => {
  it('--done writes control-<ts>.json with {control: DONE, reason}; stdout adds ts', async () => {
    reset()
    const dir = makeSessionDir()
    const r = await runWithCreds(['control', '--done', '--reason', 'all good', '--session-dir', dir])
    expect(r.ok).toBe(true)
    const out = JSON.parse(r.stdout)
    expect(out).toEqual({ts: out.ts, control: 'DONE', reason: 'all good'})
    expect(readdirSync(dir)).toEqual([`control-${out.ts}.json`])
    const ctl = JSON.parse(readFileSync(join(dir, `control-${out.ts}.json`), 'utf8'))
    expect(ctl).toEqual({control: 'DONE', reason: 'all good'})
    // No HTTP request issued
    expect(state.hits).toHaveLength(0)
  })

  it('--blocked writes control-<ts>.json with {control: BLOCKED, reason}', async () => {
    const dir = makeSessionDir()
    await runWithCreds(['control', '--blocked', '--reason', 'stuck', '--session-dir', dir])
    const ctl = JSON.parse(readFileSync(join(dir, `control-${soleTs(dir)}.json`), 'utf8'))
    expect(ctl).toEqual({control: 'BLOCKED', reason: 'stuck'})
  })

  it('control without --done or --blocked writes error-<ts>.json (exit 0)', async () => {
    const dir = makeSessionDir()
    const r = await runWithCreds(['control', '--reason', 'x', '--session-dir', dir])
    expect(r.ok).toBe(true)  // exit 0 always; host detects error via stderr / error-<ts>.json
    const ts = soleTs(dir)
    expect(readdirSync(dir).sort()).toEqual([`error-${ts}.json`, 'session.log'])
    expect(readFileSync(join(dir, 'session.log'), 'utf8')).toBe(`ts=${ts} error\n`)
  })

  it('control without --session-dir is a usage error (exit 0)', async () => {
    const r = await runWithCreds(['control', '--done', '--reason', 'x'])
    expect(r.ok).toBe(true)  // exit 0 always; host detects error via stderr
    expect(r.stderr).toContain('--session-dir')
  })
})

describe('appium.js usage errors', () => {
  it('unknown helper exits 1', async () => {
    const r = await runWithCreds(['cuddle', '--session-id', 'x'])
    expect(r.ok).toBe(true)  // exit 0 always; host detects error via stderr / error-<ts>.json
    expect(r.stderr).toContain('unknown helper')
  })

  it('generic without --method exits 1', async () => {
    const r = await runWithCreds(['--url', '/session/x/source'])
    expect(r.ok).toBe(true)  // exit 0 always; host detects error via stderr / error-<ts>.json
  })

  it('--req-body invalid JSON exits 0; stderr names bad-input', async () => {
    const r = await runWithCreds(['--method', 'POST', '--url', '/session', '--req-body', 'not json {'])
    expect(r.ok).toBe(true)
    expect(r.stderr).toContain('bad-input')
  })

  it('bad-input with --session-dir writes error-<ts>.json (exit 0)', async () => {
    const dir = makeSessionDir()
    const r = await runWithCreds(['--method', 'POST', '--url', '/session', '--req-body', 'not json {', '--session-dir', dir])
    expect(r.ok).toBe(true)
    const ts = soleTs(dir)
    expect(existsSync(join(dir, `error-${ts}.json`))).toBe(true)
    const err = readFileSync(join(dir, `error-${ts}.json`), 'utf8')
    expect(err).toContain('bad-input')
  })
})
