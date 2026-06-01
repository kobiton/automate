import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {syncVersion} from './sync-version.js'

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n')
}

// Writes package.json + the four host manifests + CHANGELOG.md, all consistent at `version`.
function setupFixture(root, version = '1.2.0') {
  writeJson(join(root, 'package.json'), {name: 'automate', version, type: 'module'})

  mkdirSync(join(root, '.claude-plugin'), {recursive: true})
  writeJson(join(root, '.claude-plugin/plugin.json'), {name: 'automate', version})
  writeJson(join(root, '.claude-plugin/marketplace.json'), {
    name: 'kobiton',
    metadata: {version: '1.0.0'},
    plugins: [{name: 'automate', version}]
  })

  mkdirSync(join(root, '.codex/.codex-plugin'), {recursive: true})
  writeJson(join(root, '.codex/.codex-plugin/plugin.json'), {name: 'automate', version})

  mkdirSync(join(root, '.cursor-plugin'), {recursive: true})
  writeJson(join(root, '.cursor-plugin/plugin.json'), {name: 'automate', version})
  writeJson(join(root, '.cursor-plugin/marketplace.json'), {
    name: 'kobiton',
    metadata: {version: '1.0.0'},
    plugins: [{name: 'automate', version}]
  })

  writeJson(join(root, 'gemini-extension.json'), {name: 'kobiton-automate', version})

  writeFileSync(join(root, 'CHANGELOG.md'), `# Changelog\n\n## ${version} - 2026-01-01\n\n- initial\n`)
}

const readJson = (root, rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'))

describe('syncVersion', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sync-version-test-'))
  })

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true})
  })

  describe('write mode', () => {
    it('propagates package.json version into all host manifests', () => {
      setupFixture(dir, '1.2.0')
      writeJson(join(dir, 'package.json'), {name: 'automate', version: '1.3.0', type: 'module'})

      const {errors} = syncVersion(dir)
      expect(errors).toEqual([])

      expect(readJson(dir, '.claude-plugin/plugin.json').version).toBe('1.3.0')
      expect(readJson(dir, '.codex/.codex-plugin/plugin.json').version).toBe('1.3.0')
      expect(readJson(dir, '.cursor-plugin/plugin.json').version).toBe('1.3.0')
      expect(readJson(dir, 'gemini-extension.json').version).toBe('1.3.0')
      expect(readJson(dir, '.claude-plugin/marketplace.json').plugins[0].version).toBe('1.3.0')
      expect(readJson(dir, '.cursor-plugin/marketplace.json').plugins[0].version).toBe('1.3.0')
    })

    it('never touches marketplace metadata.version (the catalog version)', () => {
      setupFixture(dir, '1.2.0')
      writeJson(join(dir, 'package.json'), {name: 'automate', version: '2.0.0', type: 'module'})

      syncVersion(dir)

      const market = readJson(dir, '.claude-plugin/marketplace.json')
      expect(market.metadata.version).toBe('1.0.0')
      expect(market.plugins[0].version).toBe('2.0.0')
    })

    it('is a no-op (no rewrite) when everything already matches', () => {
      setupFixture(dir, '1.2.0')
      const before = readFileSync(join(dir, '.claude-plugin/plugin.json'), 'utf8')

      const {errors, warnings} = syncVersion(dir)
      expect(errors).toEqual([])
      expect(warnings).toEqual([])
      expect(readFileSync(join(dir, '.claude-plugin/plugin.json'), 'utf8')).toBe(before)
    })

    it('warns (does not error) when CHANGELOG top entry lags, and still syncs manifests', () => {
      setupFixture(dir, '1.2.0')
      writeJson(join(dir, 'package.json'), {name: 'automate', version: '1.3.0', type: 'module'})

      const {errors, warnings} = syncVersion(dir)
      expect(errors).toEqual([])
      expect(warnings).toContainEqual(expect.stringContaining('CHANGELOG.md top entry is 1.2.0, but package.json is 1.3.0'))
      expect(readJson(dir, 'gemini-extension.json').version).toBe('1.3.0')
    })

    it('errors when marketplace has no matching plugin entry', () => {
      setupFixture(dir, '1.2.0')
      writeJson(join(dir, '.claude-plugin/marketplace.json'), {
        name: 'kobiton',
        metadata: {version: '1.0.0'},
        plugins: [{name: 'something-else', version: '1.2.0'}]
      })

      const {errors} = syncVersion(dir)
      expect(errors).toContainEqual(expect.stringContaining('no plugins[] entry named "automate"'))
    })
  })

  describe('check mode', () => {
    it('passes when all manifests and the CHANGELOG match', () => {
      setupFixture(dir, '1.2.0')
      const {errors, warnings} = syncVersion(dir, {check: true})
      expect(errors).toEqual([])
      expect(warnings).toEqual([])
    })

    it('fails when a top-level manifest version drifts', () => {
      setupFixture(dir, '1.2.0')
      writeJson(join(dir, 'gemini-extension.json'), {name: 'kobiton-automate', version: '1.1.9'})

      const {errors} = syncVersion(dir, {check: true})
      expect(errors).toContainEqual(expect.stringContaining('gemini-extension.json version is "1.1.9", expected 1.2.0'))
    })

    it('fails when the marketplace plugin entry drifts', () => {
      setupFixture(dir, '1.2.0')
      writeJson(join(dir, '.claude-plugin/marketplace.json'), {
        name: 'kobiton',
        metadata: {version: '1.0.0'},
        plugins: [{name: 'automate', version: '1.1.0'}]
      })

      const {errors} = syncVersion(dir, {check: true})
      expect(errors).toContainEqual(expect.stringContaining('plugins["automate"].version is "1.1.0", expected 1.2.0'))
    })

    it('fails when the CHANGELOG top entry does not match', () => {
      setupFixture(dir, '1.2.0')
      writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 1.1.0 - 2026-01-01\n\n- old\n')

      const {errors} = syncVersion(dir, {check: true})
      expect(errors).toContainEqual(expect.stringContaining('CHANGELOG.md top entry is 1.1.0, but package.json is 1.2.0'))
    })

    it('ignores a differing marketplace metadata.version', () => {
      setupFixture(dir, '1.2.0')
      const market = readJson(dir, '.claude-plugin/marketplace.json')
      market.metadata.version = '9.9.9'
      writeJson(join(dir, '.claude-plugin/marketplace.json'), market)

      const {errors} = syncVersion(dir, {check: true})
      expect(errors).toEqual([])
    })

    it('errors on an invalid package.json version', () => {
      setupFixture(dir, '1.2.0')
      writeJson(join(dir, 'package.json'), {name: 'automate', version: 'not-a-version', type: 'module'})

      const {errors} = syncVersion(dir, {check: true})
      expect(errors).toContainEqual(expect.stringContaining('package.json has an invalid version'))
    })

    it('accepts SemVer 2.0 pre-release suffixes in the CHANGELOG top entry', () => {
      // Regression guard: the original `\d+\.\d+\.\d+\b` regex captured
      // only the X.Y.Z prefix, so `## 1.4.0-dev.0` matched as "1.4.0" and
      // was mis-compared against package.json's "1.4.0-dev.0", failing
      // CI on every dev-version cut. The fix accepts the optional `-…`
      // suffix.
      setupFixture(dir, '1.4.0-dev.0')
      const {errors, warnings} = syncVersion(dir, {check: true})
      expect(errors).toEqual([])
      expect(warnings).toEqual([])
    })
  })
})
