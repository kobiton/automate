// Keep the plugin version in lockstep across every host manifest, with package.json as the single source of truth.
// This script derives the four manifest versions from package.json so there is exactly one number to bump.
//
// Source of truth: package.json `version`. Derived:
//  - .claude-plugin/plugin.json        version
//  - .codex/.codex-plugin/plugin.json  version
//  - .cursor-plugin/plugin.json        version
//  - gemini-extension.json             version
//  - .claude-plugin/marketplace.json   plugins[name=automate].version  (NOT metadata.version, which is the marketplace catalog version)
//  - .cursor-plugin/marketplace.json   plugins[name=automate].version  (NOT metadata.version, same convention as Claude marketplace)
// CHANGELOG.md is handwritten and never rewritten here; this script only checks that its top `## X.Y.Z` entry matches the source version.
//
// Run in:
//  --write mode (default, used by `pnpm run build`) to propagate package.json's version into the manifests
//  --check mode (used by validate / CI) to fail if any manifest or the CHANGELOG top entry drifts

import {readFileSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'

const SOURCE = 'package.json'

// Manifests whose top-level `version` field tracks the source.
const SIMPLE_TARGETS = [
  '.claude-plugin/plugin.json',
  '.codex/.codex-plugin/plugin.json',
  '.cursor-plugin/plugin.json',
  'gemini-extension.json'
]

// Marketplace manifests carry the plugin version under plugins[name=automate].version.
// Note: metadata.version must not be touched (it is the marketplace catalog version, not plugin version).
const MARKETPLACES = [
  {path: '.claude-plugin/marketplace.json', pluginName: 'automate'},
  {path: '.cursor-plugin/marketplace.json', pluginName: 'automate'}
]

const CHANGELOG = 'CHANGELOG.md'
const FIX_HINT = 'Run `pnpm run build:version` to fix this'

export function syncVersion(rootDir, {check = false} = {}) {
  const errors = []
  const warnings = []

  const readJson = (rel) => JSON.parse(readFileSync(join(rootDir, rel), 'utf8'))
  const writeJson = (rel, obj) => writeFileSync(join(rootDir, rel), JSON.stringify(obj, null, 2) + '\n')

  const version = readJson(SOURCE).version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) {
    errors.push(`${SOURCE} has an invalid version: ${JSON.stringify(version)}`)
    return {errors, warnings, version}
  }

  for (const rel of SIMPLE_TARGETS) {
    const obj = readJson(rel)
    if (obj.version === version) {
      continue
    }

    if (check) {
      errors.push(`${rel} version is ${JSON.stringify(obj.version)}, expected ${version} (from ${SOURCE}). ${FIX_HINT}.`)
    }
    else {
      obj.version = version
      writeJson(rel, obj)
    }
  }

  for (const {path, pluginName} of MARKETPLACES) {
    const market = readJson(path)
    const entry = Array.isArray(market.plugins) && market.plugins.find((p) => p.name === pluginName)
    if (!entry) {
      errors.push(`${path} has no plugins[] entry named "${pluginName}"`)
      continue
    }
    if (entry.version === version) {
      continue
    }

    if (check) {
      errors.push(`${path} plugins["${pluginName}"].version is ${JSON.stringify(entry.version)}, expected ${version}. ${FIX_HINT}.`)
    }
    else {
      entry.version = version
      writeJson(path, market)
    }
  }

  // CHANGELOG.md is handwritten; never rewritten. Its top `## X.Y.Z` entry must match the source.
  // - Hard failure under --check (the CI gate)
  // - Soft reminder under --write (the entry may not be written yet while a release is being prepared)
  const changelog = readFileSync(join(rootDir, CHANGELOG), 'utf8')
  const match = changelog.match(/^##\s+(\d+\.\d+\.\d+)\b/m)
  if (!match) {
    errors.push(`${CHANGELOG} has no \`## X.Y.Z\` entry`)
  }
  else if (match[1] !== version) {
    const msg = `${CHANGELOG} top entry is ${match[1]}, but ${SOURCE} is ${version} — add a \`## ${version} - <YYYY-MM-DD>\` entry`
    if (check) {
      errors.push(msg)
    }
    else {
      warnings.push(msg)
    }
  }

  return {errors, warnings, version}
}

// CLI runner
const isMainModule = import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  const ROOT = resolve(import.meta.dirname, '..')
  const check = process.argv.includes('--check')
  const {errors, warnings, version} = syncVersion(ROOT, {check})

  for (const msg of warnings) console.warn(`WARN: ${msg}`)

  if (errors.length > 0) {
    for (const msg of errors) console.error(`FAIL: ${msg}`)
    process.exit(1)
  }

  if (check) {
    console.log(`Plugin version ${version} is in sync across all manifests and CHANGELOG.md.`)
  }
  else {
    console.log(`Synced plugin version ${version} → manifests (source of truth: ${SOURCE}).`)
  }
}
