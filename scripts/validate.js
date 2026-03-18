import {readFileSync, existsSync} from 'fs'
import {resolve, join} from 'path'
import {load} from 'js-yaml'

export function validateProject(rootDir) {
  const errors = []
  const passes = []

  function fail(msg) { errors.push(msg) }
  function pass(msg) { passes.push(msg) }

  // Validate JSON files exist and parse
  const jsonFiles = [
    '.mcp.json',
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    '.cursor-plugin/plugin.json',
  ]

  for (const file of jsonFiles) {
    const filePath = join(rootDir, file)
    if (!existsSync(filePath)) {
      fail(`${file} does not exist`)
      continue
    }
    try {
      JSON.parse(readFileSync(filePath, 'utf8'))
      pass(`${file} is valid JSON`)
    } catch (e) {
      fail(`${file} is not valid JSON: ${e.message}`)
    }
  }

  // Validate plugin.json required fields
  for (const pluginPath of ['.claude-plugin/plugin.json', '.cursor-plugin/plugin.json']) {
    const filePath = join(rootDir, pluginPath)
    if (!existsSync(filePath)) continue
    const plugin = JSON.parse(readFileSync(filePath, 'utf8'))
    if (!plugin.name) fail(`${pluginPath} missing "name"`)
    if (!plugin.description) fail(`${pluginPath} missing "description"`)
  }

  // Validate .mcp.json has server config
  const mcpPath = join(rootDir, '.mcp.json')
  if (existsSync(mcpPath)) {
    try {
      const mcp = JSON.parse(readFileSync(mcpPath, 'utf8'))
      if (!mcp.mcpServers || !mcp.mcpServers.kobiton) {
        fail('.mcp.json missing mcpServers.kobiton')
      } else if (!mcp.mcpServers.kobiton.url) {
        fail('.mcp.json missing mcpServers.kobiton.url')
      }
    } catch {
      // Already caught by JSON validation above
    }
  }

  // Validate tool YAML files
  const toolFiles = ['devices.yaml', 'device-bundles.yaml', 'sessions.yaml', 'apps.yaml', 'automation.yaml']

  for (const file of toolFiles) {
    const filePath = join(rootDir, 'tools', file)
    if (!existsSync(filePath)) {
      fail(`tools/${file} does not exist`)
      continue
    }
    try {
      const doc = load(readFileSync(filePath, 'utf8'))
      if (!doc.tools || !Array.isArray(doc.tools)) {
        fail(`tools/${file} missing "tools" array`)
        continue
      }
      for (const tool of doc.tools) {
        if (!tool.name) fail(`tools/${file} has tool without "name"`)
        if (!tool.description) fail(`tools/${file} tool "${tool.name}" missing "description"`)
        if (!tool.inputSchema) fail(`tools/${file} tool "${tool.name}" missing "inputSchema"`)
      }
      pass(`tools/${file} is valid (${doc.tools.length} tools)`)
    } catch (e) {
      fail(`tools/${file} is not valid YAML: ${e.message}`)
    }
  }

  // Validate skills have frontmatter
  const skillDirs = ['run-automation-suite']
  for (const skill of skillDirs) {
    const filePath = join(rootDir, 'skills', skill, 'skill.md')
    if (!existsSync(filePath)) {
      fail(`skills/${skill}/skill.md does not exist`)
      continue
    }
    const content = readFileSync(filePath, 'utf8')
    if (!content.startsWith('---')) {
      fail(`skills/${skill}/skill.md missing YAML frontmatter`)
      continue
    }
    const frontmatterEnd = content.indexOf('---', 3)
    if (frontmatterEnd === -1) {
      fail(`skills/${skill}/skill.md has unclosed frontmatter`)
      continue
    }
    const frontmatter = load(content.slice(3, frontmatterEnd))
    if (!frontmatter.name) fail(`skills/${skill}/skill.md frontmatter missing "name"`)
    if (!frontmatter.description) fail(`skills/${skill}/skill.md frontmatter missing "description"`)
    else pass(`skills/${skill}/skill.md is valid`)
  }

  // Validate referenced paths exist
  const claudePluginPath = join(rootDir, '.claude-plugin/plugin.json')
  if (existsSync(claudePluginPath)) {
    const claudePlugin = JSON.parse(readFileSync(claudePluginPath, 'utf8'))
    if (claudePlugin.mcpServers) {
      const ref = resolve(join(rootDir, '.claude-plugin'), claudePlugin.mcpServers)
      if (!existsSync(ref)) fail(`plugin.json references ${claudePlugin.mcpServers} but it does not exist`)
    }
    if (claudePlugin.skills) {
      const ref = resolve(join(rootDir, '.claude-plugin'), claudePlugin.skills)
      if (!existsSync(ref)) fail(`plugin.json references ${claudePlugin.skills} but it does not exist`)
    }
  }

  return {errors, passes}
}

// CLI runner
const isMainModule = import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  const ROOT = resolve(import.meta.dirname, '..')
  const {errors, passes} = validateProject(ROOT)

  for (const msg of passes) console.log(`OK:   ${msg}`)
  for (const msg of errors) console.error(`FAIL: ${msg}`)

  console.log(`\n${errors.length === 0 ? 'All checks passed.' : `${errors.length} error(s) found.`}`)
  process.exit(errors.length === 0 ? 0 : 1)
}
