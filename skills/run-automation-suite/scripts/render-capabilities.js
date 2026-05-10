import {readFileSync} from 'fs'
import {resolve} from 'path'
import ejs from 'ejs'
import {parseArgs} from 'util'

const TEMPLATE_PATH = resolve(
  import.meta.dirname, '..', 'references', 'templates', 'appium.ejs'
)

const {values: flags} = parseArgs({
  options: {
    platformName:    {type: 'string'},
    udid:            {type: 'string'},
    deviceName:      {type: 'string'},
    platformVersion: {type: 'string'},
    automationName:  {type: 'string'},
    app:             {type: 'string'},
    browserName:     {type: 'string'},
    testingType:     {type: 'string', default: 'app'},
    aiToolName:      {type: 'string'}
  },
  strict: false
})

// AI workspace identifier shipped on every wdio session as
// `kobiton:aiToolName`, used by Kobiton for adoption analytics
// (KOB-52724). Resolution order:
//   1. --aiToolName CLI arg (lets Kobiton's parallel plugins for other
//      AI tools pass their own canonical name when they reuse this
//      skill — Cursor, VS Code Copilot, Gemini CLI, Codex CLI, etc.)
//   2. KOBITON_AI_TOOL_NAME env var (host plugin can configure once
//      per process rather than threading the flag at every call site)
//   3. 'Claude' default — this plugin ships inside the Claude Code
//      marketplace (.claude-plugin/plugin.json), so the only host that
//      actually runs this script today IS Claude Code.
// Set explicitly to an empty string ('--aiToolName ""') to opt out and
// emit no `kobiton:aiToolName` capability at all.
const aiToolName = flags.aiToolName !== undefined
  ? flags.aiToolName
  : (process.env.KOBITON_AI_TOOL_NAME ?? 'Claude')

// Validate required flags
const errors = []
if (!flags.platformName) errors.push('--platformName is required')
if (!flags.udid) errors.push('--udid is required')
if (!flags.deviceName) errors.push('--deviceName is required')
if (!flags.platformVersion) errors.push('--platformVersion is required')
if (flags.testingType === 'app' && !flags.app) {
  errors.push('--app is required when --testingType is app')
}
if (flags.testingType === 'web' && !flags.browserName) {
  errors.push('--browserName is required when --testingType is web')
}
if (errors.length) {
  process.stderr.write(errors.join('\n') + '\n')
  process.exit(1)
}

// Build template variables: CLI flags + hardcoded defaults
const templateVars = {
  // From CLI
  platformName: flags.platformName,
  udid: flags.udid,
  deviceName: flags.deviceName,
  platformVersion: flags.platformVersion,
  automationName: flags.automationName || '',
  app: flags.app || '',
  browser: flags.browserName || '',
  testingType: flags.testingType,

  // Hardcoded defaults
  sessionName: 'Automation test session',
  sessionDescription: '',
  orientation: 'portrait',
  captureScreenshots: true,
  showCleanUpDeviceOnExit: true,
  cleanUpDeviceOnExit: false,
  useSpecificDevice: true,
  deviceGroup: 'ORGANIZATION',
  showDeviceGroup: false,

  // Resolved above (CLI > env > 'Claude' default)
  aiToolName
}

// Render template and output JSON
try {
  const template = readFileSync(TEMPLATE_PATH, 'utf8')
  const rendered = ejs.render(template, templateVars)

  // Clean trailing commas before closing brace (EJS conditionals can leave them)
  const cleaned = rendered.replace(/,(\s*})/g, '$1')

  // Validate it's valid JSON
  const caps = JSON.parse(cleaned)
  process.stdout.write(JSON.stringify(caps, null, 2) + '\n')
} catch (err) {
  process.stderr.write(`Template render error: ${err.message}\n`)
  process.exit(1)
}
