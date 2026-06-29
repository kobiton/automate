#!/usr/bin/env node
// PostToolUse hook on terminateSession: emit a post-termination advisory
// into agent context noting the cooldown window. Includes the deviceId
// when available so the agent can correlate the cooldown to the right
// device for downstream planning.
//
// Security posture:
// - No network calls.
// - No filesystem writes.
// - Echoes only the deviceId from the response (which the agent already
//   saw via the tool result; this is not new PII).
// - Numeric validation on deviceId before interpolation.

import { stdin } from 'node:process'

const ADVISORY = (deviceIdSuffix) =>
  `Kobiton terminateSession completed${deviceIdSuffix}. The device is now in a ~5-minute ` +
  `cleanup cooldown per R2 finding F33 (kobiton/automate#36). reserveDevice on this ` +
  `device during the cooldown window will return device_unavailable. To proceed sooner, ` +
  `pick a different device via listDevices.`

async function readStdin () {
  const chunks = []
  for await (const chunk of stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function emitAdvisory (text) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: text
    }
  }
  process.stdout.write(JSON.stringify(output))
  process.stdout.write('\n')
}

async function main () {
  let raw
  try {
    raw = await readStdin()
  } catch {
    // Fall back to generic advisory without deviceId.
    emitAdvisory(ADVISORY(''))
    process.exit(0)
  }
  if (!raw || raw.trim().length === 0) {
    emitAdvisory(ADVISORY(''))
    process.exit(0)
  }

  let input
  try { input = JSON.parse(raw) } catch {
    emitAdvisory(ADVISORY(''))
    process.exit(0)
  }

  const args = input?.tool_input ?? input?.arguments ?? {}
  const sessionId = args?.sessionId

  // We don't know deviceId from terminateSession args — only sessionId.
  // Echo sessionId in the advisory so the agent can correlate.
  let suffix = ''
  if (typeof sessionId === 'number' || typeof sessionId === 'string') {
    const sessionIdSafe = String(sessionId).replace(/[^0-9]/g, '').slice(0, 20)
    if (sessionIdSafe) suffix = ` (sessionId=${sessionIdSafe})`
  }

  emitAdvisory(ADVISORY(suffix))
  process.exit(0)
}

main().catch(() => process.exit(0))
