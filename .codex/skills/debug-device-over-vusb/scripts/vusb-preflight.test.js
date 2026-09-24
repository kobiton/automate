import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {spawnSync} from 'node:child_process'
import {resolve, join} from 'node:path'
import {mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync, readdirSync, lstatSync, readlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'

const PREFLIGHT = resolve(import.meta.dirname, 'vusb-preflight.sh')
const WRAPPER = resolve(import.meta.dirname, 'vusb.sh')
const PIN = readFileSync(resolve(import.meta.dirname, '..', 'VUSB_VERSION'), 'utf8').trim()

// Use /bin/bash absolute so PATH games in the environment can't break bash resolution.
const BASH = '/bin/bash'
// A closed port: any download attempt fails fast with curl code 000 instead of touching the network.
const CLOSED_BASE_URL = 'http://127.0.0.1:9'

function run(script, args, env) {
  const r = spawnSync(BASH, [script, ...args], {
    encoding: 'utf8',
    timeout: 20000,
    env: {...process.env, ...env}
  })
  return {code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? ''}
}

// `key=value` stdout lines -> object (first `=` splits)
function parse(stdout) {
  const out = {}
  for (const line of stdout.split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1)
  }
  return out
}

function lastLine(stdout) {
  return stdout.trimEnd().split('\n').at(-1)
}

// Writes a fake client script at <appDir>/Contents/MacOS/vusb that prints
// `virtualUSB <version>` for --version and otherwise echoes its arguments.
function makeFakeApp(appDir, version) {
  const macos = join(appDir, 'Contents', 'MacOS')
  mkdirSync(macos, {recursive: true})
  const bin = join(macos, 'vusb')
  writeFileSync(bin, `#!/bin/bash\nif [ "\${1:-}" = "--version" ]; then echo "virtualUSB ${version}"; exit 0; fi\nprintf 'ARG:%s\\n' "$@"\n`, {mode: 0o755})
  return bin
}

let home
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'vusb-preflight-'))
})
afterEach(() => {
  rmSync(home, {recursive: true, force: true})
})

const baseEnv = () => ({HOME: home, KOBITON_VUSB_BASE_URL: CLOSED_BASE_URL})

describe('vusb-preflight.sh on unsupported hosts', () => {
  it('redirects Linux hosts: exit 0, outcome label, nothing cached, no download', () => {
    const r = run(PREFLIGHT, [], {...baseEnv(), KOBITON_VUSB_PLATFORM_OVERRIDE: 'Linux'})
    expect(r.code).toBe(0)
    const kv = parse(r.stdout)
    expect(kv.platform).toBe('linux')
    expect(kv.pin).toBe(PIN)
    expect(kv.outcome).toBe('redirected (limitation)')
    expect(lastLine(r.stdout)).toBe('outcome=redirected (limitation)')
    expect(r.stderr).toMatch(/Linux hosts are not supported/)
    expect(existsSync(join(home, '.kobiton', 'vusb'))).toBe(false)
    expect(existsSync(join(home, '.kobiton', 'bin', 'vusb'))).toBe(false)
  })

  it('redirects unknown platforms the same way', () => {
    const r = run(PREFLIGHT, [], {...baseEnv(), KOBITON_VUSB_PLATFORM_OVERRIDE: 'Plan9'})
    expect(r.code).toBe(0)
    const kv = parse(r.stdout)
    expect(kv.platform).toBe('unknown')
    expect(kv.outcome).toBe('redirected (limitation)')
    expect(r.stderr).toMatch(/unsupported platform 'Plan9'/)
    expect(existsSync(join(home, '.kobiton'))).toBe(false)
  })
})

