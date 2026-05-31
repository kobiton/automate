import {readFileSync, existsSync, readdirSync} from 'node:fs'
import {resolve, join} from 'node:path'
import {load} from 'js-yaml'

export function validateProject(rootDir) {
  const errors = []
  const passes = []

  function fail(msg) {
    errors.push(msg)
  }
  function pass(msg) {
    passes.push(msg)
  }

  // Validate JSON files exist and parse
  const jsonFiles = [
    '.mcp.json',
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    '.agents/plugins/marketplace.json',
    '.codex/.codex-plugin/plugin.json',
    '.codex/.mcp.json',
    '.cursor-plugin/plugin.json',
    '.cursor-plugin/marketplace.json',
    '.cursor/mcp.json',
    '.cursor/hooks/hooks.json',
    'gemini-extension.json'
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
    }
    catch (e) {
      fail(`${file} is not valid JSON: ${e.message}`)
    }
  }

  // Validate plugin.json required fields
  for (const pluginPath of ['.claude-plugin/plugin.json', '.codex/.codex-plugin/plugin.json', '.cursor-plugin/plugin.json']) {
    const filePath = join(rootDir, pluginPath)
    if (!existsSync(filePath)) {
      continue
    }

    const plugin = JSON.parse(readFileSync(filePath, 'utf8'))
    if (!plugin.name) {
      fail(`${pluginPath} missing "name"`)
    }
    if (!plugin.description) {
      fail(`${pluginPath} missing "description"`)
    }
  }

  // Validate .mcp.json has server config (accepts OAuth, API key, or minimal format)
  const mcpPath = join(rootDir, '.mcp.json')
  if (existsSync(mcpPath)) {
    try {
      const mcp = JSON.parse(readFileSync(mcpPath, 'utf8'))
      if (!mcp.mcpServers?.kobiton) {
        fail('.mcp.json missing mcpServers.kobiton')
      }
      else if (!mcp.mcpServers.kobiton.url) {
        fail('.mcp.json missing mcpServers.kobiton.url')
      }
      else {
        const kobiton = mcp.mcpServers.kobiton
        if (kobiton.oauth != null && (typeof kobiton.oauth !== 'object' || typeof kobiton.oauth.authServerMetadataUrl !== 'string')) {
          fail('.mcp.json oauth block missing authServerMetadataUrl (string)')
        }
      }
    }
    catch {
      // Already caught by JSON validation above
    }
  }

  // Validate .codex/.mcp.json (Codex plugin loader uses camelCase wrapper + snake_case server fields)
  const codexMcpPath = join(rootDir, '.codex/.mcp.json')
  if (existsSync(codexMcpPath)) {
    try {
      const mcp = JSON.parse(readFileSync(codexMcpPath, 'utf8'))
      if (!mcp.mcpServers?.kobiton) {
        fail('.codex/.mcp.json missing mcpServers.kobiton')
      }
      else if (!mcp.mcpServers.kobiton.url) {
        fail('.codex/.mcp.json missing mcpServers.kobiton.url')
      }
    }
    catch {
      // Already caught by JSON validation above
    }
  }

  // Validate .cursor/mcp.json (Cursor uses the same mcpServers shape as Claude)
  const cursorMcpPath = join(rootDir, '.cursor/mcp.json')
  if (existsSync(cursorMcpPath)) {
    try {
      const mcp = JSON.parse(readFileSync(cursorMcpPath, 'utf8'))
      if (!mcp.mcpServers?.kobiton) {
        fail('.cursor/mcp.json missing mcpServers.kobiton')
      }
      else if (!mcp.mcpServers.kobiton.url) {
        fail('.cursor/mcp.json missing mcpServers.kobiton.url')
      }
    }
    catch {
      // Already caught by JSON validation above
    }
  }

  // Validate tool YAML files (auto-discovered from tools/)
  const toolsDir = join(rootDir, 'tools')
  if (!existsSync(toolsDir)) {
    fail('tools/ directory does not exist')
  }
  else {
    const toolFiles = readdirSync(toolsDir).filter((f) => f.endsWith('.yaml'))
    if (toolFiles.length === 0) {
      fail('tools/ contains no YAML files')
    }
    for (const file of toolFiles) {
      const filePath = join(toolsDir, file)
      try {
        const doc = load(readFileSync(filePath, 'utf8'))

        if (!doc.tools || !Array.isArray(doc.tools)) {
          fail(`tools/${file} missing "tools" array`)
          continue
        }

        for (const tool of doc.tools) {
          if (!tool.name) {
            fail(`tools/${file} has tool without "name"`)
          }
          if (!tool.description) {
            fail(`tools/${file} tool "${tool.name}" missing "description"`)
          }
          if (!tool.inputSchema) {
            fail(`tools/${file} tool "${tool.name}" missing "inputSchema"`)
          }
        }
        pass(`tools/${file} is valid (${doc.tools.length} tools)`)
      }
      catch (e) {
        fail(`tools/${file} is not valid YAML: ${e.message}`)
      }
    }
  }

  // Validate skills have frontmatter (auto-discovered from skills/)
  const skillsDir = join(rootDir, 'skills')
  if (!existsSync(skillsDir)) {
    fail('skills/ directory does not exist')
  }
  else {
    const skillDirs = readdirSync(skillsDir, {withFileTypes: true})
      .filter((d) => d.isDirectory())
      .map((d) => d.name)

    if (skillDirs.length === 0) {
      fail('skills/ contains no skill subdirectories')
    }

    for (const skill of skillDirs) {
      const filePath = join(skillsDir, skill, 'SKILL.md')
      if (!existsSync(filePath)) {
        fail(`skills/${skill}/SKILL.md does not exist`)
        continue
      }

      const content = readFileSync(filePath, 'utf8')
      if (!content.startsWith('---')) {
        fail(`skills/${skill}/SKILL.md missing YAML frontmatter`)
        continue
      }

      const frontmatterEnd = content.indexOf('---', 3)
      if (frontmatterEnd === -1) {
        fail(`skills/${skill}/SKILL.md has unclosed frontmatter`)
        continue
      }

      const frontmatter = load(content.slice(3, frontmatterEnd))
      if (!frontmatter.name) {
        fail(`skills/${skill}/SKILL.md frontmatter missing "name"`)
      }
      if (!frontmatter.description) {
        fail(`skills/${skill}/SKILL.md frontmatter missing "description"`)
      }
      else {
        pass(`skills/${skill}/SKILL.md is valid`)
      }
    }
  }

  // Validate referenced paths exist (Claude + Codex + Cursor plugin manifests)
  for (const pluginPath of ['.claude-plugin/plugin.json', '.codex/.codex-plugin/plugin.json', '.cursor-plugin/plugin.json']) {
    const filePath = join(rootDir, pluginPath)
    if (!existsSync(filePath)) {
      continue
    }
    const plugin = JSON.parse(readFileSync(filePath, 'utf8'))

    if (typeof plugin.mcpServers === 'string') {
      const ref = resolve(rootDir, plugin.mcpServers)
      if (!existsSync(ref)) {
        fail(`${pluginPath} references ${plugin.mcpServers} but it does not exist`)
      }
    }

    if (typeof plugin.skills === 'string') {
      const ref = resolve(rootDir, plugin.skills)
      if (!existsSync(ref)) {
        fail(`${pluginPath} references ${plugin.skills} but it does not exist`)
      }
    }
  }

  return {errors, passes}
}

// CLI runner
const isMainModule = import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  const ROOT = resolve(import.meta.dirname, '..')
  const {errors, passes} = validateProject(ROOT)

  for (const msg of passes) {
    console.log(`OK:   ${msg}`)
  }
  for (const msg of errors) {
    console.error(`FAIL: ${msg}`)
  }

  const summary = errors.length === 0
    ? 'All checks passed.'
    : `${errors.length} error(s) found.`
  console.log(`\n${summary}`)

  process.exit(errors.length === 0 ? 0 : 1)
}
