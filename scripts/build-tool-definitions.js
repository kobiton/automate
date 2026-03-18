import {readFileSync, writeFileSync, mkdirSync} from 'fs'
import {join, resolve} from 'path'
import {load, dump} from 'js-yaml'

const ROOT = resolve(import.meta.dirname, '..')
const toolFiles = ['devices.yaml', 'device-bundles.yaml', 'sessions.yaml', 'apps.yaml', 'automation.yaml']

const combined = {
  files: toolFiles.map((file) => {
    const content = readFileSync(join(ROOT, 'tools', file), 'utf8')
    return load(content)
  })
}

mkdirSync(join(ROOT, 'dist'), {recursive: true})
const outputPath = join(ROOT, 'dist', 'tool-definitions.yaml')
writeFileSync(outputPath, dump(combined))
console.log(`Built ${outputPath}`)
