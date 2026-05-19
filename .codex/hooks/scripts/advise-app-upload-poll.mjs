#!/usr/bin/env node
// PostToolUse hook on confirmAppUpload: emit an advisory hint into agent
// context recommending the agent poll getApp(appId) until the async parser
// finishes. The hook itself makes NO API calls — the agent already has the
// authenticated getApp tool in its MCP toolbelt and will do the actual poll.
//
// This advisory-only design (vs the original BLOCKER-laden design with hook-
// side authenticated polling) eliminates the credential strategy, SSRF, and
// PII-echo BLOCKERs surfaced by the multi-reviewer pre-flight (2026-05-12).
//
// Output envelope: PostToolUse uses additionalContext to inject text into
// the agent's context window. The agent reads this and acts.
//
// Security posture:
// - No network calls.
// - No filesystem writes.
// - Never echoes tool response body fields beyond appId/versionId (which the
//   agent already saw via the tool result).
// - Numeric ID validation before interpolation into the advisory string.

import { stdin } from 'node:process'

const ADVISORY = (appId, versionId) =>
  `Kobiton confirmAppUpload returned. Recommended next action per R2 finding F25/F26 ` +
  `(kobiton/automate#34): poll \`getApp\` with appId=${appId} every 2-3 seconds (max ` +
  `60s) until the response 'state' field reads READY or FAILURE_PARSING before issuing ` +
  `downstream tool calls (createSession, reserveDevice, etc.). The async parser may ` +
  `still be running; downstream calls before READY can fail without a clear root cause. ` +
  `On FAILURE_PARSING, surface the bare state to the user — the response body does not ` +
  `currently include diagnostic detail (tracked at kobiton/automate#34). ` +
  `versionId=${versionId}.`

async function readStdin () {
  const chunks = []
  for await (const chunk of stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function emitAdvisory (text) {
  // PostToolUse hook output: inject into agent context via additionalContext.
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
    process.exit(0)
  }
  if (!raw || raw.trim().length === 0) process.exit(0)

  let input
  try { input = JSON.parse(raw) } catch { process.exit(0) }

  // Extract appId and versionId from the tool response. Two possible shapes
  // depending on hook runtime version: tool_response vs result.
  const response = input?.tool_response ?? input?.result ?? {}
  const structured = response?.structuredContent ?? response

  const appId = structured?.appId
  const versionId = structured?.versionId

  // Validate as numeric (prevents string-content reflection into advisory):
  if (typeof appId !== 'number' && typeof appId !== 'string') process.exit(0)
  if (typeof versionId !== 'number' && typeof versionId !== 'string') process.exit(0)

  // Final sanitation — coerce to digits-only string if we got a string.
  const appIdSafe = String(appId).replace(/[^0-9]/g, '').slice(0, 20)
  const versionIdSafe = String(versionId).replace(/[^0-9]/g, '').slice(0, 20)

  if (!appIdSafe || !versionIdSafe) process.exit(0)

  emitAdvisory(ADVISORY(appIdSafe, versionIdSafe))
  process.exit(0)
}

main().catch(() => process.exit(0))
