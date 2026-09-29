import {describe, it, expect, beforeAll, afterAll, beforeEach} from 'vitest'
import {execFile} from 'node:child_process'
import {createServer} from 'node:http'
import {existsSync, mkdtempSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {isTrustedPortal, maskKey, s256} from './write-credentials.js'

const SCRIPT = resolve(import.meta.dirname, 'write-credentials.js')
const API_KEY = 'fake-test-value-not-a-real-key-wxyz'

// Mock redeem endpoint: records every request, answers with `state.reply`.
const state = {requests: [], reply: null}
let server, port

beforeAll(() => new Promise((res) => {
  server = createServer((req, resp) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      state.requests.push({method: req.method, url: req.url, body: JSON.parse(Buffer.concat(chunks).toString() || '{}')})
      resp.writeHead(state.reply.status, {'Content-Type': 'application/json'})
      resp.end(JSON.stringify(state.reply.body))
    })
  })
  server.listen(0, '127.0.0.1', () => { port = server.address().port; res() })
}))

afterAll(() => new Promise((res) => server.close(res)))

let dir, credsFile, portal

beforeEach(() => {
  state.requests = []
  state.reply = {status: 200, body: {username: 'jane', apiKey: API_KEY, portal: 'https://api.kobiton.com'}}
  dir = mkdtempSync(join(tmpdir(), 'write-credentials-'))
  credsFile = join(dir, '.credentials')
  portal = `http://127.0.0.1:${port}`
})

function run(args, env = {}) {
  return new Promise((res) => {
    execFile('node', [SCRIPT, ...args], {
      timeout: 15000,
      env: {...process.env, KOBITON_CREDENTIALS_FILE: credsFile, KOBITON_SETUP_ALLOW_INSECURE_LOCALHOST: '1', ...env}
    }, (err, stdout, stderr) => res({code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || ''}))
  })
}

async function initChallenge() {
  const r = await run(['--init'])
  return r.stdout.trim().replace(/^CHALLENGE /, '')
}

describe('write-credentials.js --init', () => {
  it('prints only an S256 challenge of the stored verifier', async () => {
    const r = await run(['--init'])

    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/^CHALLENGE [A-Za-z0-9_-]{43}\n$/)
    const pending = JSON.parse(readFileSync(join(dir, '.setup-pending'), 'utf8'))
    expect(s256(pending.verifier)).toBe(r.stdout.trim().split(' ')[1])
    expect(r.stdout).not.toContain(pending.verifier)
  })

  it.skipIf(process.platform === 'win32')('stores the verifier with mode 0600', async () => {
    await run(['--init'])
    expect(statSync(join(dir, '.setup-pending')).mode & 0o777).toBe(0o600)
  })
})

