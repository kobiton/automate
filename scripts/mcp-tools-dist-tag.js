import {readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-([a-z]+)\.\d+)?$/

// X.Y.Z publishes as `latest` and only from main; X.Y.Z-<channel>.N publishes as `<channel>` from any ref
export function distTagFor(version, refName) {
  const match = VERSION_PATTERN.exec(version)
  if (!match) {
    throw new Error(`${version} is not X.Y.Z or X.Y.Z-<channel>.N`)
  }
  const channel = match[1]
  if (!channel) {
    if (refName !== 'main') {
      throw new Error(`stable version ${version} can only be published from main, not ${refName}`)
    }
    return 'latest'
  }
  if (channel === 'latest') {
    throw new Error('the pre-release channel cannot be named latest')
  }
  return channel
}

// CLI runner: prints the dist-tag for packages/mcp-tools on the ref in GITHUB_REF_NAME
const isMainModule = import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  const ROOT = resolve(import.meta.dirname, '..')
  const {version} = JSON.parse(readFileSync(join(ROOT, 'packages', 'mcp-tools', 'package.json'), 'utf8'))
  try {
    console.log(distTagFor(version, process.env.GITHUB_REF_NAME))
  }
  catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
