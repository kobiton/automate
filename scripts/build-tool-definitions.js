import {readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, realpathSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
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

// Writes the combined catalog to outputPath and returns it
export function writeToolDefinitions(rootDir, outputPath) {
  const {combined} = buildToolDefinitions(rootDir)
  mkdirSync(dirname(outputPath), {recursive: true})
  writeFileSync(outputPath, dump(combined))
  return outputPath
}

// `--out <path>` is resolved against cwd; without it the catalog goes to <root>/dist/
export function resolveOutputPath(args, rootDir, cwd) {
  const index = args.indexOf('--out')
  if (index === -1) {
    return join(rootDir, 'dist', 'tool-definitions.yaml')
  }
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error('--out requires a path')
  }
  return resolve(cwd, value)
}

// CLI runner
// Compare real paths: a symlinked invocation path (e.g. packages/mcp-tools prepack) must still build
const isMainModule = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (isMainModule) {
  const ROOT = resolve(import.meta.dirname, '..')
  const outputPath = resolveOutputPath(process.argv.slice(2), ROOT, process.cwd())
  writeToolDefinitions(ROOT, outputPath)

  console.log(`Built ${outputPath}`)
}
