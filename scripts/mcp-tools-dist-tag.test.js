import {describe, it, expect} from 'vitest'
import {distTagFor} from './mcp-tools-dist-tag.js'

describe('distTagFor', () => {
  it('publishes a stable version from main as latest', () => {
    expect(distTagFor('1.2.3', 'main')).toBe('latest')
  })

  it('refuses a stable version from any other ref', () => {
    expect(() => distTagFor('1.2.3', 'feat/new-tool')).toThrow('can only be published from main')
    expect(() => distTagFor('1.2.3', undefined)).toThrow('can only be published from main')
  })

  it('publishes a pre-release under its channel from any ref', () => {
    expect(distTagFor('1.2.3-beta.0', 'feat/new-tool')).toBe('beta')
    expect(distTagFor('1.2.3-rc.4', 'main')).toBe('rc')
  })

  it('refuses a pre-release channel named latest', () => {
    expect(() => distTagFor('1.2.3-latest.1', 'main')).toThrow('cannot be named latest')
  })

  it('refuses versions outside X.Y.Z and X.Y.Z-<channel>.N', () => {
    for (const version of ['1.2', 'v1.2.3', '1.2.3-beta', '1.2.3-Beta.1', '1.2.3-beta.1.2', '1.2.3+build']) {
      expect(() => distTagFor(version, 'main')).toThrow('is not X.Y.Z or X.Y.Z-<channel>.N')
    }
  })
})
