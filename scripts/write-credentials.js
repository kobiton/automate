// Writes ~/.kobiton/.credentials for /automate:setup without the API key ever
// passing through the AI host (model context, tool-call arguments, permission
// prompts, transcript).
//
// Flow:
//   1. `--init` creates a random verifier, keeps it in a private pending file
//      next to the credentials file, and prints only its S256 challenge.
//   2. The host passes the challenge to the `getCredential` MCP tool, which
//      returns a single-use, short-lived exchange token bound to it.
//   3. `--token … --portal … --profile …` redeems the token together with the
//      verifier directly against the Kobiton API, writes the profile, and
//      prints only the last 4 characters of the key.
//
// Output protocol (one line per result on stdout):
//   CHALLENGE <challenge>                  --init
//   WROTE <profile> (key …<last4>)         --token
//   PROFILE_FREE                           --show-profile, profile absent
//   PROFILE_EXISTS + KEY=value lines       --show-profile, key masked to last 4
//   ERROR <CODE> <message>                 then exit 1
//
// Node built-ins only; runs anywhere the host runs (macOS, Linux, Windows).

import {createHash, randomBytes} from 'node:crypto'
import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync} from 'node:fs'
import {request as httpsRequest} from 'node:https'
import {request as httpRequest} from 'node:http'
import {dirname, join} from 'node:path'
import {homedir} from 'node:os'
import {parseArgs} from 'node:util'
import {URL} from 'node:url'

const CREDENTIALS_FILE = process.env.KOBITON_CREDENTIALS_FILE
  || join(homedir(), '.kobiton', '.credentials')
const PENDING_FILE = join(dirname(CREDENTIALS_FILE), '.setup-pending')
const REDEEM_PATH = '/v2/mcp-credentials/redeem'
const PROFILE_NAME = /^[A-Za-z0-9._-]+$/

function emit(line) { process.stdout.write(line + '\n') }
function fatal(code, message) { emit(`ERROR ${code} ${message}`); process.exit(1) }

export function maskKey(key) {
  return key && key.length >= 4 ? `…${key.slice(-4)}` : '…'
}

export function s256(verifier) {
  return createHash('sha256').update(verifier).digest('base64url')
}

// Only Kobiton API hosts (api.kobiton.com, api-<env>.kobiton.com) receive the
// token + verifier. The portal value comes from the MCP tool result via the AI
// host, so a prompt-injected URL must not be able to redirect the exchange, not
// even to another kobiton.com subdomain. Self-hosted deployments list their API
// host(s) in KOBITON_SETUP_TRUSTED_HOSTS (comma-separated).
export function isTrustedPortal(portal, env = process.env) {
  let u
  try { u = new URL(portal) }
  catch { return false }
  const host = u.hostname.toLowerCase()
  if (env.KOBITON_SETUP_ALLOW_INSECURE_LOCALHOST === '1'
    && u.protocol === 'http:' && host === '127.0.0.1') return true
  if (u.protocol !== 'https:') return false
  const extra = (env.KOBITON_SETUP_TRUSTED_HOSTS || '')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
  return host === 'api.kobiton.com' || /^api-[a-z0-9-]+\.kobiton\.com$/.test(host) || extra.includes(host)
}

// The credentials file is INI-ish: `[profile]` headers followed by KEY=value
// lines. Returns [preamble, name1, body1, name2, body2, ...].
function splitProfiles(text) {
  return text.split(/^\s*\[\s*([^\]]+?)\s*\]\s*$/m)
}

function readProfiles() {
  if (!existsSync(CREDENTIALS_FILE)) return null
  return splitProfiles(readFileSync(CREDENTIALS_FILE, 'utf8'))
}

function findProfile(name) {
  const parts = readProfiles()
  if (!parts) return null
  for (let i = 1; i < parts.length; i += 2) {
    if (parts[i].trim() === name) return parts[i + 1]
  }
  return null
}

function parseFields(body) {
  const fields = {}
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';') || !line.includes('=')) continue
    const idx = line.indexOf('=')
    fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return fields
}

// Replaces the profile in place (keeping every other profile and its position)
// or appends it, then swaps the file in atomically with mode 0600.
function writeProfile(name, {username, apiKey, portal}) {
  const newBlock = `[${name}]\nKOBITON_USER=${username}\nKOBITON_API_KEY=${apiKey}\nKOBITON_PORTAL=${portal}`
  const parts = readProfiles()
  let blocks
  if (parts) {
    const head = parts[0].trim()
    blocks = head ? [head] : []
    let replaced = false
    for (let i = 1; i < parts.length; i += 2) {
      const sectionName = parts[i].trim()
      if (sectionName === name) {
        blocks.push(newBlock)
        replaced = true
      }
      else {
        blocks.push(`[${sectionName}]\n${parts[i + 1].trim()}`)
      }
    }
    if (!replaced) blocks.push(newBlock)
  }
  else {
    blocks = [newBlock]
  }
  mkdirSync(dirname(CREDENTIALS_FILE), {recursive: true})
  const tmp = CREDENTIALS_FILE + '.tmp'
  writeFileSync(tmp, blocks.join('\n\n') + '\n', {mode: 0o600})
  renameSync(tmp, CREDENTIALS_FILE)
  // POSIX modes don't map onto NTFS ACLs; best effort on Windows.
  try { chmodSync(CREDENTIALS_FILE, 0o600) }
  catch {}
}

