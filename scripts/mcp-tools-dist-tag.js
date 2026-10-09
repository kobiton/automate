import {readFileSync, realpathSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-([a-z]+)\.\d+)?$/

// X.Y.Z publishes as `latest` and only from the main branch; X.Y.Z-<channel>.N publishes as `<channel>` from any ref
export function distTagFor(version, ref) {
  const match = VERSION_PATTERN.exec(version)
  if (!match) {
    throw new Error(`${version} is not X.Y.Z or X.Y.Z-<channel>.N`)
  }
  const channel = match[1]
  if (!channel) {
    if (ref !== 'refs/heads/main') {
      throw new Error(`stable version ${version} can only be published from main, not ${ref}`)
    }
    return 'latest'
  }
  if (channel === 'latest') {
    throw new Error('the pre-release channel cannot be named latest')
  }
  return channel
}

// CLI runner: prints the dist-tag for packages/mcp-tools on the ref in GITHUB_REF (full ref, so a tag named main can't pass)
// Compare real paths: a symlinked invocation path must still run the CLI, not silently exit 0
const isMainModule = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (isMainModule) {
  const ROOT = resolve(import.meta.dirname, '..')
  const {version} = JSON.parse(readFileSync(join(ROOT, 'packages', 'mcp-tools', 'package.json'), 'utf8'))
  try {
    console.log(distTagFor(version, process.env.GITHUB_REF))
  }
  catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
