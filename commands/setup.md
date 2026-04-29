---
description: Fetch Kobiton credentials from the authenticated MCP server and write them to ~/.kobiton/.credentials.
allowed-tools:
  - Bash
  - Read
---

# Kobiton Automate Setup

Fetch the user's Kobiton credentials via the `getCredential` MCP tool and write them to `~/.kobiton/.credentials`. After writing, recommend running `/automate:doctor` to verify.

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

```bash
PROFILE=<chosen> python3 -c '
import os, re, sys
name = os.environ["PROFILE"]
path = os.path.expanduser("~/.kobiton/.credentials")
if not os.path.exists(path):
    print("PROFILE_FREE"); sys.exit(0)
with open(path) as f:
    text = f.read()
sections = re.split(r"(?m)^\s*\[\s*([^\]]+?)\s*\]\s*$", text)
# sections = [pre, name1, body1, name2, body2, ...]
found = {sections[i]: sections[i+1] for i in range(1, len(sections), 2)}
if name not in found:
    print("PROFILE_FREE"); sys.exit(0)
body = found[name]
fields = {}
for line in body.splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    k, v = line.split("=", 1)
    fields[k.strip()] = v.strip()
key = fields.get("KOBITON_API_KEY","")
masked = (key[:4] + "..." + key[-4:]) if len(key) >= 8 else "(short)"
print("PROFILE_EXISTS")
print("KOBITON_USER=" + fields.get("KOBITON_USER",""))
print("KOBITON_PORTAL=" + fields.get("KOBITON_PORTAL",""))
print("KOBITON_API_KEY=" + masked)
'
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

Build the new file content in memory, preserving every other profile untouched, and write atomically.

```bash
KB_PROFILE=<chosen> KB_USER=<username> KB_KEY=<apiKey> KB_PORTAL=<portal> python3 <<'PY'
import os, re, sys
name = os.environ["KB_PROFILE"]
user = os.environ["KB_USER"]
key = os.environ["KB_KEY"]
portal = os.environ["KB_PORTAL"]
path = os.path.expanduser("~/.kobiton/.credentials")
os.makedirs(os.path.dirname(path), exist_ok=True)

if os.path.exists(path):
    with open(path) as f:
        text = f.read()
    parts = re.split(r"(?m)^\s*\[\s*([^\]]+?)\s*\]\s*$", text)
    head = parts[0].strip()
    others = []
    for i in range(1, len(parts), 2):
        section_name = parts[i].strip()
        body = parts[i+1].strip()
        if section_name == name: continue
        others.append("[" + section_name + "]\n" + body)
    blocks = []
    if head:
        blocks.append(head)
    blocks.extend(others)
else:
    blocks = []

new_block = "[" + name + "]\nKOBITON_USER=" + user + "\nKOBITON_API_KEY=" + key + "\nKOBITON_PORTAL=" + portal
blocks.append(new_block)
content = "\n\n".join(blocks) + "\n"

tmp = path + ".tmp"
old_umask = os.umask(0o077)
try:
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(content)
    os.replace(tmp, path)
    os.chmod(path, 0o600)
finally:
    os.umask(old_umask)
print("WROTE " + name)
PY
```

Replace `<chosen>`, `<username>`, `<apiKey>`, `<portal>` with the actual values from Steps 1–3 before running. Pass them via env vars (`KB_*` to avoid clashing with the standard `$USER` shell variable) so they're not embedded in the heredoc and don't need shell quoting.

## Step 6: Confirm to the user

After successful write, tell the user:

> "Profile `[<chosen>]` written to `~/.kobiton/.credentials`. Run `/automate:doctor` to verify everything is set up correctly."

Do not echo the API key in chat.
