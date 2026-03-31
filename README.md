# Kobiton Automate

Claude Code plugin for the [Kobiton](https://kobiton.com) mobile testing platform. Manage devices, upload apps, run automation sessions, and view test results directly from your AI coding assistant.

## Installation

### From Claude Code Marketplace

```bash
claude plugins install automate
```

### Manual Setup

1. Clone this repo (or copy `.mcp.json`) into your project
2. Start Claude Code — on first use, a browser window will open for Kobiton login
3. Sign in with your Kobiton credentials. Tokens are managed automatically.

The `.mcp.json` points to the Kobiton MCP server. Authentication is handled automatically via OAuth 2.1 — the server advertises its auth endpoints and Claude Code opens a browser for login on first use.

```json
{
  "mcpServers": {
    "kobiton": {
      "type": "http",
      "url": "https://api.kobiton.com/mcp"
    }
  }
}
```

### API Key Authentication (Alternative)

For CI/CD pipelines or headless environments that cannot open a browser, use API key auth instead:

1. Copy `.mcp.apikey-example.json` to `.mcp.json`
2. Generate an API key at **Kobiton Portal > Settings > API Keys**
3. Set the environment variable:

```bash
# Add to ~/.zshrc, ~/.bashrc, or ~/.bash_profile
export KOBITON_AUTH="Basic $(echo -n 'username:apikey' | base64)"
```

1. Reload your shell and restart Claude Code.

> **Note:** OAuth and API key auth cannot coexist in a single `.mcp.json`. The default config (no `headers` block) uses OAuth via browser login. The API key config uses a `headers` block with `${KOBITON_AUTH}`. To switch, replace `.mcp.json` with the appropriate format.

## What You Can Do

**Ask Claude naturally:**

- "List my available Android devices"
- "Upload my-app.apk and run tests on the Pixel 6"
- "Show me the results for session 502"
- "Run my Appium test script on the Pixel 6"

## Tools (12)

### Devices

| Tool | Description |
|------|-------------|
| `listDevices` | List available devices filtered by platform, availability, or group |
| `getDeviceStatus` | Get real-time status of a specific device |
| `reserveDevice` | Reserve a device for exclusive testing |
| `terminateReservation` | Release a reserved device by terminating its reservation |

### Sessions

| Tool | Description |
|------|-------------|
| `listSessions` | List test sessions with filters for status, device, platform |
| `getSession` | Get session details including commands, capabilities, metadata |
| `getSessionArtifacts` | Get download URLs for video, logs, screenshots, reports |
| `terminateSession` | Stop a running test session |

### Apps

| Tool | Description |
|------|-------------|
| `listApps` | List uploaded app builds in your organization |
| `uploadAppToStore` | Upload an app to Kobiton Store (permanent, visible in portal) |
| `confirmAppUpload` | Confirm uploaded app for tracking record |
| `getApp` | Get app details and version history |

## Skills

- **run-automation-suite** -- Guided workflow that walks you through app upload, device selection, local Appium script execution (Node.js, Python, .NET, Java), and result collection.

## Upload Flow

Use `uploadAppToStore` to upload an app to Kobiton Store (POST /v2/apps). The process is three-step: call the tool to get a pre-signed URL, upload the file, then confirm.

## Running Automation Tests

Use the **run-automation-suite** skill to run local Appium test scripts. Claude reads your script, extracts capabilities, confirms the target device, and executes the script locally. Supports Node.js (`.js`), Python (`.py`), .NET (`.cs`), and Java (`.java`) scripts.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing `KOBITON_AUTH` env var | Re-run `export KOBITON_AUTH="Basic $(echo -n 'user:key' \| base64)"` and restart Claude Code |
| `MCP server not connected` | Shell env not loaded | Run `source ~/.zshrc` (or your profile) then restart Claude Code |
| `Device not found` | Device offline or reserved | Use `listDevices` with `available: true` to find online devices |
| `Upload timeout` | Large app file or slow connection | Retry the upload; pre-signed URLs expire after 30 minutes |

For additional help, open an issue at [github.com/kobiton/automate/issues](https://github.com/kobiton/automate/issues) or contact [support@kobiton.com](mailto:support@kobiton.com).

## Privacy & Data

This plugin connects to the Kobiton cloud API (`api.kobiton.com`) over HTTPS (TLS 1.2+).

**Authentication:**

- **OAuth 2.1 (default):** Claude Code opens a browser for Kobiton login. Short-lived access tokens are stored securely in the system keychain by Claude Code. No credentials are stored in the project.
- **API Key (alternative):** The `KOBITON_AUTH` environment variable is sent via the `Authorization` header on each request. The value is stored only in your shell profile, never committed to the repo.

**Data handling:**

- The plugin does not store any data locally beyond what Claude Code retains in its conversation context.
- Tool responses (device lists, session details, test results) pass through Claude Code's context window and are subject to [Anthropic's Privacy Policy](https://www.anthropic.com/privacy).
- App binaries uploaded via `uploadAppToStore` are sent directly to Kobiton's pre-signed S3 URLs, not through Claude Code.

For details on how Kobiton handles your data, see the [Kobiton Privacy Policy](https://kobiton.com/privacy-policy) and [Trust Center](https://kobiton.com/trust-center/).

## Development

The `tools/` directory contains reference YAML schemas that mirror the MCP server's tool definitions. They are published to S3 for the backend but are not consumed by the plugin at runtime.

```bash
# Install dependencies
pnpm install

# Validate manifests and schemas
pnpm run validate

# Run tests
pnpm test

# Build combined tool definitions (for S3 publishing)
pnpm run build
```

## License

MIT
