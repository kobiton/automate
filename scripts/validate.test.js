import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'fs'
import {join} from 'path'
import {tmpdir} from 'os'
import {validateProject} from './validate.js'

function setupValidProject(dir) {
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
    mcpServers: {kobiton: {type: 'http', url: 'https://api.kobiton.com/mcp'}}
  }))

  mkdirSync(join(dir, '.claude-plugin'))
  writeFileSync(join(dir, '.claude-plugin/plugin.json'), JSON.stringify({
    name: 'kobiton-skills',
    description: 'Test',
    mcpServers: '../.mcp.json',
    skills: '../skills/'
  }))
  writeFileSync(join(dir, '.claude-plugin/marketplace.json'), JSON.stringify({
    title: 'Kobiton Skills',
    description: 'Test',
    category: 'testing'
  }))

  mkdirSync(join(dir, '.cursor-plugin'))
  writeFileSync(join(dir, '.cursor-plugin/plugin.json'), JSON.stringify({
    name: 'kobiton-skills',
    description: 'Test'
  }))

  mkdirSync(join(dir, 'tools'))
  for (const file of ['devices.yaml', 'sessions.yaml', 'apps.yaml', 'automation.yaml']) {
    writeFileSync(join(dir, 'tools', file), [
      'tools:',
      '  - name: testTool',
      '    description: A test tool',
      '    inputSchema:',
      '      type: object',
    ].join('\n'))
  }

  mkdirSync(join(dir, 'skills/run-automation-suite'), {recursive: true})
  writeFileSync(join(dir, 'skills/run-automation-suite/skill.md'), [
    '---',
    'name: run-automation-suite',
    'description: Test skill',
    '---',
    '## Workflow',
  ].join('\n'))
}

describe('validateProject', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kobiton-skills-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, {recursive: true, force: true})
  })

  it('passes with a valid project', () => {
    setupValidProject(tmpDir)
    const {errors, passes} = validateProject(tmpDir)
    expect(errors).toEqual([])
    expect(passes.length).toBeGreaterThan(0)
  })

  it('fails when .mcp.json is missing', () => {
    setupValidProject(tmpDir)
    rmSync(join(tmpDir, '.mcp.json'))
    const {errors} = validateProject(tmpDir)
    expect(errors).toContainEqual(expect.stringContaining('.mcp.json does not exist'))
  })

  it('fails when .mcp.json has invalid JSON', () => {
    setupValidProject(tmpDir)
    writeFileSync(join(tmpDir, '.mcp.json'), '{invalid')
    const {errors} = validateProject(tmpDir)
    expect(errors).toContainEqual(expect.stringContaining('not valid JSON'))
  })

  it('fails when .mcp.json is missing kobiton server', () => {
    setupValidProject(tmpDir)
    writeFileSync(join(tmpDir, '.mcp.json'), JSON.stringify({mcpServers: {}}))
    const {errors} = validateProject(tmpDir)
    expect(errors).toContainEqual(expect.stringContaining('missing mcpServers.kobiton'))
  })

  it('fails when plugin.json is missing name', () => {
    setupValidProject(tmpDir)
    writeFileSync(join(tmpDir, '.claude-plugin/plugin.json'), JSON.stringify({
      description: 'Test',
      mcpServers: '../.mcp.json',
      skills: '../skills/'
    }))
    const {errors} = validateProject(tmpDir)
    expect(errors).toContainEqual(expect.stringContaining('missing "name"'))
  })

  it('fails when tool YAML is missing tools array', () => {
    setupValidProject(tmpDir)
    writeFileSync(join(tmpDir, 'tools/devices.yaml'), 'notTools: true')
    const {errors} = validateProject(tmpDir)
    expect(errors).toContainEqual(expect.stringContaining('missing "tools" array'))
  })

  it('fails when tool is missing inputSchema', () => {
    setupValidProject(tmpDir)
    writeFileSync(join(tmpDir, 'tools/devices.yaml'), [
      'tools:',
      '  - name: testTool',
      '    description: A test tool',
    ].join('\n'))
    const {errors} = validateProject(tmpDir)
    expect(errors).toContainEqual(expect.stringContaining('missing "inputSchema"'))
  })

  it('fails when skill is missing frontmatter', () => {
    setupValidProject(tmpDir)
    writeFileSync(join(tmpDir, 'skills/run-automation-suite/skill.md'), '## No frontmatter')
    const {errors} = validateProject(tmpDir)
    expect(errors).toContainEqual(expect.stringContaining('missing YAML frontmatter'))
  })

  it('fails when skill frontmatter is missing name', () => {
    setupValidProject(tmpDir)
    writeFileSync(join(tmpDir, 'skills/run-automation-suite/skill.md'), [
      '---',
      'description: Test',
      '---',
    ].join('\n'))
    const {errors} = validateProject(tmpDir)
    expect(errors).toContainEqual(expect.stringContaining('frontmatter missing "name"'))
  })

  it('fails when plugin.json references nonexistent path', () => {
    setupValidProject(tmpDir)
    writeFileSync(join(tmpDir, '.claude-plugin/plugin.json'), JSON.stringify({
      name: 'test',
      description: 'Test',
      mcpServers: '../nonexistent.json',
      skills: '../skills/'
    }))
    const {errors} = validateProject(tmpDir)
    expect(errors).toContainEqual(expect.stringContaining('does not exist'))
  })
})
