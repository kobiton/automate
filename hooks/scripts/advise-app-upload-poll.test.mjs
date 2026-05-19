import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPT = resolve(__dirname, 'advise-app-upload-poll.mjs')

function runHook (inputObj) {
  try {
    const stdout = execFileSync('node', [SCRIPT], {
      input: JSON.stringify(inputObj),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return { stdout, code: 0 }
  } catch (err) {
    return { stdout: err.stdout?.toString() ?? '', code: err.status }
  }
}

describe('advise-app-upload-poll hook', () => {
  it('emits advisory with appId+versionId echoed from structured response', () => {
    const result = runHook({
      tool_response: {
        structuredContent: { appId: 12345, versionId: 67890 }
      }
    })
    expect(result.code).toBe(0)
    const out = JSON.parse(result.stdout.trim())
    expect(out.hookSpecificOutput.hookEventName).toBe('PostToolUse')
    expect(out.hookSpecificOutput.additionalContext).toContain('appId=12345')
    expect(out.hookSpecificOutput.additionalContext).toContain('versionId=67890')
    expect(out.hookSpecificOutput.additionalContext).toContain('READY or FAILURE_PARSING')
  })

  it('also accepts response shape without structuredContent wrapper', () => {
    const result = runHook({
      tool_response: { appId: 999, versionId: 111 }
    })
    expect(result.code).toBe(0)
    const out = JSON.parse(result.stdout.trim())
    expect(out.hookSpecificOutput.additionalContext).toContain('appId=999')
    expect(out.hookSpecificOutput.additionalContext).toContain('versionId=111')
  })

  it('sanitizes non-numeric characters from appId (defense against injection)', () => {
    const result = runHook({
      tool_response: { appId: '123/../../admin', versionId: '456' }
    })
    expect(result.code).toBe(0)
    const out = JSON.parse(result.stdout.trim())
    // Coerced to digits-only: should be 123 only
    expect(out.hookSpecificOutput.additionalContext).toContain('appId=123')
    expect(out.hookSpecificOutput.additionalContext).not.toContain('admin')
    expect(out.hookSpecificOutput.additionalContext).not.toContain('..')
  })

  it('exits silently when appId is missing', () => {
    const result = runHook({ tool_response: { versionId: 111 } })
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  it('exits silently when versionId is missing', () => {
    const result = runHook({ tool_response: { appId: 111 } })
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  it('exits silently on completely empty response', () => {
    const result = runHook({})
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  describe('PII / credential leakage', () => {
    it('does not echo arbitrary fields from response into advisory', () => {
      const result = runHook({
        tool_response: {
          structuredContent: {
            appId: 1,
            versionId: 2,
            authorization: 'Bearer SECRET_TOKEN',
            email: 'leaked@example.com',
            apikey: 'KOBITON_AUTH_VALUE'
          }
        }
      })
      const out = JSON.parse(result.stdout.trim())
      expect(out.hookSpecificOutput.additionalContext).not.toContain('SECRET_TOKEN')
      expect(out.hookSpecificOutput.additionalContext).not.toContain('leaked@example.com')
      expect(out.hookSpecificOutput.additionalContext).not.toContain('KOBITON_AUTH_VALUE')
      expect(out.hookSpecificOutput.additionalContext).not.toContain('Bearer')
    })
  })
})