function postJson(baseUrl, path, body) {
  return new Promise((resolve) => {
    let u
    try { u = new URL(baseUrl.replace(/\/+$/, '') + path) }
    catch (err) { return resolve({error: `bad-url ${err.message}`}) }
    const payload = JSON.stringify(body)
    const isHttps = u.protocol === 'https:'
    const req = (isHttps ? httpsRequest : httpRequest)({
      protocol: u.protocol, hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      method: 'POST', path: u.pathname + u.search,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 60_000
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let data
        try { data = JSON.parse(text) }
        catch { data = null }
        resolve({status: res.statusCode, data})
      })
    })
    req.on('timeout', () => { req.destroy(); resolve({error: 'timeout'}) })
    req.on('error', (err) => resolve({error: err.message}))
    req.end(payload)
  })
}

function errorMessageOf(data) {
  const e = data && data.error
  if (e && typeof e === 'object' && typeof e.message === 'string') return e.message
  if (typeof e === 'string') return e
  if (data && typeof data.message === 'string') return data.message
  return ''
}

function init() {
  const verifier = randomBytes(32).toString('base64url')
  mkdirSync(dirname(PENDING_FILE), {recursive: true})
  writeFileSync(PENDING_FILE, JSON.stringify({verifier, createdAt: new Date().toISOString()}), {mode: 0o600})
  try { chmodSync(PENDING_FILE, 0o600) }
  catch {}
  emit(`CHALLENGE ${s256(verifier)}`)
}

function showProfile(name) {
  const body = findProfile(name)
  if (body === null) {
    emit('PROFILE_FREE')
    return
  }
  const fields = parseFields(body)
  emit('PROFILE_EXISTS')
  emit(`KOBITON_USER=${fields.KOBITON_USER || ''}`)
  emit(`KOBITON_PORTAL=${fields.KOBITON_PORTAL || ''}`)
  emit(`KOBITON_API_KEY=${maskKey(fields.KOBITON_API_KEY || '')}`)
}

async function redeem({token, portal, profile, overwrite}) {
  if (!token) fatal('MISSING_ARGUMENT', '--token is required')
  if (!portal) fatal('MISSING_ARGUMENT', '--portal is required')
  if (!profile || !PROFILE_NAME.test(profile)) {
    fatal('INVALID_PROFILE', '--profile must be letters, digits, dot, dash or underscore')
  }
  if (!isTrustedPortal(portal)) {
    fatal('UNTRUSTED_PORTAL', `${portal} is not a Kobiton API host; refusing to send the setup token there`)
  }
  // Checked before redeeming so a conflict doesn't burn the single-use token.
  if (!overwrite && findProfile(profile) !== null) {
    fatal('PROFILE_EXISTS', `profile [${profile}] already exists; pass --overwrite to replace it`)
  }
  if (!existsSync(PENDING_FILE)) {
    fatal('NO_PENDING_SETUP', 'no pending setup found; run --init first')
  }
  let verifier
  try { verifier = JSON.parse(readFileSync(PENDING_FILE, 'utf8')).verifier }
  catch { verifier = null }
  if (!verifier) fatal('NO_PENDING_SETUP', 'the pending setup file is unreadable; run --init again')

  const res = await postJson(portal, REDEEM_PATH, {exchangeToken: token, verifier})
  // The server consumes the token on any redeem it processes (2xx or 400), so
  // the verifier is useless from then on. Keep it for a retry when the request
  // never reached redeem: network error, rate limit (429) or outage (5xx).
  const tokenSpent = !res.error && (res.status === 400 || (res.status >= 200 && res.status < 300))
  if (tokenSpent) rmSync(PENDING_FILE, {force: true})
  if (res.error) fatal('REQUEST_FAILED', res.error)
  if (res.status < 200 || res.status >= 300) {
    fatal(`HTTP_${res.status}`, errorMessageOf(res.data) || 'redeem failed')
  }
  const {username, apiKey} = res.data || {}
  if (!username || !apiKey) fatal('BAD_RESPONSE', 'redeem response is missing fields')

  // KOBITON_PORTAL is the API base the caller passed: the canonical URL getCredential returned,
  // already trust-checked above. The redeem response's own `portal` can be a deployment-specific
  // host, which must not be pinned into the user's credentials file.
  writeProfile(profile, {username, apiKey, portal: new URL(portal).origin})
  emit(`WROTE ${profile} (key ${maskKey(apiKey)})`)
}

async function main() {
  const {values} = parseArgs({
    options: {
      'init': {type: 'boolean'},
      'token': {type: 'string'},
      'portal': {type: 'string'},
      'profile': {type: 'string'},
      'overwrite': {type: 'boolean'},
      'show-profile': {type: 'string'}
    },
    strict: true
  })

  if (values.init) return init()
  if (values['show-profile'] !== undefined) return showProfile(values['show-profile'])
  if (values.token !== undefined) {
    return redeem({
      token: values.token,
      portal: values.portal,
      profile: values.profile,
      overwrite: !!values.overwrite
    })
  }
  fatal('USAGE', 'use --init, --show-profile <name>, or --token <t> --portal <url> --profile <name> [--overwrite]')
}

// Only run when executed directly, so the helpers stay importable in tests.
if (process.argv[1]?.endsWith('write-credentials.js')) {
  main().catch((err) => fatal('UNEXPECTED', err.message))
}
