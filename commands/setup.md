---
description: First-time setup for the Kobiton automate plugin. Verifies CLI installation and guides credentials configuration.
allowed-tools:
  - Bash
  - Read
---

# Kobiton Automate Setup

Walk the user through first-time setup for the Kobiton automate plugin. This command is re-runnable — if everything is already configured, confirm and offer to reconfigure.

## Step 1: Verify CLI Installation

Run:

```bash
test -x ~/.kobiton/bin/kobiton-wd && echo "INSTALLED" || echo "MISSING"
```

**If MISSING:**

> "The `kobiton-wd` CLI is not installed yet. It's set up automatically when a Claude Code session starts with the Kobiton plugin loaded. Please restart your Claude Code session and try `/automate:setup` again."

Stop here — do not proceed to credentials until the CLI is available.

**If INSTALLED:** Confirm and proceed to Step 2.

## Step 2: Check Credentials

Run:

```bash
test -f ~/.kobiton/.credentials && echo "EXISTS" || echo "MISSING"
```

**If MISSING:**

Show the user the expected file path and format. Ask them to create it themselves — never read, write, or modify the credentials file.

> "Credentials file not found. Please create `~/.kobiton/.credentials` with your Kobiton API credentials. You can find your API key in the Kobiton portal under **Settings > API Keys**."
>
> **Format:**
> ```
> [default]
> KOBITON_USERNAME=<your-username>
> KOBITON_API_KEY=<your-api-key>
> ```
>
> **Multiple profiles** (optional):
> ```
> [default]
> KOBITON_USERNAME=myuser
> KOBITON_API_KEY=abc123
>
> [test-green]
> KOBITON_USERNAME=myuser
> KOBITON_API_KEY=xyz789
> ```
>
> The `[default]` profile is used automatically. To switch profiles, set `export KOBITON_PROFILE=<profile-name>` before running commands.
>
> After creating the file, run `/automate:setup` again to verify.

Stop here — do not proceed to verification until the user confirms they've created the file.

**If EXISTS:** Confirm credentials file is present. Offer guidance:

> "Credentials file found at `~/.kobiton/.credentials`. If you need to update your credentials or add a new profile, edit the file directly using the format above."

Proceed to Step 3.

## Step 3: Verify CLI Works

Run:

```bash
~/.kobiton/bin/kobiton-wd --help
```

**If succeeds:** Setup is complete.

> "Setup complete! The Kobiton CLI is installed and credentials are configured. You can now use `/run-interactive-test` to start testing on devices."

**If fails:** Report the error and suggest troubleshooting.

> "The CLI returned an error. Try restarting your Claude Code session. If the issue persists, check that the Kobiton plugin is installed correctly."
