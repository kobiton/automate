import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {dump} from 'js-yaml'
import {buildToolDefinitions} from '../../scripts/build-tool-definitions.js'
import {distTagFor} from '../../scripts/mcp-tools-dist-tag.js'

const PACKAGE_DIR = import.meta.dirname
const ROOT = resolve(PACKAGE_DIR, '..', '..')
const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8'))

describe('@kobiton/mcp-tools package', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mcp-tools-pack-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, {recursive: true, force: true})
  })

  it('ships only the catalog file and exposes it by path', () => {
    expect(pkg.name).toBe('@kobiton/mcp-tools')
    expect(pkg.files).toEqual(['tool-definitions.yaml'])
    expect(pkg.exports).toEqual({
      './tool-definitions.yaml': './tool-definitions.yaml',
      './package.json': './package.json'
    })
    expect(pkg.dependencies).toBeUndefined()
  })

  it('has a version the publish workflow accepts', () => {
    expect(() => distTagFor(pkg.version, 'refs/heads/main')).not.toThrow()
  })

  it('builds the shipped catalog from tools/*.yaml at pack time', () => {
    expect(pkg.scripts.prepack).toBe('node ../../scripts/build-tool-definitions.js --out tool-definitions.yaml')

    // Run the prepack command from the package directory, writing to a temp file instead
    const outputPath = join(tmpDir, 'tool-definitions.yaml')
    execFileSync(process.execPath, ['../../scripts/build-tool-definitions.js', '--out', outputPath], {cwd: PACKAGE_DIR})

    expect(readFileSync(outputPath, 'utf8')).toBe(dump(buildToolDefinitions(ROOT).combined))
  })
})
