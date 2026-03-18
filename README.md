# Kobiton Skills

Claude Code plugin for the [Kobiton](https://kobiton.com) mobile testing platform. Manage devices, upload apps, run automation sessions, and view test results directly from your AI coding assistant.

## Installation

### From Claude Code Marketplace

```bash
claude plugins install kobiton-skills
```

### Manual Setup

1. Clone this repo (or copy `.mcp.json`) into your project
2. Update the `Authorization` header with your Kobiton credentials:
   - Username: your Kobiton username
   - API Key: generate at **Kobiton Portal > Settings > API Keys**
   - Encode as Base64: `base64(username:apikey)`

```json
{
  "mcpServers": {
    "kobiton": {
      "type": "http",
      "url": "https://api.kobiton.com/mcp",
      "headers": {
        "Authorization": "Basic <base64-encoded-credentials>"
      }
    }
  }
}
```

## What You Can Do

**Ask Claude naturally:**

- "List my available Android devices"
- "Upload my-app.apk and run tests on the Pixel 6"
- "Show me the results for session 502"
- "Start an Appium session on my iOS device"

## Tools (15)

### Devices

| Tool | Description |
|------|-------------|
| `listDevices` | List available devices filtered by platform, availability, or group |
| `getDeviceStatus` | Get real-time status of a specific device |
| `reserveDevice` | Reserve a device for exclusive testing |
| `terminateReservation` | Release a reserved device by terminating its reservation |

### Device Bundles

| Tool | Description |
|------|-------------|
| `listDeviceBundles` | List device bundles for matrix testing across device/OS combinations |

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
| `uploadAppForRunner` | Upload an app for test runner consumption (ephemeral) |
| `getApp` | Get app details and version history |

### Automation

| Tool | Description |
|------|-------------|
| `startNativeSession` | Start a server-managed native session (XIUM, UIAUTOMATOR, XCUITEST) |
| `startAppiumSession` | Start an Appium WebDriver session (supports W3C and legacy capabilities) |

## Skills

- **run-automation-suite** -- Guided workflow that walks you through app upload, device selection, session type choice, execution, and result collection.

## Upload Tools: Which One?

| Use Case | Tool | Endpoint |
|----------|------|----------|
| App visible in Kobiton portal | `uploadAppToStore` | POST /v2/apps |
| Quick test run, not stored | `uploadAppForRunner` | POST /v2/test-runners |

Both are two-step: call the tool to get a pre-signed URL, then upload the file.

## Session Tools: Which One?

| Use Case | Tool | Endpoint |
|----------|------|----------|
| Server-managed test execution (CI/CD) | `startNativeSession` | POST /v2/sessions/native |
| Run Appium scripts locally or via agent | `startAppiumSession` | POST /wd/hub/session |

`startAppiumSession` supports an optional `scriptPath` parameter to execute a local Appium test script.

## Development

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
