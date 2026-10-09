import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {spawnSync} from 'node:child_process'
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {distTagFor} from './mcp-tools-dist-tag.js'

describe('distTagFor', () => {
  it('publishes a stable version from main as latest', () => {
    expect(distTagFor('1.2.3', 'refs/heads/main')).toBe('latest')
  })

  it('refuses a stable version from any other ref', () => {
    expect(() => distTagFor('1.2.3', 'refs/heads/feat/new-tool')).toThrow('can only be published from main')
    expect(() => distTagFor('1.2.3', 'refs/tags/main')).toThrow('can only be published from main')
    expect(() => distTagFor('1.2.3', 'main')).toThrow('can only be published from main')
    expect(() => distTagFor('1.2.3', undefined)).toThrow('can only be published from main')
  })

  it('publishes a pre-release under its channel from any ref', () => {
    expect(distTagFor('1.2.3-beta.0', 'refs/heads/feat/new-tool')).toBe('beta')
    expect(distTagFor('1.2.3-rc.4', 'refs/heads/main')).toBe('rc')
  })

  it('refuses a pre-release channel named latest', () => {
    expect(() => distTagFor('1.2.3-latest.1', 'refs/heads/main')).toThrow('cannot be named latest')
  })

  it('refuses versions outside X.Y.Z and X.Y.Z-<channel>.N', () => {
    for (const version of ['1.2', 'v1.2.3', '1.2.3-beta', '1.2.3-Beta.1', '1.2.3-beta.1.2', '1.2.3+build']) {
      expect(() => distTagFor(version, 'refs/heads/main')).toThrow('is not X.Y.Z or X.Y.Z-<channel>.N')
    }
  })
})

describe('mcp-tools-dist-tag CLI', () => {
  let tmpDir

  // A throwaway repo layout: scripts/<cli> next to packages/mcp-tools/package.json at the given version
  function setUpRepo(version) {
    mkdirSync(join(tmpDir, 'scripts'), {recursive: true})
    mkdirSync(join(tmpDir, 'packages', 'mcp-tools'), {recursive: true})
    copyFileSync(join(import.meta.dirname, 'mcp-tools-dist-tag.js'), join(tmpDir, 'scripts', 'mcp-tools-dist-tag.js'))
    writeFileSync(join(tmpDir, 'packages', 'mcp-tools', 'package.json'), JSON.stringify({version}))
    return join(tmpDir, 'scripts', 'mcp-tools-dist-tag.js')
  }

  function runCli(cliPath, ref) {
    return spawnSync(process.execPath, [cliPath], {
      encoding: 'utf8',
      env: {...process.env, GITHUB_REF: ref}
    })
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mcp-tools-dist-tag-'))
  })

  afterEach(() => {
    rmSync(tmpDir, {recursive: true, force: true})
  })

  it('prints the dist-tag for the package version on GITHUB_REF', () => {
    const result = runCli(setUpRepo('1.0.0-beta.0'), 'refs/heads/feat/new-tool')
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('beta\n')
  })

  it('prints the dist-tag when invoked through a symlink', () => {
    const link = join(tmpDir, 'dist-tag-link.js')
    symlinkSync(setUpRepo('1.0.0-beta.0'), link)
    const result = runCli(link, 'refs/heads/feat/new-tool')
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('beta\n')
  })

  it('exits 1 with the reason and prints no tag when the version cannot publish from the ref', () => {
    const result = runCli(setUpRepo('1.0.0'), 'refs/heads/feat/new-tool')
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('can only be published from main')
  })
})
