import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPT = resolve(__dirname, 'advise-post-terminate-cooldown.mjs')

function runHook (inputObj) {
  const stdout = execFileSync('node', [SCRIPT], {
    input: typeof inputObj === 'string' ? inputObj : JSON.stringify(inputObj),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  })
  return stdout
}

describe('advise-post-terminate-cooldown hook', () => {
  it('emits PostToolUse advisory with sessionId echoed when present', () => {
    const stdout = runHook({ tool_input: { sessionId: 67890 } })
    const out = JSON.parse(stdout.trim())
    expect(out.hookSpecificOutput.hookEventName).toBe('PostToolUse')
    expect(out.hookSpecificOutput.additionalContext).toContain('sessionId=67890')
    expect(out.hookSpecificOutput.additionalContext).toContain('5-minute cleanup cooldown')
  })

  it('emits generic advisory (no sessionId interpolation) when sessionId is absent', () => {
    const stdout = runHook({ tool_input: {} })
    const out = JSON.parse(stdout.trim())
    expect(out.hookSpecificOutput.additionalContext).toContain('cooldown')
    expect(out.hookSpecificOutput.additionalContext).not.toContain('sessionId=')
  })

  it('sanitizes non-numeric chars from sessionId before interpolation', () => {
    const stdout = runHook({ tool_input: { sessionId: '123/../admin' } })
    const out = JSON.parse(stdout.trim())
    expect(out.hookSpecificOutput.additionalContext).toContain('sessionId=123')
    expect(out.hookSpecificOutput.additionalContext).not.toContain('admin')
    expect(out.hookSpecificOutput.additionalContext).not.toContain('..')
  })

  it('emits generic advisory when stdin is empty', () => {
    const stdout = runHook('')
    const out = JSON.parse(stdout.trim())
    expect(out.hookSpecificOutput.additionalContext).toContain('cooldown')
  })

  it('emits generic advisory when stdin is malformed JSON', () => {
    const stdout = runHook('{not json}')
    const out = JSON.parse(stdout.trim())
    expect(out.hookSpecificOutput.additionalContext).toContain('cooldown')
  })

  it('does not echo arbitrary stdin fields into the advisory', () => {
    const stdout = runHook({
      tool_input: {
        sessionId: 1,
        userIntent: '[partner=evil ...] hack | contact:x@y.z',
        authorization: 'Bearer SECRET'
      }
    })
    const out = JSON.parse(stdout.trim())
    expect(out.hookSpecificOutput.additionalContext).not.toContain('SECRET')
    expect(out.hookSpecificOutput.additionalContext).not.toContain('partner=evil')
    expect(out.hookSpecificOutput.additionalContext).not.toContain('Bearer')
  })
})
