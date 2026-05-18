import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {load, dump} from 'js-yaml'
import {buildToolDefinitions} from './build-tool-definitions.js'

function writeToolFile(dir, filename, domain, toolName) {
  writeFileSync(join(dir, 'tools', filename), [
    `domain: ${domain}`,
    'tools:',
    `  - name: ${toolName}`,
    `    description: ${toolName} description`,
    '    inputSchema:',
    '      type: object',
  ].join('\n'))
}

function setupValidProject(dir) {
  mkdirSync(join(dir, 'tools'))
  writeToolFile(dir, 'devices.yaml', 'DEVICE', 'listDevices')
  writeToolFile(dir, 'sessions.yaml', 'SESSION', 'listSessions')
}

describe('buildToolDefinitions', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'automate-build-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, {recursive: true, force: true})
  })

  it('throws when tools/ directory is missing', () => {
    expect(() => buildToolDefinitions(tmpDir)).toThrow('tools/ directory does not exist')
  })

  it('throws when tools/ contains no YAML files', () => {
    mkdirSync(join(tmpDir, 'tools'))
    expect(() => buildToolDefinitions(tmpDir)).toThrow('tools/ contains no YAML files')
  })

  it('combines YAML files into {files: [...]} structure', () => {
    setupValidProject(tmpDir)
    const {combined} = buildToolDefinitions(tmpDir)
    expect(combined).toHaveProperty('files')
    expect(Array.isArray(combined.files)).toBe(true)
    expect(combined.files).toHaveLength(2)
  })

  it('preserves domain and tools array per file', () => {
    setupValidProject(tmpDir)
    const {combined} = buildToolDefinitions(tmpDir)
    const domains = combined.files.map((f) => f.domain)
    expect(domains).toContain('DEVICE')
    expect(domains).toContain('SESSION')
    for (const file of combined.files) {
      expect(Array.isArray(file.tools)).toBe(true)
      expect(file.tools.length).toBeGreaterThan(0)
    }
  })

  it('auto-discovers new YAML files without code change', () => {
    setupValidProject(tmpDir)
    writeToolFile(tmpDir, 'extras.yaml', 'EXTRA', 'extraTool')
    const {combined, toolFiles} = buildToolDefinitions(tmpDir)
    expect(combined.files).toHaveLength(3)
    expect(toolFiles).toContain('extras.yaml')
  })

  it('ignores non-YAML files in tools/', () => {
    setupValidProject(tmpDir)
    writeFileSync(join(tmpDir, 'tools', 'README.md'), '# Tools')
    writeFileSync(join(tmpDir, 'tools', 'notes.txt'), 'notes')
    const {combined, toolFiles} = buildToolDefinitions(tmpDir)
    expect(combined.files).toHaveLength(2)
    expect(toolFiles).not.toContain('README.md')
    expect(toolFiles).not.toContain('notes.txt')
  })

  it('output is YAML round-trip safe', () => {
    setupValidProject(tmpDir)
    const {combined} = buildToolDefinitions(tmpDir)
    const yaml = dump(combined)
    const parsed = load(yaml)
    expect(parsed).toEqual(combined)
  })

  it('returns toolFiles in deterministic (alphabetical) order', () => {
    setupValidProject(tmpDir)
    const {toolFiles} = buildToolDefinitions(tmpDir)
    expect(toolFiles).toEqual(['devices.yaml', 'sessions.yaml'])
  })
})
