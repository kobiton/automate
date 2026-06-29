#!/usr/bin/env node
// PreToolUse hook on terminateSession: emit a "will allow, with notice"
// decision warning the agent that the device will enter a ~5min cleanup
// cooldown after termination per R2 finding F33.
//
// The hook does NOT block termination — it only annotates so the agent
// can plan downstream reserveDevice retries appropriately.
//
// Security posture:
// - No network calls.
// - No filesystem writes.
// - No PII echo (uses only structural fact, no response content).

const ADVISORY =
  'Note: this terminateSession call will succeed, but per R2 finding F33 ' +
  '(kobiton/automate#36) the device enters a ~5-minute cleanup cooldown ' +
  'immediately on success. Subsequent reserveDevice calls on the same ' +
  'device during cooldown will return `device_unavailable` (one of four ' +
  'lumped failure modes per F22). Plan downstream actions accordingly — ' +
  'either wait 5 minutes or pick a different device.'

const output = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    permissionDecisionReason: ADVISORY
  }
}

process.stdout.write(JSON.stringify(output))
process.stdout.write('\n')
process.exit(0)
