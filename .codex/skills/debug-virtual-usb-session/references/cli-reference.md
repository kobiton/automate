# virtualUSB client reference

Everything here was captured from client build `2609.111336.0+master.a033b54` (the pin in `VUSB_VERSION`). Always call the client through the wrapper `~/.kobiton/bin/vusb` by absolute path — `~/.kobiton/bin` is not on `PATH` and must not be added to it.

## Command surface

```
vusb --version                 # prints: virtualUSB <version>
vusb login [OPTIONS]           # --apibaseurl <url> --username <user-or-email> --apikey <uuid>
vusb logout
vusb connect --udid <udid>     # books the device and attaches it to this machine over USB-over-IP
vusb disconnect --udid <udid>  # detaches it and releases the device
vusb status                    # connection status of all devices attached by this machine
vusb clear-pairing             # forgets stored device pairing records
vusb export-logs [--out <dir>] [--days <n>]
```

- `--udid` is required on `connect` and `disconnect`; omitting it prints `error: The following required arguments were not provided:` and the usage.
- `vusb <subcommand> --help` prints that subcommand's options. `vusb login --help` passes through the wrapper untouched (no credential injection).
- Sign-in is API-key only. Through the wrapper, plain `~/.kobiton/bin/vusb login` is enough: it reads the active profile (`$KOBITON_PROFILE`, default `default`) of `~/.kobiton/.credentials` and injects `--apibaseurl`, `--username`, `--apikey`. Pass `--apikey` yourself to bypass the injection. The key never appears in the transcript.
- `connect` does the device booking itself: never call the `reserveDevice` MCP tool before it (the connect would then be refused as already retained), and never `terminateReservation` after — `disconnect --udid` is the release.
- First `connect` on macOS (and after every version bump) installs the client's background daemon through an **administrator dialog in the GUI session**. Approve it once; it cannot be answered over SSH.

## `status` output shapes to parse

The exit code is **not** a reliable success signal: the client has been observed exiting 0 on some failures and 1 on others. Parse stdout+stderr.

| Situation | Output |
|---|---|
| Daemon not running (fresh install, before the first `connect`) | `Failed to get status: DcbStatusError { message: "Unable to get connected device status: Failed to run command: Failed to connect to dcb app server: Connection refused (os error 61)" }` |
| Not signed in (`connect` / `disconnect` / `status`) | `… Authentication error: Authorization info not found. Please login to your Kobiton's account first!` — `connect` prefixes it with `Connecting device <udid>...` then `Connect failed:`; `disconnect` with `Disconnect failed:` |
| Nothing attached | no device lines (a "no devices" / empty listing) |
| Device attached | a line containing the UDID and a connected-state word (`Connected`) — treat the presence of the UDID as "attached" |

Decision rule for Step 7 / Step 9 of the skill: **connected** ⇔ the picked UDID appears in `status` output and no `Failed`/`error` line is present; **released** ⇔ the UDID no longer appears. Any `Failed to get status` line means the daemon is not up — go to the error map, do not loop.

## Preflight `key=value` contract

`bash <plugin-root>/skills/debug-virtual-usb-session/scripts/vusb-preflight.sh` prints, on stdout and in this order:

| Key | Value |
|---|---|
| `platform=` | `darwin` \| `windows` \| `linux` \| `unknown` |
| `pin=` | the version in `VUSB_VERSION` |
| `installed=` | the `--version` token of the client that will be used, or empty |
| `latest=` | only when the pinned folder is no longer published: the current version on the download host |
| `vusb=` | absolute path of the client in use (cache bundle binary, `/Applications/virtualUSB.app/Contents/MacOS/vusb`, or `C:\Program Files\virtualUSB\vusb.exe` as `/c/Program Files/virtualUSB/vusb.exe`), or empty |
| `outcome=` | last line: `no action needed` \| `installed` \| `updated` \| `handed off to human` \| `redirected (limitation)` |

Exit codes: `0` for every outcome above, including offline or a pruned pin (with or without a cache). `1` only for a checksum mismatch (`checksum mismatch for <artifact> (<version>) - download discarded, existing cache untouched.`), an unfetchable `.sha256` (`could not fetch checksum for <version> (HTTP <code>) - refusing unverified install.`), no sha256 tool, or an unpack failure — then no `outcome=` line is printed and stderr carries the reason. Human-readable messages (hand-off steps, warnings) always go to stderr.

Cache layout: `~/.kobiton/vusb/<version>/virtualUSB.app` (macOS, whole bundle) or `~/.kobiton/vusb/<version>/windows.msi` (Windows, verified installer for the human to run). Downloads come from `${KOBITON_VUSB_BASE_URL:-https://public.kobiton.download/virtualusb}/<version>/<artifact>` plus `<artifact>.sha256`; `latest/` is only ever consulted with a HEAD request to name the current version, never to install from.

Wrapper resolution order (`~/.kobiton/bin/vusb` → `scripts/vusb.sh`): macOS `~/.kobiton/vusb/<pin>/…/vusb` → `/Applications/virtualUSB.app/…/vusb` if its token equals the pin → newest cached bundle with a `Warning: pinned virtualUSB version … is not cached` on stderr → error (exit 1) pointing at the preflight. Windows: `C:\Program Files\virtualUSB\vusb.exe` or the same error.
