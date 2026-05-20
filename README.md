# <img src="./assets/logo.svg" width="35" align="center" alt="Kobiton Logo" /> Kobiton Automate

[![Discord](https://img.shields.io/discord/1486036652685267055?color=7289DA&label=Discord&logo=discord&logoColor=white)](https://discord.gg/uHvBFDZVP)
[![Cloud](https://img.shields.io/badge/Cloud-☁️-blue)](https://kobiton.com)
[![Twitter Follow](https://img.shields.io/twitter/follow/KobitonMobile?style=social)](https://x.com/KobitonMobile)

Plugin for the [Kobiton](https://kobiton.com) mobile testing platform. Works with [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview), [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli), [Gemini CLI](https://github.com/google-gemini/gemini-cli), and [Codex CLI](https://github.com/openai/codex). Manage devices, upload apps, run automation sessions, and view test results directly from your AI coding assistant.

## Contents

- [Before You Begin](#before-you-begin)
- [Installation](#installation)
  - [Claude Code](#claude-code)
  - [GitHub Copilot CLI](#github-copilot-cli)
  - [Gemini CLI](#gemini-cli)
  - [Codex CLI](#codex-cli)
- [Login](#login)
  - [API Key Authentication (Alternative)](#api-key-authentication-alternative)
- [Getting Started](#getting-started)
- [What You Can Do](#what-you-can-do)
- [Tools](#tools-12)
- [Skills](#skills)
- [Running Automation Tests](#running-automation-tests)
- [Troubleshooting](#troubleshooting)
- [Privacy & Data](#privacy--data)
- [Development](#development)
- [License](#license)

## Before You Begin

Make sure you have:

- **A Kobiton account** - sign up at [kobiton.com](https://kobiton.com) if you don't have one
- **A supported AI CLI** - install [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview), [Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli), [Gemini CLI](https://github.com/google-gemini/gemini-cli), or [Codex CLI](https://github.com/openai/codex)
- **A project directory** - your AI assistant must launch from a workspace, not from your home folder

## Installation

### Claude Code

Open your project and start a Claude Code session:

```bash
cd my-project
claude
```

Inside the session, add the Kobiton marketplace and install the plugin:

```
/plugin marketplace add kobiton/automate
/plugin install automate@kobiton
```

### GitHub Copilot CLI

Open your project and start a Copilot CLI session:

```bash
cd my-project
copilot
```

Inside the session, add the Kobiton marketplace and install the plugin:

```
/plugin marketplace add kobiton/automate
/plugin install automate@kobiton
```

### Gemini CLI

From your project directory, install the extension directly from GitHub:

```bash
cd my-project
gemini extensions install https://github.com/kobiton/automate
```

Then launch Gemini CLI:

```bash
gemini
```

The `kobiton` MCP server and bundled skills are auto-discovered. Confirm the extension is active with `/extensions list` and the MCP server with `/mcp`.

### Codex CLI

Add the Kobiton marketplace and install the plugin from the in-session browser. Codex opens a browser for Kobiton OAuth login on the first tool call — no API key setup required.

```bash
codex plugin marketplace add kobiton/automate
codex
```

Inside Codex:

1. Type `/plugins` to open the plugin browser
2. Select the **kobiton** marketplace, then install the **automate** plugin
3. The system browser should open for Kobiton OAuth login. After sign-in, tokens are cached in the OS keychain (macOS Keychain / Linux Secret Service / Windows Credential Manager) with automatic refresh.
4. Run `/mcp` to confirm `kobiton` is **Connected**.

<details>
<summary><strong>Fallback: manual <code>config.toml</code> setup</strong></summary>

If you prefer not to use the marketplace, register the MCP server directly in `~/.codex/config.toml`:

```toml
[mcp_servers.kobiton]
url = "https://api.kobiton.com/mcp"
```

Then copy `AGENTS.md` into your workspace so Codex picks up the tool list and skill reference:

```bash
curl -sLO https://raw.githubusercontent.com/kobiton/automate/main/AGENTS.md
```

Launch `codex` and run `/mcp` to confirm. The OAuth flow still applies on the first tool call.
</details>

## Login

The first time your AI assistant calls a Kobiton tool, a browser window opens for OAuth login. Sign in with your Kobiton credentials — tokens are then managed automatically by the assistant.

You can also trigger or inspect authentication explicitly:

- **Claude Code**: type `/mcp` and select **kobiton** to start the OAuth flow
- **GitHub Copilot CLI**: type `/mcp auth kobiton` to start the OAuth flow; use `/mcp` (or `/mcp show`) to inspect server status
- **Gemini CLI**: type `/mcp auth kobiton` to start the OAuth flow; use `/mcp` to inspect server status
- **Codex CLI**: browser opens automatically on the first MCP tool call (e.g. *"List my Kobiton devices"*) after plugin install. Tokens are cached in the OS keychain with automatic refresh. Use `/mcp` (or `/mcp verbose`) to inspect server status

Behind the scenes, `.mcp.json` points to the Kobiton MCP server and authentication uses OAuth 2.1:

```json
{
  "mcpServers": {
    "kobiton": {
      "type": "http",
      "url": "https://api.kobiton.com/mcp",
      "headers": {
        "X-AI-Tool-Name": "Claude"
      }
    }
  }
}
```

The `X-AI-Tool-Name` header tells Kobiton's MCP server that the request originates from Claude Code so usage can be attributed correctly in adoption analytics. It is not used for authentication or routing — only for telemetry.

After login, verify the plugin loaded by asking your assistant: *"List my Kobiton devices"*. If tools aren't recognized, see [Troubleshooting](#troubleshooting).

### API Key Authentication (Alternative)

For CI/CD pipelines or headless environments that cannot open a browser, use API key auth instead:

1. Copy `.mcp.apikey-example.json` to `.mcp.json`
2. Generate an API key at **Kobiton Portal > Settings > API Keys**
3. Set the environment variable:

   ```bash
   # Add to ~/.zshrc, ~/.bashrc, or ~/.bash_profile
   export KOBITON_AUTH="Basic $(echo -n 'username:apikey' | base64)"
   ```

4. Reload your shell and restart your AI CLI.

> **Note:** OAuth and API key auth cannot coexist in a single `.mcp.json`. The default OAuth config uses a `headers` block containing only `X-AI-Tool-Name`. The API key config adds `Authorization: ${KOBITON_AUTH}` to the same `headers` block. To switch, replace `.mcp.json` with the appropriate format.
>
> **Gemini CLI:** API key auth requires editing `gemini-extension.json` instead of `.mcp.json`. Add a `headers` block under `mcpServers.kobiton` with `"Authorization": "${KOBITON_AUTH}"`.
>
> **Codex CLI:** OAuth is the default. For CI/headless environments where a browser cannot open, switch to API key auth by adding an `env_http_headers` block to the installed plugin's `.mcp.json` at `~/.codex/.tmp/marketplaces/kobiton/.codex/.mcp.json` (or maintain a fork), then export `KOBITON_AUTH` in the shell that launches `codex`:
>
> ```json
> "env_http_headers": { "Authorization": "KOBITON_AUTH" }
> ```

## Getting Started

After installation, run setup to fetch your credentials and write them to `~/.kobiton/.credentials`:

```
/automate:setup
```

The plugin uses your already-authenticated MCP session (OAuth) to fetch your username and API key — no manual file editing required.

To verify everything is wired correctly, run the diagnostic:

```
/automate:doctor
```

`/automate:doctor` is read-only. It checks the CLI installation (symlink + target), the credentials file, the active profile, and required fields, and prints actionable remediation hints for any failures.

**CLI symlink install behavior across CLIs:** The `run-interactive-test` skill depends on a `~/.kobiton/bin/kobiton` symlink.

- **Claude Code** — the symlink is recreated automatically by a SessionStart hook on every session start. Running `/automate:setup` also recreates it. No manual step needed.
- **GitHub Copilot CLI, Gemini CLI** — both CLIs load `/automate:setup` (Copilot reads Claude-format Markdown commands; Gemini reads bundled TOML commands at `commands/automate/setup.toml`). Run `/automate:setup` once after install to create the symlink. Neither CLI has a SessionStart hook, so the symlink isn't recreated automatically — re-run setup if it goes missing.
- **Codex CLI** — Codex's plugin manifest has no `commands` field, so `/automate:setup` is unavailable. Run the bundled installer script directly once after installing the plugin:

  ```bash
  bash "$(find ~/.codex -name install-cli.sh -path '*automate*' 2>/dev/null | head -1)"
  ```

  The script is idempotent — safe to re-run.

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

| Skill | Description |
|-------|-------------|
| **run-automation-suite** | Guided workflow for app upload, device selection, local Appium script execution (Node.js, Python, .NET, Java), and result collection. |
| **run-interactive-test** | Guided workflow for interactive testing using natural language. WebDriver actions, device operations (adb shell, logs, screen), file management (push/pull), and more. |

> **Platform support note:** all MCP tools and the `run-automation-suite` skill work on every platform the host CLI supports. The `run-interactive-test` skill ships a CLI binary for **macOS Apple Silicon** only. On other platforms, use `run-automation-suite` or the MCP tools directly.

## Commands

| Command | Description |
|---------|-------------|
| `/automate:setup` | Fetch credentials from the authenticated MCP server and write them to `~/.kobiton/.credentials` |
| `/automate:doctor` | Read-only diagnostic for CLI installation, credentials file, active profile, and required fields |


## Running Automation Tests

Use the **run-automation-suite** skill to run local Appium test scripts. Claude reads your script, extracts capabilities, confirms the target device, and executes the script locally. Supports Node.js (`.js`), Python (`.py`), .NET (`.cs`), and Java (`.java`) scripts.

## Interactive Device Testing

Use the **run-interactive-test** skill to interact with devices using natural language. Describe what you want — "tap the login button", "type hello in the search field", "swipe down" — and Claude translates your intent into CLI commands.

Beyond WebDriver, the skill also supports device operations (adb shell, logs, screen capture), file management (push/pull files to device), and app management.

## Examples

See [docs/EXAMPLES.md](docs/EXAMPLES.md) for prompt examples covering every tool and skill — device management, session management, app management, automation, and interactive testing.

## Troubleshooting

### Updating the Plugin

After the plugin is updated upstream, pull the latest version:

- **Claude Code / Copilot CLI:** run `/plugin install automate@kobiton` again
- **Gemini CLI:** run `gemini extensions update kobiton-automate` from your shell
- **Codex CLI:** run `codex plugin marketplace upgrade` to refresh the marketplace catalog, then reinstall the plugin from the browser to pull the latest manifest

To make sure the assistant picks up the changes with no stale cache:

1. Run `/reload-plugins` (Claude Code) to reload all plugins in the current session
2. If tools still behave unexpectedly, run `/clear` to reset the session context
3. As a last resort, quit your CLI session and start a new one

### Common Issues

<details>
<summary><strong>MCP server doesn't appear in <code>/mcp</code> after install</strong></summary>

All four CLIs cache plugin state when the session starts. After installing or updating the plugin, the `kobiton` MCP server may not show up in the server list immediately. Force a reload:

**Claude Code** — reload plugins in the current session:

```
/reload-plugins
```

**GitHub Copilot CLI** — exit and relaunch the session:

```bash
exit
copilot
```

**Gemini CLI** — exit and relaunch; if still missing, verify the extension is enabled:

```bash
exit
gemini extensions list
gemini
```

**Codex CLI** — exit and relaunch; if still missing, verify the marketplace was added and the plugin was installed:

```bash
exit
codex plugin marketplace list
codex plugin list
codex
```

If using the manual fallback config, also check `grep -A 4 "mcp_servers.kobiton" ~/.codex/config.toml`.

Then check the server list (`/mcp` in Claude Code, Gemini CLI, and Codex CLI, `/mcp show` in Copilot CLI). `kobiton` should now appear.
</details>

<details>
<summary><strong>Plugin features not working or behaving unexpectedly</strong></summary>

Some older versions of Claude Code don't support the plugin features this plugin relies on. Make sure you're on the latest version:

```bash
npm install -g @anthropic-ai/claude-code@latest
```

Then restart Claude Code and try again.
</details>

<details>
<summary><strong>"It keeps asking me to open a folder"</strong></summary>

Claude Code requires a working directory. Launch it from inside a project folder:

```bash
cd my-project
claude
```

If you see this prompt repeatedly, make sure you are not running `claude` from your home directory or root (`/`).
</details>

<details>
<summary><strong>"Plugin not found in marketplace"</strong></summary>

The Kobiton marketplace must be added before installing:

```bash
/plugin marketplace add kobiton/automate
/plugin install automate@kobiton
```

If it still isn't found, check your internet connection and ensure you're running the latest version of Claude Code (`claude update`).
</details>

<details>
<summary><strong>"claude: command not found"</strong></summary>

Claude Code is not installed or not in your PATH.

- **Install:** follow the [official install guide](https://docs.anthropic.com/en/docs/claude-code/overview)
- **PATH issue:** if you installed via npm, make sure your npm global bin directory is in your PATH:

  ```bash
  npm install -g @anthropic-ai/claude-code
  ```

  Then open a new terminal window and try `claude` again.
</details>

<details>
<summary><strong>"Nothing happens after install"</strong></summary>

The plugin installed but tools don't appear or Claude doesn't recognize Kobiton commands.

1. Run `/reload-plugins` to force Claude to pick up the new plugin
2. Try asking: *"List my Kobiton devices"*
3. If still not working, quit Claude Code entirely and start a fresh session
4. Verify `.mcp.json` exists in the plugin directory — it tells Claude where the Kobiton MCP server lives
</details>

<details>
<summary><strong>"Device not found"</strong></summary>

The device may be offline, reserved by another user, or no longer in your device list. Use `listDevices` with `available: true` to find currently online devices.
</details>

<details>
<summary><strong>"Upload timeout"</strong></summary>

Large app files or slow connections can cause uploads to time out. Retry the upload — pre-signed URLs expire after 30 minutes, so a new URL will be generated automatically.
</details>

### Copilot CLI

<details>
<summary><strong>MCP tools not available after plugin install</strong></summary>

Verify the plugin is installed and the MCP server is configured:

```bash
# Check installed plugins
copilot plugin list

# Check MCP server status
/mcp show
```

If the `kobiton` MCP server doesn't appear, add it manually by running `/mcp add` and entering the following when prompted:

- **Server name:** `kobiton`
- **Type:** `http`
- **URL:** `https://api.kobiton.com/mcp`

Alternatively, edit `~/.copilot/mcp-config.json` directly:

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
</details>

<details>
<summary><strong>Tool calls are blocked</strong></summary>

Copilot CLI requires explicit tool permissions. Allow Kobiton tools:

```bash
# Allow all Kobiton MCP tools
copilot --allow-tool='kobiton'

# Or allow specific tools
copilot --allow-tool='kobiton(listDevices)' --allow-tool='kobiton(getSession)'
```
</details>

### Gemini CLI

<details>
<summary><strong>Extension installed but tools or skills don't appear</strong></summary>

Verify the extension is registered and enabled:

```bash
gemini extensions list
```

If `kobiton-automate` is missing, reinstall:

```bash
gemini extensions install https://github.com/kobiton/automate
```

If listed but disabled, enable it:

```bash
gemini extensions enable kobiton-automate
```

Then relaunch `gemini` and check `/mcp` for the `kobiton` server. The `run-automation-suite` skill is auto-discovered from `skills/` at the extension root, no separate registration needed.
</details>

<details>
<summary><strong><code>/mcp</code> shows <code>kobiton</code> as Disconnected (OAuth not authenticated)</strong></summary>

The extension is installed but you haven't completed OAuth yet. Trigger the flow manually:

```
/mcp auth kobiton
```

A browser window opens for Kobiton login. After signing in, run `/mcp` again — the status should change to 🟢 Connected.

Note: `kobiton` here is the **MCP server name** (declared inside the extension), not the extension name `kobiton-automate`. `/mcp` commands always take the server name.
</details>

<details>
<summary><strong>OAuth doesn't open a browser on first tool call</strong></summary>

Gemini CLI's extension uses dynamic OAuth discovery by default. The Kobiton MCP server advertises OAuth metadata at a standard well-known endpoint, so the browser flow should kick in automatically the first time a tool needs auth.

If nothing happens, try `/mcp auth kobiton` to trigger it explicitly. Check that your terminal can launch a browser. For headless environments, switch to API key auth by editing `gemini-extension.json` directly (see the **API Key Authentication** section above).
</details>

### Codex CLI

<details>
<summary><strong>Tools not appearing or "MCP server kobiton not initialized"</strong></summary>

Verify each step:

1. **Plugin installed** — open `/plugins` inside Codex and confirm `automate` is listed under the `kobiton` marketplace as **Installed**. If missing, run `codex plugin marketplace add kobiton/automate` and reinstall from the plugin browser.
2. **Codex version recent enough** — update with `npm install -g @openai/codex@latest`.

After fixing, exit Codex and relaunch; the server should show in `/mcp` (or `/mcp verbose`).
</details>

<details>
<summary><strong>Browser does not open for OAuth login</strong></summary>

Codex tries to launch your system browser when Kobiton requires sign-in. If nothing opens, check:

1. **Default browser is set** — your OS needs a default browser. SSH sessions without X forwarding cannot open one.
2. **Localhost ports not blocked** — Codex listens on a local port to receive the login callback. Firewall rules that block all localhost ports will break the flow.
3. **Headless environment** — switch to API key auth (see the **API Key Authentication** section above) and add `env_http_headers` to the installed plugin's `.mcp.json`.
</details>

<details>
<summary><strong>OAuth login completes but <code>/mcp</code> still shows Disconnected</strong></summary>

This usually means the cached token is stale and refresh failed. Force a re-login by clearing the OS keychain entry and reconnecting:

- **macOS:** open Keychain Access, search for `codex-mcp` or `kobiton`, delete the entry, then trigger a tool call to re-run OAuth.
- **Linux:** `secret-tool clear service codex-mcp` (or use Seahorse to remove the entry).
- **Windows:** open Credential Manager, find the Codex entry under Generic Credentials, remove it.

After clearing, run any Kobiton tool prompt; the browser should reopen for fresh login.
</details>

### Still Stuck?

For additional help, open an issue at [github.com/kobiton/automate/issues](https://github.com/kobiton/automate/issues/new?template=bug_report.md) or ask in [#general-discussion](https://discord.com/channels/1486036652685267055/1488189710248710327) on Discord. Feel free to share [feature requests](https://github.com/kobiton/automate/issues/new?template=feature_request.md). We welcome product feedback and will consider it as we continue to improve the platform.

## Privacy & Data

This plugin connects to the Kobiton cloud API (`api.kobiton.com`) over HTTPS (TLS 1.2+).

**Authentication:**

- **OAuth 2.1 (default):** Your AI assistant opens a browser for Kobiton login. Short-lived access tokens are stored securely in the system keychain. No credentials are stored in the project.
- **API Key (alternative):** The `KOBITON_AUTH` environment variable is sent via the `Authorization` header on each request. The value is stored only in your shell profile, never committed to the repo.

**Data handling:**

- The plugin does not store any data locally beyond what your AI assistant retains in its conversation context.
- Tool responses (device lists, session details, test results) pass through your assistant's context window and are subject to [Anthropic's Privacy Policy](https://www.anthropic.com/privacy), [GitHub Copilot's Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement), [Google's Gemini Privacy Notice](https://ai.google.dev/gemini-api/terms), or [OpenAI's Privacy Policy](https://openai.com/policies/privacy-policy), depending on which assistant you use.
- App binaries uploaded via `uploadAppToStore` are sent directly to Kobiton's pre-signed S3 URLs, not through your AI assistant.

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

# Refresh the .codex/ mirror after editing skills/ or assets/
pnpm run build:codex

# Build combined tool definitions (for S3 publishing)
pnpm run build
```

## License

[MIT](https://opensource.org/license/mit)
