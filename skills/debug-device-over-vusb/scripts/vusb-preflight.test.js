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
  // The preflight asks `pgrep -x dcb` whether a virtualUSB daemon is running; answer "no" so a
  // daemon on the machine running the tests cannot change the outcome.
  mkdirSync(join(home, 'shim'))
  writeFileSync(join(home, 'shim', 'pgrep'), '#!/bin/bash\nexit 1\n', {mode: 0o755})
  // The fake bundles are unsigned: shim codesign to report Kobiton's team unless a test says otherwise.
  signing(true)
})

// signing(valid) -> shims `codesign` to pass (or fail) verification for Kobiton's team id
function signing(valid) {
  writeFileSync(join(home, 'shim', 'codesign'), valid
    ? '#!/bin/bash\n[ "$1" = "-dv" ] && echo "TeamIdentifier=4X2699AQKX" >&2\nexit 0\n'
    : '#!/bin/bash\nexit 1\n', {mode: 0o755})
}

// runningDcb(version) -> shims pgrep/ps so a daemon at <version> appears to be running
function runningDcb(version) {
  const dcb = join(home, 'shim', 'fake-dcb')
  writeFileSync(dcb, `#!/bin/bash\necho "deviceBridge ${version}"\n`, {mode: 0o755})
  writeFileSync(join(home, 'shim', 'pgrep'), '#!/bin/bash\necho 4242\n', {mode: 0o755})
  writeFileSync(join(home, 'shim', 'ps'), `#!/bin/bash\necho "${dcb}"\n`, {mode: 0o755})
}
afterEach(() => {
  rmSync(home, {recursive: true, force: true})
})

