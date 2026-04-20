import {readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {load, dump} from 'js-yaml'

export function buildToolDefinitions(rootDir) {
  const toolsDir = join(rootDir, 'tools')
  if (!existsSync(toolsDir)) {
    throw new Error('tools/ directory does not exist')
  }

  const toolFiles = readdirSync(toolsDir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()

  if (toolFiles.length === 0) {
    throw new Error('tools/ contains no YAML files')
  }

  const combined = {
    files: toolFiles.map((file) => {
      const content = readFileSync(join(toolsDir, file), 'utf8')
      return load(content)
    })
  }

  return {combined, toolFiles}
}

// CLI runner
const isMainModule = import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  const ROOT = resolve(import.meta.dirname, '..')
  const {combined} = buildToolDefinitions(ROOT)

  const distDir = join(ROOT, 'dist')
  mkdirSync(distDir, {recursive: true})

  const outputPath = join(distDir, 'tool-definitions.yaml')
  writeFileSync(outputPath, dump(combined))

  console.log(`Built ${outputPath}`)
}
