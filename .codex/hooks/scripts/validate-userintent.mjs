#!/usr/bin/env node
// PreToolUse hook: validate that every Kobiton MCP call carries a well-formed
// userIntent argument per the format documented in kobiton/CLAUDE.md op-rule #4.
//
// Output envelope: PreToolUse expects {hookSpecificOutput: {hookEventName,
// permissionDecision, permissionDecisionReason}}. A top-level {decision: "block"}
// is silently ignored on PreToolUse — that was BLOCKER B1-CR from the
// multi-reviewer pre-flight (2026-05-12).
//
// Security posture:
// - No network calls.
// - No filesystem writes.
// - Never echoes the user-controlled userIntent value back into the reason
//   field (prevents prompt-injection via reflected content — H1-SA).
// - Bounded regex (no unbounded quantifiers) + length short-circuit before
//   regex evaluation (prevents ReDoS — H2-SA).

import { stdin } from 'node:process'

const MIN_LENGTH = 110
const MAX_LENGTH = 145

// Bounded regex per H2-SA: every quantifier capped, no greedy `.+`.
// Format: [partner=<partner-name>] [exp-<num>/<phase>] <verb phrase> | contact:<email>
const FORMAT_REGEX = /^\[partner=[^\s\]]{1,40} exp-\d{1,4}\/[a-z-]{1,30}\] [^|]{20,80}\| contact:[^\s@]{1,64}@[^\s]{3,64}$/

const GENERIC_REASON = 'userIntent must match format: [partner=... exp-NN/<phase>] <verb-phrase> | contact:user@org (110-145 chars). See kobiton/CLAUDE.md op-rule #4.'

function emitDecision (decision, reason) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason
    }
  }
  process.stdout.write(JSON.stringify(output))
  process.stdout.write('\n')
}

async function readStdin () {
  const chunks = []
  for await (const chunk of stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function main () {
  let raw
  try {
    raw = await readStdin()
  } catch (err) {
    // Treat read failure as a non-blocking allow to avoid wedging the agent
    // on transient stdin issues; the operational rule is enforced by the
    // user, the hook is just an automated check.
    process.exit(0)
  }

  if (!raw || raw.trim().length === 0) {
    // No input means the hook runtime called us with nothing — allow,
    // since blocking on empty input would block all calls.
    process.exit(0)
  }

  let input
  try {
    input = JSON.parse(raw)
  } catch {
    // Malformed JSON from the hook runtime — same reasoning as empty input.
    process.exit(0)
  }

  const args = input?.tool_input ?? input?.arguments ?? {}
  const userIntent = args?.userIntent

  // Type + length short-circuit BEFORE regex (H2-SA ReDoS prevention).
  if (typeof userIntent !== 'string') {
    emitDecision('deny', GENERIC_REASON)
    process.exit(0)
  }

  if (userIntent.length < MIN_LENGTH || userIntent.length > MAX_LENGTH) {
    emitDecision('deny', GENERIC_REASON)
    process.exit(0)
  }

  if (!FORMAT_REGEX.test(userIntent)) {
    emitDecision('deny', GENERIC_REASON)
    process.exit(0)
  }

  // Valid — exit 0 with no output. Claude Code interprets no output + exit 0
  // as "no opinion, proceed normally".
  process.exit(0)
}

main().catch(() => process.exit(0))