describe('vusb-preflight.sh on macOS (platform forced, no real package)', () => {
  const darwin = () => ({...baseEnv(), KOBITON_VUSB_PLATFORM_OVERRIDE: 'Darwin'})

  it('parses the version token of a system install at the pin: no action needed, no download', () => {
    const app = join(home, 'Applications', 'virtualUSB.app')
    const bin = makeFakeApp(app, PIN)
    const r = run(PREFLIGHT, [], {...darwin(), KOBITON_VUSB_SYSTEM_APP: app})
    expect(r.code).toBe(0)
    const kv = parse(r.stdout)
    expect(kv.installed).toBe(PIN)
    expect(kv.vusb).toBe(bin)
    expect(kv.outcome).toBe('no action needed')
    expect(existsSync(join(home, '.kobiton', 'vusb', PIN))).toBe(false)
  })

  it('hands off when the system install reports another version (fake prints "virtualUSB 1.2.3")', () => {
    const app = join(home, 'Applications', 'virtualUSB.app')
    makeFakeApp(app, '1.2.3')
    const r = run(PREFLIGHT, [], {...darwin(), KOBITON_VUSB_SYSTEM_APP: app})
    expect(r.code).toBe(0)
    const kv = parse(r.stdout)
    expect(kv.installed).toBe('1.2.3')
    expect(kv.outcome).toBe('handed off to human')
    expect(r.stderr).toMatch(/virtualUSB 1\.2\.3 is installed/)
    expect(r.stderr).toContain(`this plugin pins ${PIN}`)
    // no second copy unpacked, no download attempted
    expect(existsSync(join(home, '.kobiton', 'vusb', PIN))).toBe(false)
  })

  it('treats a cached pinned bundle as a hit and installs the wrapper symlink', () => {
    const app = join(home, '.kobiton', 'vusb', PIN, 'virtualUSB.app')
    const bin = makeFakeApp(app, PIN)
    const r = run(PREFLIGHT, [], darwin())
    expect(r.code).toBe(0)
    const kv = parse(r.stdout)
    expect(kv.installed).toBe(PIN)
    expect(kv.vusb).toBe(bin)
    expect(kv.outcome).toBe('no action needed')
    const link = join(home, '.kobiton', 'bin', 'vusb')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(WRAPPER)
  })

  it('tolerates an unreachable download host with no cache: exit 0, handed off, no partial download', () => {
    const r = run(PREFLIGHT, [], {...darwin(), KOBITON_VUSB_SYSTEM_APP: join(home, 'nope.app')})
    expect(r.code).toBe(0)
    const kv = parse(r.stdout)
    expect(kv.outcome).toBe('handed off to human')
    expect(kv.installed).toBe('')
    expect(r.stderr).toMatch(/network unavailable/)
    const cache = join(home, '.kobiton', 'vusb')
    expect(existsSync(join(cache, PIN))).toBe(false)
    expect(readdirSync(cache).filter((f) => f.startsWith('.download.'))).toEqual([])
  })
})

describe('vusb.sh wrapper', () => {
  const darwin = () => ({HOME: home, KOBITON_VUSB_PLATFORM_OVERRIDE: 'Darwin'})

  it('resolves the cached pinned bundle and passes --version through', () => {
    makeFakeApp(join(home, '.kobiton', 'vusb', PIN, 'virtualUSB.app'), PIN)
    const r = run(WRAPPER, ['--version'], darwin())
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe(`virtualUSB ${PIN}`)
  })

  it('injects --apibaseurl/--username/--apikey from the credentials profile on login', () => {
    makeFakeApp(join(home, '.kobiton', 'vusb', PIN, 'virtualUSB.app'), PIN)
    writeFileSync(join(home, '.kobiton', '.credentials'),
      '[default]\nKOBITON_USER = alice\nKOBITON_API_KEY = secret-key\nKOBITON_PORTAL = https://portal.example.com/\n')
    const r = run(WRAPPER, ['login'], darwin())
    expect(r.code).toBe(0)
    expect(r.stdout.split('\n').filter(Boolean)).toEqual([
      'ARG:login', 'ARG:--apibaseurl', 'ARG:https://api.example.com',
      'ARG:--username', 'ARG:alice', 'ARG:--apikey', 'ARG:secret-key'
    ])
  })

  it('leaves login untouched when --apikey is given explicitly', () => {
    makeFakeApp(join(home, '.kobiton', 'vusb', PIN, 'virtualUSB.app'), PIN)
    const r = run(WRAPPER, ['login', '--apikey', 'k', '--username', 'u', '--apibaseurl', 'https://api.example.com'], darwin())
    expect(r.code).toBe(0)
    expect(r.stdout.split('\n').filter(Boolean)).toEqual([
      'ARG:login', 'ARG:--apikey', 'ARG:k', 'ARG:--username', 'ARG:u', 'ARG:--apibaseurl', 'ARG:https://api.example.com'
    ])
  })

  it('fails with the preflight hint when no client is installed', () => {
    const r = run(WRAPPER, ['status'], {...darwin(), KOBITON_VUSB_SYSTEM_APP: join(home, 'nope.app')})
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/not installed/)
    expect(r.stderr).toMatch(/vusb-preflight\.sh/)
  })
})