describe('write-credentials.js --token', () => {
  it('redeems with the verifier, writes the profile, and prints only the last 4', async () => {
    const challenge = await initChallenge()

    const r = await run(['--token', 'tok-1', '--portal', portal, '--profile', 'default'])

    expect(r.code).toBe(0)
    expect(r.stdout).toBe('WROTE default (key …wxyz)\n')
    expect(r.stdout + r.stderr).not.toContain(API_KEY)
    expect(state.requests).toHaveLength(1)
    expect(state.requests[0].url).toBe('/v2/mcp-credentials/redeem')
    expect(state.requests[0].body.exchangeToken).toBe('tok-1')
    expect(s256(state.requests[0].body.verifier)).toBe(challenge)
    expect(readFileSync(credsFile, 'utf8')).toBe(
      `[default]\nKOBITON_USER=jane\nKOBITON_API_KEY=${API_KEY}\nKOBITON_PORTAL=https://api.kobiton.com\n`)
    expect(existsSync(join(dir, '.setup-pending'))).toBe(false)
  })

  it('accepts a token that begins with a dash in the --token= form', async () => {
    await initChallenge()

    const r = await run(['--token=-starts-with-dash', `--portal=${portal}`, '--profile=default'])

    expect(r.code).toBe(0)
    expect(state.requests[0].body.exchangeToken).toBe('-starts-with-dash')
  })

  it('refuses to write a portal the server returns that is not a Kobiton host', async () => {
    state.reply = {status: 200, body: {username: 'jane', apiKey: API_KEY, portal: 'https://evil.example'}}
    await initChallenge()

    const r = await run(['--token', 't', '--portal', portal, '--profile', 'default'])

    expect(r.code).toBe(1)
    expect(r.stdout).toMatch(/^ERROR UNTRUSTED_PORTAL/)
    expect(existsSync(credsFile)).toBe(false)
  })

  it('keeps other profiles and their positions when overwriting one', async () => {
    writeFileSync(credsFile, [
      '[prod]', 'KOBITON_USER=a', 'KOBITON_API_KEY=old', 'KOBITON_PORTAL=https://api.kobiton.com', '',
      '[test]', 'KOBITON_USER=b', 'KOBITON_API_KEY=keep', 'KOBITON_PORTAL=https://api-test.kobiton.com', ''
    ].join('\n'))
    await initChallenge()

    const r = await run(['--token', 't', '--portal', portal, '--profile', 'prod', '--overwrite'])

    expect(r.code).toBe(0)
    const text = readFileSync(credsFile, 'utf8')
    expect(text.indexOf('[prod]')).toBeLessThan(text.indexOf('[test]'))
    expect(text).toContain(`KOBITON_API_KEY=${API_KEY}`)
    expect(text).toContain('KOBITON_API_KEY=keep')
    expect(text).not.toContain('KOBITON_API_KEY=old')
  })

  it('refuses an existing profile without --overwrite, before spending the token', async () => {
    writeFileSync(credsFile, '[default]\nKOBITON_USER=a\nKOBITON_API_KEY=k\nKOBITON_PORTAL=p\n')
    await initChallenge()

    const r = await run(['--token', 't', '--portal', portal, '--profile', 'default'])

    expect(r.code).toBe(1)
    expect(r.stdout).toMatch(/^ERROR PROFILE_EXISTS/)
    expect(state.requests).toHaveLength(0)
    expect(existsSync(join(dir, '.setup-pending'))).toBe(true)
  })

  it('refuses a non-Kobiton portal without sending anything', async () => {
    await initChallenge()

    const r = await run(['--token', 't', '--portal', portal, '--profile', 'default'],
      {KOBITON_SETUP_ALLOW_INSECURE_LOCALHOST: ''})

    expect(r.code).toBe(1)
    expect(r.stdout).toMatch(/^ERROR UNTRUSTED_PORTAL/)
    expect(state.requests).toHaveLength(0)
  })

  it('surfaces a server rejection and writes nothing', async () => {
    state.reply = {status: 400, body: {error: {message: 'The setup token is invalid, expired, or already used. Run /automate:setup again.', code: 400}}}
    await initChallenge()

    const r = await run(['--token', 't', '--portal', portal, '--profile', 'default'])

    expect(r.code).toBe(1)
    expect(r.stdout).toBe('ERROR HTTP_400 The setup token is invalid, expired, or already used. Run /automate:setup again.\n')
    expect(existsSync(credsFile)).toBe(false)
  })

  it('asks for --init when there is no pending setup', async () => {
    const r = await run(['--token', 't', '--portal', portal, '--profile', 'default'])

    expect(r.code).toBe(1)
    expect(r.stdout).toMatch(/^ERROR NO_PENDING_SETUP/)
    expect(state.requests).toHaveLength(0)
  })

  it('rejects a profile name that could break the file format', async () => {
    await initChallenge()

    const r = await run(['--token', 't', '--portal', portal, '--profile', 'a]\nKOBITON_API_KEY=x'])

    expect(r.code).toBe(1)
    expect(r.stdout).toMatch(/^ERROR INVALID_PROFILE/)
  })
})

describe('write-credentials.js --show-profile', () => {
  it('reports a free profile', async () => {
    const r = await run(['--show-profile', 'default'])
    expect(r.stdout).toBe('PROFILE_FREE\n')
  })

  it('shows an existing profile with the key masked to the last 4', async () => {
    writeFileSync(credsFile, `[default]\nKOBITON_USER=jane\nKOBITON_API_KEY=${API_KEY}\nKOBITON_PORTAL=https://api.kobiton.com\n`)

    const r = await run(['--show-profile', 'default'])

    expect(r.stdout).toBe('PROFILE_EXISTS\nKOBITON_USER=jane\nKOBITON_PORTAL=https://api.kobiton.com\nKOBITON_API_KEY=…wxyz\n')
    expect(r.stdout).not.toContain(API_KEY.slice(0, 8))
  })
})

describe('helpers', () => {
  it('trusts https Kobiton API hosts only', () => {
    expect(isTrustedPortal('https://api.kobiton.com', {})).toBe(true)
    expect(isTrustedPortal('https://api-test.kobiton.com', {})).toBe(true)
    expect(isTrustedPortal('http://api.kobiton.com', {})).toBe(false)
    expect(isTrustedPortal('https://kobiton.com.evil.example', {})).toBe(false)
    expect(isTrustedPortal('https://evilkobiton.com', {})).toBe(false)
    expect(isTrustedPortal('not a url', {})).toBe(false)
    expect(isTrustedPortal('https://kobiton.internal.acme', {KOBITON_SETUP_TRUSTED_HOSTS: 'kobiton.internal.acme'})).toBe(true)
  })

  it('masks to the last 4 characters', () => {
    expect(maskKey(API_KEY)).toBe('…wxyz')
    expect(maskKey('abc')).toBe('…')
  })
})
