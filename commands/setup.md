---
name: "setup"
description: Fetch Kobiton credentials from the authenticated MCP server and write them to ~/.kobiton/.credentials.
allowed-tools:
  - Bash
  - Read
---

# Kobiton Automate Setup

Bootstrap the plugin: ensure the CLI wrapper symlink is installed, then fetch the user's Kobiton credentials via the `getCredential` MCP tool and write them to `~/.kobiton/.credentials`. After writing, recommend running `/automate:doctor` to verify.

## Step 0: Ensure the CLI wrapper is installed

The `run-interactive-session` skill depends on `~/.kobiton/bin/kobiton`. Claude Code and Codex CLI both recreate this wrapper automatically via a bundled SessionStart hook; on Codex, the user trusts the hook once via `/hooks` after install. This command (`/automate:setup`) re-installs the wrapper on demand. GitHub Copilot CLI and Gemini CLI also load `/automate:setup` (Copilot via Claude-format `.md`, Gemini via the bundled TOML at `commands/automate/setup.toml`) — neither has a SessionStart hook, so users on those CLIs run `/automate:setup` once after install. Cursor CLI loads this same `.md` via the `commands` field in `.cursor-plugin/plugin.json`, but registers it without the plugin namespace (it appears as `/setup`, distinguishable from Cursor's built-in `/setup` by its Kobiton description) and does not run the SessionStart hook - so Cursor CLI users also run this command once after install.

Run the install script bundled with this plugin. This file (`setup.md`) lives at `<plugin-root>/commands/setup.md`, so the install script is at `<plugin-root>/scripts/install-cli.sh`. Resolve `<plugin-root>` to its absolute path and run:

```bash
bash <plugin-root>/scripts/install-cli.sh
```

The script is idempotent. On first run it downloads the CLI build pinned by this plugin release from `public.kobiton.download` (sha256-verified, cached under `~/.kobiton/cli/`) — that needs network access once; every later run is a cache hit with no network I/O. It then installs the `~/.kobiton/bin/kobiton` entry point (a symlink to the plugin's wrapper on macOS/Linux, a bash exec-shim on Windows). Supported platforms: macOS on Apple Silicon, Linux x64, Windows x64 (Git Bash). After it returns, sanity-check the result:

```bash
[ -x "$HOME/.kobiton/bin/kobiton" ] && echo "OK" || echo "MISSING"
```

- **`OK`**: wrapper in place, continue to Step 1.
- **`MISSING`**: the install script could not install the wrapper — unsupported platform (Intel Macs and non-x64 architectures have no published CLI build) or the first-time download failed (its stderr says which). Surface the script's message to the user and continue to Step 1 anyway — credentials still need to be written so other tools work; only `run-interactive-session` is affected.

## Step 1: Fetch credentials via MCP

Call the MCP tool `getCredential` with `userIntent: "Bootstrap ~/.kobiton/.credentials for the automate plugin"`.

The tool returns:

```json
{"username": "<user>", "apiKey": "<key>", "portal": "https://api.kobiton.com"}
```

**On error:** Surface the tool's error message verbatim. If the message looks auth-related (401, "Unauthorized", etc.), tell the user:

> "MCP authentication failed. Restart Claude Code so OAuth login can complete, then run `/automate:setup` again."

Stop and do not proceed.

## Step 2: Determine the profile name

Run:

```bash
test -f ~/.kobiton/.credentials && grep -qE '^\[[[:space:]]*default[[:space:]]*\]' ~/.kobiton/.credentials && echo "DEFAULT_EXISTS" || echo "DEFAULT_FREE"
```

- **`DEFAULT_FREE`** (file missing, or no `[default]` section): use profile name `default` without asking the user.
- **`DEFAULT_EXISTS`**: derive a suggestion from the API hostname (the `portal` field — despite the name, it's the API base URL):
  - Strip protocol, `api-` / `api` prefix, and `.kobiton.com` suffix.
  - Examples: `https://api-test.kobiton.com` → `test`, `https://api-test-green.kobiton.com` → `test-green`, `https://api.kobiton.com` → `prod`.
  - Ask the user: "Profile `[default]` already exists. Suggested name: `[<derived>]`. Use this name, or pick another?"
  - Wait for confirmation or override. Use whatever name the user provides.

## Step 3: Conflict prompt (only if chosen profile already exists)

Run:

Node is used (not python3) because every supported host CLI already runs on Node, while Windows commonly has no Python — the Microsoft Store `python3` stub exits with code 49 without running anything.

```bash
PROFILE=<chosen> node <<'JS'
const fs = require("fs"), os = require("os"), path = require("path");
const name = process.env.PROFILE;
const file = path.join(os.homedir(), ".kobiton", ".credentials");
if (!fs.existsSync(file)) { console.log("PROFILE_FREE"); process.exit(0); }
const parts = fs.readFileSync(file, "utf8").split(/^\s*\[\s*([^\]]+?)\s*\]\s*$/m);
// parts = [pre, name1, body1, name2, body2, ...]
const found = {};
for (let i = 1; i < parts.length; i += 2) found[parts[i].trim()] = parts[i + 1];
if (!(name in found)) { console.log("PROFILE_FREE"); process.exit(0); }
const fields = {};
for (const raw of found[name].split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const idx = line.indexOf("=");
  fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
}
const key = fields.KOBITON_API_KEY || "";
const masked = key.length >= 8 ? key.slice(0, 4) + "..." + key.slice(-4) : "(short)";
console.log("PROFILE_EXISTS");
console.log("KOBITON_USER=" + (fields.KOBITON_USER || ""));
console.log("KOBITON_PORTAL=" + (fields.KOBITON_PORTAL || ""));
console.log("KOBITON_API_KEY=" + masked);
JS
```

- **`PROFILE_FREE`**: skip to Step 4.
- **`PROFILE_EXISTS`**: show the user the existing values (already printed by the script — relay them as-is) and ask:

  > "Profile `[<chosen>]` already exists with the values above. Choose: (1) Overwrite, (2) Keep existing — abort setup, (3) Use a different profile name."

  - **(1)**: continue to Step 4.
  - **(2)**: print "Setup aborted. Existing profile preserved." Stop.
  - **(3)**: ask for the new name and re-run Step 3 with that name.

## Step 4: Show summary and confirm before writing

Display what will be written so the user can verify before any change to disk. The API key is masked — show only the first 8 characters followed by `***`.

Format the summary like this (substitute the real values; leave the section header literal):

```
Ready to write to ~/.kobiton/.credentials:

[<chosen>]
KOBITON_USER=<username>
KOBITON_API_KEY=<first-8-chars>***
KOBITON_PORTAL=<portal>
```

If the API key is shorter than 8 characters (defensive — shouldn't happen with real keys), display only `***` instead.

Then ask the user:

> "Proceed and write to `~/.kobiton/.credentials`?"

- If they confirm: continue to Step 5.
- If they decline: print "Setup aborted. Nothing was written." Stop.

Never echo the full unmasked API key in chat.

## Step 5: Atomic write

Build the new file content in memory, preserving every other profile (both content and original position), and write atomically. When overwriting an existing profile, the new block replaces the old at the same position; only a genuinely new profile is appended at the end.

```bash
KB_PROFILE=<chosen> KB_USER=<username> KB_KEY=<apiKey> KB_PORTAL=<portal> node <<'JS'
const fs = require("fs"), os = require("os"), path = require("path");
const name = process.env.KB_PROFILE, user = process.env.KB_USER;
const key = process.env.KB_KEY, portal = process.env.KB_PORTAL;
const dir = path.join(os.homedir(), ".kobiton");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, ".credentials");
const newBlock = `[${name}]\nKOBITON_USER=${user}\nKOBITON_API_KEY=${key}\nKOBITON_PORTAL=${portal}`;
let blocks;
if (fs.existsSync(file)) {
  const parts = fs.readFileSync(file, "utf8").split(/^\s*\[\s*([^\]]+?)\s*\]\s*$/m);
  const head = parts[0].trim();
  blocks = head ? [head] : [];
  let replaced = false;
  for (let i = 1; i < parts.length; i += 2) {
    const sectionName = parts[i].trim(), body = parts[i + 1].trim();
    if (sectionName === name) {
      // Replace in-place at the original position
      blocks.push(newBlock);
      replaced = true;
    } else {
      blocks.push(`[${sectionName}]\n${body}`);
    }
  }
  // Profile is new — append at the end
  if (!replaced) blocks.push(newBlock);
} else {
  blocks = [newBlock];
}
const tmp = file + ".tmp";
fs.writeFileSync(tmp, blocks.join("\n\n") + "\n", { mode: 0o600 });
fs.renameSync(tmp, file);
try { fs.chmodSync(file, 0o600); } catch {}
console.log("WROTE " + name);
JS
```

Replace `<chosen>`, `<username>`, `<apiKey>`, `<portal>` with the actual values from Steps 1–3 before running. Pass them via env vars (`KB_*` to avoid clashing with the standard `$USER` shell variable) so they're not embedded in the heredoc and don't need shell quoting.

Windows note: POSIX file modes don't map onto NTFS ACLs, so the file may report `644` there regardless of the `0600` we set — `/automate:doctor` reports this informationally. The write itself (atomic temp-file + rename, profile preservation) behaves identically on all platforms.

## Step 6: Confirm to the user

After successful write, tell the user:

> "Profile `[<chosen>]` written to `~/.kobiton/.credentials`. Run `/automate:doctor` to verify everything is set up correctly."

If the Step 0 sanity-check reported `MISSING`, also append:

> "Note: the `~/.kobiton/bin/kobiton` CLI wrapper could not be installed (unsupported platform, or the CLI download failed — see the install script's message above). MCP tools, `run-automation-suite`, and `drive-automation-session` will still work — they read credentials from the file we just wrote. Only `run-interactive-session` requires the wrapper."

Do not echo the API key in chat.