const baseEnv = () => ({HOME: home, KOBITON_VUSB_BASE_URL: CLOSED_BASE_URL, PATH: `${join(home, 'shim')}:${process.env.PATH}`})

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
  // A real /Applications/virtualUSB.app on the test machine must not leak in; tests that need one pass it.
  const darwin = () => ({...baseEnv(), KOBITON_VUSB_PLATFORM_OVERRIDE: 'Darwin', KOBITON_VUSB_SYSTEM_APP: join(home, 'nope.app')})

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

  it.each([['1.2.3', 'older'], ['9999.1.0+master.abc1234', 'newer']])(
    'uses a system install at another version (%s) with a drift warning (%s)', (version, relation) => {
      const app = join(home, 'Applications', 'virtualUSB.app')
      const bin = makeFakeApp(app, version)
      const r = run(PREFLIGHT, [], {...darwin(), KOBITON_VUSB_SYSTEM_APP: app})
      expect(r.code).toBe(0)
      const kv = parse(r.stdout)
      expect(kv.installed).toBe(version)
      expect(kv.vusb).toBe(bin)
      expect(kv.outcome).toBe('no action needed')
      expect(r.stderr).toContain(`virtualUSB ${version} is installed in ${app}; this plugin was validated with ${PIN} ` +
        `(the installed client is ${relation}). Continuing with the installed client`)
      // no second copy unpacked, no download attempted
      expect(existsSync(join(home, '.kobiton', 'vusb', PIN))).toBe(false)
    })

  it('re-verifies a cached pinned bundle: a failed signature is not a cache hit', () => {
    makeFakeApp(join(home, '.kobiton', 'vusb', PIN, 'virtualUSB.app'), PIN)
    signing(false)
    const r = run(PREFLIGHT, [], darwin())
    expect(r.code).toBe(0)
    expect(r.stderr).toContain(`the cached build ${PIN} failed verification (signature or version); downloading it again`)
    // the closed-port download fails and the unverified bundle is not offered as a fallback
    expect(parse(r.stdout).outcome).toBe('handed off to human')
    expect(parse(r.stdout).vusb).toBe('')
  })

  it('re-verifies a cached pinned bundle: a wrong --version is not a cache hit', () => {
    makeFakeApp(join(home, '.kobiton', 'vusb', PIN, 'virtualUSB.app'), '0.0.1')
    const r = run(PREFLIGHT, [], darwin())
    expect(r.stderr).toContain('failed verification (signature or version)')
  })

  it('hands off when a running daemon (dcb) is another version than the client in use', () => {
    makeFakeApp(join(home, '.kobiton', 'vusb', PIN, 'virtualUSB.app'), PIN)
    runningDcb('1.0.0')
    const r = run(PREFLIGHT, [], darwin())
    expect(r.code).toBe(0)
    expect(parse(r.stdout).outcome).toBe('handed off to human')
    expect(r.stderr).toContain(`a virtualUSB daemon from another install is running (dcb 1.0.0), but this machine's client is virtualUSB ${PIN}`)
  })

  it('accepts a running daemon at the version of the client in use', () => {
    makeFakeApp(join(home, '.kobiton', 'vusb', PIN, 'virtualUSB.app'), PIN)
    runningDcb(PIN)
    const r = run(PREFLIGHT, [], darwin())
    expect(parse(r.stdout).outcome).toBe('no action needed')
    expect(r.stderr).not.toContain('daemon')
  })

  it('hands off when an old cache exists and a foreign daemon runs (pin not cached)', () => {
    makeFakeApp(join(home, '.kobiton', 'vusb', '1.0.0', 'virtualUSB.app'), '1.0.0')
    runningDcb('5.5.5')
    const r = run(PREFLIGHT, [], darwin())
    // download fails on the closed port, the old cache is used, and its version must match the daemon
    expect(parse(r.stdout).installed).toBe('1.0.0')
    expect(parse(r.stdout).outcome).toBe('handed off to human')
    expect(r.stderr).toContain('(dcb 5.5.5), but this machine\'s client is virtualUSB 1.0.0')
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

describe('vusb-preflight.sh on Windows (platform forced, cached installer)', () => {
  // A cached pinned .msi skips the download; no vusb.exe exists, so the preflight hands off.
  const windows = (path) => ({...baseEnv(), KOBITON_VUSB_PLATFORM_OVERRIDE: 'MINGW64_NT-10.0', PATH: path})
  const cacheMsi = () => {
    mkdirSync(join(home, '.kobiton', 'vusb', PIN), {recursive: true})
    writeFileSync(join(home, '.kobiton', 'vusb', PIN, 'windows.msi'), 'msi')
  }

  it('names the adb folder for the administrator terminal when adb is on PATH', () => {
    cacheMsi()
    writeFileSync(join(home, 'shim', 'adb'), '#!/bin/bash\n', {mode: 0o755})
    const r = run(PREFLIGHT, [], windows(`${join(home, 'shim')}:/usr/bin:/bin`))
    expect(r.code).toBe(0)
    expect(parse(r.stdout).outcome).toBe('handed off to human')
    expect(r.stderr).toContain(`2. Open an administrator terminal (cmd). If it runs as a different account than yours, first run: set "PATH=%PATH%;${join(home, 'shim')}"`)
    expect(r.stderr).toContain('Then run: "C:\\Program Files\\virtualUSB\\vusb.exe" setup-adb')
    expect(r.stderr).toContain('3. Re-run this preflight.')
    expect(r.stderr).not.toContain('Platform-Tools')
  })

  it('adds an install-adb step before setup-adb when adb is not on PATH', () => {
    cacheMsi()
    const r = run(PREFLIGHT, [], windows(`${join(home, 'shim')}:/usr/bin:/bin`))
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('2. Install Android SDK Platform-Tools and add its folder to your PATH')
    expect(r.stderr).toContain('3. Open an administrator terminal (cmd). If it runs as a different account than yours, first run: set "PATH=%PATH%;<platform-tools folder>"')
    expect(r.stderr).toContain('4. Re-run this preflight.')
  })
})

describe('vusb.sh wrapper', () => {
  const darwin = () => ({HOME: home, KOBITON_VUSB_PLATFORM_OVERRIDE: 'Darwin', KOBITON_VUSB_SYSTEM_APP: join(home, 'nope.app')})

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

  it('prefers a system install at another version and warns about the drift', () => {
    makeFakeApp(join(home, '.kobiton', 'vusb', PIN, 'virtualUSB.app'), PIN)
    const app = join(home, 'Applications', 'virtualUSB.app')
    makeFakeApp(app, '1.2.3')
    const r = run(WRAPPER, ['--version'], {...darwin(), KOBITON_VUSB_SYSTEM_APP: app})
    expect(r.stdout.trim()).toBe('virtualUSB 1.2.3')
    expect(r.stderr).toContain(`Warning: using virtualUSB 1.2.3 from ${app}; this plugin was validated with ${PIN}`)
  })

  it('fails with the preflight hint when no client is installed', () => {
    const r = run(WRAPPER, ['status'], {...darwin(), KOBITON_VUSB_SYSTEM_APP: join(home, 'nope.app')})
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/not installed/)
    expect(r.stderr).toMatch(/vusb-preflight\.sh/)
  })
})
