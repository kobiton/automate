---
name: debug-device-over-vusb
description: >-
  Debug the user's app on a real Kobiton device attached to this machine over
  virtualUSB, driven by natural language. Installs the pinned virtualUSB
  client on first use (macOS: cached bundle; Windows: verified installer
  handed to the user), finds vUSB-ready private devices with
  listDevices({virtualUsb: true}), connects the chosen device with the
  virtualUSB CLI so it shows up in adb / Xcode locally, runs the debug loop
  (install build, reproduce, capture logcat / device logs, screenshots), and
  always disconnects. Use when the user wants to "debug on a real device",
  "see the device in adb / Xcode", "plug the Kobiton device into my machine",
  or says "virtualUSB" / "vusb". Not for exploratory testing through the
  Kobiton session CLI - that is run-interactive-session.
allowed-tools: >-
  Read,
  Bash(~/.kobiton/bin/vusb:*),
  Bash(bash:*), Bash(adb:*), Bash(xcrun:*),
  Bash(uname:*), Bash(pgrep:*),
  Bash(cat:*), Bash(grep:*), Bash(head:*), Bash(tail:*),
  Bash(sleep:*), Bash(timeout:*)
version: 1.0.0
author: Kobiton Inc.
license: MIT
compatibility: >-
  macOS (any architecture - the pinned client is a universal build,
  downloaded on first use, sha256-verified, cached under ~/.kobiton/vusb/;
  the first connect installs a background daemon via one administrator
  dialog in the GUI session) and Windows (x64, under Git Bash - the
  pinned .msi is downloaded and verified, then installed once by the user
  with administrator rights). Linux hosts are redirected (not supported by
  this skill). iOS devices are list-only on Windows hosts; iOS 17.0-17.3 is
  unsupported. Needs a persistent local filesystem, ~/.kobiton/.credentials
  written by /automate:setup (the wrapper signs in with the API key from
  it), adb for Android, Xcode command line tools for iOS, and a Kobiton
  organization with the virtualUSB add-on and at least one private device
  whose host machine has virtualUSB enabled.
tags: [mobile, debugging, virtualusb, adb, xcode, devices, kobiton]
---

# Debug on a Real Device over virtualUSB

## Overview

Attach a real Kobiton device to the user's own machine over virtualUSB and debug the user's app on it the way they would with a phone on their desk: it shows up in `adb devices` (Android) or Xcode's device list (iOS), so the user's normal install / reproduce / read-the-logs loop works, driven from plain language. The skill owns the whole lifecycle - client install, device discovery, connect, verification, the debug loop, and an unconditional disconnect - and reports every failure as a plain-language meaning plus the next step.

Use it when the user wants to debug or reproduce a problem *locally against a real device*: "debug my app on a real Pixel", "make the device show up in adb", "get logcat from a real device while I reproduce this", "see the device in Xcode", "plug a Kobiton device into my machine", or any mention of "virtualUSB" / "vusb". For exploratory testing through Kobiton's own session CLI, route to `run-interactive-session` instead; for an agent-driven flow that should become a test case, `drive-automation-session`.

## Prerequisites

**Runs on macOS (any architecture) and Windows (x64 under Git Bash) and needs a persistent local filesystem** - it runs a locally cached client binary, reads `~/.kobiton/.credentials`, and hands device access to local `adb` / `xcrun`. Linux hosts are redirected by the preflight (`outcome=redirected (limitation)`): tell the user to use a macOS or Windows machine, or `run-interactive-session` for device access from Linux. See the Skill compatibility matrix in `CLAUDE.md`.

Before the flow can succeed:

- **virtualUSB client** - installed by this skill's own preflight (Step 1), never by the plugin's SessionStart hook or `/automate:setup`, so only users of this skill download it. The plugin pins one client build in `skills/debug-device-over-vusb/VUSB_VERSION`; the preflight fetches that build from `https://public.kobiton.download/virtualusb/<version>/`, verifies its published sha256, and on macOS caches the whole `virtualUSB.app` bundle under `~/.kobiton/vusb/<version>/`. On Windows it caches the verified `.msi` and prints the install steps for the user (UAC, then `vusb setup-adb` in an administrator terminal). The wrapper `~/.kobiton/bin/vusb` (symlink on macOS, exec-shim on Windows) resolves the binary by absolute path - `~/.kobiton/bin` is not on `PATH` and must not be added.
- **Credentials file** - `~/.kobiton/.credentials` with `KOBITON_USER`, `KOBITON_API_KEY`, `KOBITON_PORTAL` in the active profile (`$KOBITON_PROFILE`, default `default`), written by `/automate:setup`. `~/.kobiton/bin/vusb login` reads it and signs the client in with the API key; the key never appears in the transcript.
- **Kobiton MCP connection** - `listDevices({virtualUsb: true, …})` is how vUSB-ready devices are found. MCP tool names below are bare (`listDevices`); the host resolves its registered prefix.
- **Local tooling** - `adb` on `PATH` for Android; Xcode command line tools (`xcrun devicectl`) on macOS for iOS.
- **Account and devices** - an organization with the virtualUSB add-on and at least one *private* device whose host machine has virtualUSB enabled with reachable routing (`virtual_usb_ready: true`). Public cloud devices are never offered.
- **Administrator approval once** - on macOS the first `connect` (and every client version bump) installs the client's background daemon via a GUI administrator dialog; over SSH or without a GUI session this cannot complete. On Windows the `.msi` needs UAC.

## How It Works

Every client call goes through the wrapper at `~/.kobiton/bin/vusb`, which:

- **resolves the binary** - `~/.kobiton/vusb/<pin>/virtualUSB.app/Contents/MacOS/vusb`, else `/Applications/virtualUSB.app/Contents/MacOS/vusb` when its version equals the pin, else the newest cached bundle with a drift warning on stderr; on Windows `C:\Program Files\virtualUSB\vusb.exe`. Nothing is ever looked up through `PATH`;
- **signs in from the credentials file** - `login` without `--apikey` gets `--apibaseurl`, `--username`, `--apikey` injected from `~/.kobiton/.credentials`;
- **passes everything else through verbatim** - the exit code is the client's own.

`vusb connect --udid <udid>` books the device *and* attaches it; there is no separate reservation. `vusb disconnect --udid <udid>` releases it. `vusb status` lists attached devices, but its exit code is not a reliable success signal - always parse its output (shapes in [`references/cli-reference.md`](references/cli-reference.md)).

`$VUSB` is shorthand throughout this document for the literal path `~/.kobiton/bin/vusb` - substitute it in every Bash command; the variable does not persist between calls.

## Conventions

- **Never reserve.** Do not call `reserveDevice` before `connect` (the connect would be refused as already retained) and do not call `terminateReservation` after; `disconnect --udid` is the only release.
- **Always disconnect.** Step 9 runs after every path that reached Step 6, including failures - a device left attached stays booked for the user's organization.
- **Parse `status`, never `$?`.** Connected ⇔ the UDID appears in `status` output with no `Failed` / `error` line; released ⇔ it no longer appears.
- **Never loop on a human step.** The administrator dialog, UAC, and the "Allow USB debugging" prompt are answered by the user; ask once, wait for them to say it is done, then continue. Never re-run the preflight in a loop.
- **Map every failure** through [`references/error-map.md`](references/error-map.md) and report `<meaning> → <next step>`; quote the client's line once, verbatim.
- **Gate before connecting** against [`references/limitations.md`](references/limitations.md).
- **Artifacts** (logcat dumps, screenshots) go under the workspace at `.kobiton/vusb/<udid>/`, created with `bash -c 'mkdir -p .kobiton/vusb/<udid>'` before the first write - never `/tmp`.

## Instructions

### 1. Preflight: make the pinned client available

Resolve `<plugin-root>` (this file is `<plugin-root>/skills/debug-device-over-vusb/SKILL.md`) and run, once:

    bash <plugin-root>/skills/debug-device-over-vusb/scripts/vusb-preflight.sh

Read the `key=value` lines on stdout (contract in [`references/cli-reference.md`](references/cli-reference.md#preflight-keyvalue-contract)); the last line is `outcome=`:

- `no action needed` / `installed` / `updated` → record `vusb=<path>` and continue.
- `handed off to human` → print the script's stderr verbatim (Windows install steps, an older system install, a pruned pin, or offline with no cache) and **STOP**. When the user reports they finished the manual step, run the preflight once more - not before.
- `redirected (limitation)` → print stderr verbatim (Linux or unknown host) and **STOP**; offer `run-interactive-session` for device access from this host.
- Exit code 1 (no `outcome=` line) → print stderr verbatim (checksum mismatch, unverifiable download, unpack failure) and **STOP**. One retry is allowed only if the user asks.

Never re-run the preflight in a loop.

### 2. Credentials

    [ -f ~/.kobiton/.credentials ] && echo OK || echo MISSING

`MISSING` → tell the user to run `/automate:setup` (the wrapper needs the file in Step 5) and **STOP**. `OK` → continue; do not read or print the file's contents.

### 3. Pick a device

Call `listDevices({virtualUsb: true, platform?: "ANDROID" | "IOS", deviceName?})`, narrowing by whatever the user said (platform, model, OS version). The result contains only private devices with `virtual_usb_ready: true`, plus `applied_filters`.

- **Several matches** → ask ONE question listing `device_name`, `platform_version`, `udid`; let the user pick.
- **One match** → confirm `device_name` / `udid` in a single sentence and proceed.
- **Empty** → show the `applied_filters` echo so the user sees what was searched, and offer to check a specific device: `listDevices({virtualUsb: true, udid: "<udid>"})` returns that device flagged even when not ready - apply the not-ready rule below (or relay the top-level `virtual_usb_reason` when the UDID is unknown, public, or outside the user's access) and **STOP**.
- **The user named a UDID** → `listDevices({virtualUsb: true, udid})`.
- **The named or picked device is `virtual_usb_ready: false`** → relay `virtual_usb_reason` ("host machine has virtualUSB disabled or its routing is not reachable yet; check the machine in Portal → Device Management"). If the user is an organization admin or asks why, call `listHostingMachines({udid})` and relay:
  - `sku_note` when present (the organization lacks the virtualUSB add-on);
  - otherwise the machine's `virtual_usb_status.message` and `virtual_usb_status.next_step`, quoting `host_name` when it is non-null so the admin can find the machine in Portal → Device Management (it is null for Kobiton-hosted machines);
  - an empty `machines` list → its `reason`;
  - a permission error ("You don't have permission to do this action.") → "ask an organization admin to check the host machine in Portal → Device Management".

  Then **STOP**, unless the admin rule below applies. Never try `vusb connect` on a not-ready device.
- **Admin, host `DISABLED` or `NO_NETWORK_ROUTE` (or `ROUTING_PROVISIONING_FAILED`, as a retry), no `sku_note`** → offer to configure the host:
  1. Ask which routing: Kobiton-managed (`KOBITON`), or self-managed (`SELF_MANAGED`) with the machine's reachable IP address, which the admin provides - never guess it.
  2. State exactly what will change ("enable virtualUSB on `<host_name>` with <routing>") and get an explicit yes.
  3. Call `configureHostingMachineVirtualUsb({machineId: <the machine's id>, networkRouting, ipAddress?})` and relay the returned `virtual_usb_status.message` and `next_step` (`changed: false` → nothing changed; say so).
  4. `ROUTING_PROVISIONING` → tell the user setup takes a few minutes, then re-check `listHostingMachines({udid})` and `listDevices({virtualUsb: true, udid})` before any connect. `CONFIGURED` and `virtual_usb_ready: true` → continue the flow with this device. Anything else → relay it and **STOP**.

  Never turn virtualUSB off and never switch a machine from Kobiton-managed to self-managed routing (both end active connections - Portal → Device Management only). A permission error → "ask an organization admin"; other errors → [`references/error-map.md`](references/error-map.md), then **STOP**.

Never pass `deviceGroup: "CLOUD"` or `"ALL"` with `virtualUsb: true` - the tool rejects it ("virtualUSB is offered on private devices only"). Record `udid`, `device_name`, `platform_name`, `platform_version`, `is_booked`.

### 4. Limitations gate

Run `uname -s` once and check the picked device against [`references/limitations.md`](references/limitations.md):

- iOS `17.0`–`17.3` → **STOP** with the row's message.
- iOS device on a Windows host (`MINGW*` / `MSYS*` / `CYGWIN*`) → warn that the device is list-only there; **STOP** unless the user only wants it listed.
- `is_booked: true` → **STOP**: "device is in use by another session"; offer another ready device.
- The user's plan needs `adb reverse` (local dev server, hot reload) → warn that `adb reverse` does not pass traffic over virtualUSB; continue only if they accept.

### 5. Login

    $VUSB login

The wrapper injects `--apibaseurl`, `--username`, `--apikey` from `~/.kobiton/.credentials`; nothing sensitive is printed. `Error: Missing KOBITON_…` or `Profile [...] not found` → `/automate:doctor`, then `/automate:setup`, **STOP**. Any `Authentication error` → error-map row, **STOP**. Success → continue.

### 6. Connect

    $VUSB connect --udid <udid>

The client books the device and attaches it; never call `reserveDevice`. On macOS the first connect (and every client version bump) raises one administrator dialog in the user's GUI session - tell the user to approve it, wait for them, and do not re-issue the command until they confirm. Map any `Connect failed:` line through the error map: not signed in (run Step 5 once, retry once), subscription missing (STOP), device already retained / in use (offer another device), host unreachable (VPN / proxy / machine routing, retry once), version mismatch (re-run the preflight). Record the connect time. From here on, Step 9 is mandatory.

### 7. Verify

    $VUSB status

Parse the output (never `$?`): the picked UDID must appear with no `Failed` / `error` line. `Failed to connect to dcb app server` → the daemon is not up yet (dialog pending or refused) - error-map row, then Step 9.

Then confirm the device is visible to local tooling:

- **Android**: `adb devices -l | grep -i <udid>` (the serial normally equals the UDID; if not, take the serial from the matching line). Empty → `adb kill-server`, `sleep 3`, `adb devices -l | grep -i <udid>` once more. Still empty → `$VUSB disconnect --udid <udid>`, then `$VUSB connect --udid <udid>` once, re-check once. Still empty → error map, go to Step 9. `unauthorized` → ask the user to accept the USB-debugging prompt on the device (Portal live view), re-check once.
- **iOS** (macOS only): `xcrun devicectl list devices` must show the device; note its identifier for the `--device` flag. Not listed → give it up to 30 s (`sleep 10`, re-check, at most three times), then error map, Step 9.

### 8. Debug loop

Work from the user's description of the problem. Create the artifact directory first: `bash -c 'mkdir -p .kobiton/vusb/<udid>'`.

- **Android** (`<serial>` from Step 7):
  - install: `adb -s <serial> install -r <path-to-apk>`
  - clear logs: `adb -s <serial> logcat -c`
  - launch / reproduce: `adb -s <serial> shell am start -n <package>/<activity>` (or `monkey -p <package> 1` for the default activity), `adb -s <serial> shell input tap <x> <y>`, `input text <...>`, `input keyevent <KEY>` as the user's steps require; ask the user to perform any step you cannot script and to tell you when done.
  - capture: `adb -s <serial> logcat -d -v time > .kobiton/vusb/<udid>/logcat-<timestamp>.txt`; filter by package or tag with `grep` when reporting (`grep -i <package> .kobiton/vusb/<udid>/logcat-<timestamp>.txt | tail -200`).
  - screenshot: `adb -s <serial> exec-out screencap -p > .kobiton/vusb/<udid>/screen-<timestamp>.png`, then `Read` the file to look at it.
  - crash triage: look for `FATAL EXCEPTION`, `AndroidRuntime`, `ANR in`, the app's own tags; quote the first stack frame inside the app's package.
- **iOS** (macOS only, manual-assist): `xcrun devicectl device install app --device <id> <path-to-ipa-or-app>`, `xcrun devicectl device process launch --device <id> <bundle-id>`; logs via `log stream --device <id> --predicate 'process == "<AppName>"' | head -500` or Console.app / Xcode, which the user drives. Screenshots via Xcode's Devices window.

Report findings as you go: what was reproduced, the relevant log excerpt (trimmed), and each artifact path. Bound long-running captures with `timeout`.

### 9. Teardown (always - after success and after any failure from Step 6 onward)

    $VUSB disconnect --udid <udid>
    $VUSB status

`status` must no longer list the UDID (parse the output). Then confirm the platform released the device: `listDevices({virtualUsb: true, udid: "<udid>", available: false})`, polled with `sleep 10` for up to 60 s until `is_online === true && is_booked === false`. Report if it did not release within that window - never call `terminateReservation`. Record the disconnect time.

### 10. Error handling and summary

Every failure surfaces as `<plain-language meaning> → <next step>` from [`references/error-map.md`](references/error-map.md); quote the client's line once. Then give a summary:

- device (`device_name`, `platform_name` `platform_version`, `udid`), connect and disconnect times
- what was installed / reproduced, and the finding (with the trimmed log excerpt)
- artifact paths under `.kobiton/vusb/<udid>/`
- whether the device was confirmed released (`status` clean and `is_booked: false`), or the exact state it was left in

## Error Handling

- **`Authorization info not found. Please login to your Kobiton's account first!`** - not signed in: `$VUSB login` once, retry the failed command once.
- **`virtualUSB is not included in your current subscription`** - the organization has no virtualUSB add-on; stop and name the org admin as the next step. For an admin, Step 3 surfaces this before any connect as the `sku_note` from `listHostingMachines`.
- **`Failed to connect to dcb app server`** - the daemon is not running: on macOS the first `connect` installs it via the administrator dialog (ask the user to approve it; do not loop); on Windows `vusb setup-adb` in an administrator terminal. Over SSH it cannot be installed - hand off.
- **Already retained / in use** - another session holds the device: pick another ready device or ask the holder / a Portal admin to release it. Do not wait on it.
- **Host unreachable / timeout** - VPN or proxy on this machine, or the device's host machine routing (Portal → Device Management); one retry after the network changes.
- **Installed version ≠ pin** (wrapper drift warning) - re-run the preflight; relay `handed off to human` messages (system install at another version, pruned pin → update the automate plugin).
- **iOS device on a Windows host** - list-only; redirect to a macOS host.
- **Connected but `adb devices` empty** - `adb kill-server` and re-check once, then disconnect + connect once, then report.
- **Preflight exit 1** - checksum mismatch / unverifiable download / unpack failure; the existing cache is untouched; one retry only if the user asks, otherwise report it on the plugin repository.
- **Preflight `redirected (limitation)`** - Linux or unknown host; offer `run-interactive-session` from this host or a macOS / Windows machine.
- **Missing credentials** - `/automate:doctor`, then `/automate:setup`.

## Examples

### Example 1: reproduce a crash on a real Android device

> "My app crashes when I open the cart on a real Samsung. Debug it on a Kobiton device - the build is ./app/build/outputs/apk/debug/app-debug.apk."

1. Preflight → `outcome=no action needed` (client cached at the pin). Credentials file present.
2. `listDevices({virtualUsb: true, platform: "ANDROID", deviceName: "*Galaxy*"})` → one ready device, Galaxy S23 / Android 14 / `R5CT1234ABC`; confirm it.
3. Gate: macOS host, Android, `is_booked: false` → proceed.
4. `~/.kobiton/bin/vusb login`, then `~/.kobiton/bin/vusb connect --udid R5CT1234ABC`; the user approves the administrator dialog.
5. `~/.kobiton/bin/vusb status` lists `R5CT1234ABC`; `adb devices -l | grep -i R5CT1234ABC` shows it as `device`.
6. `adb -s R5CT1234ABC install -r ./app/build/outputs/apk/debug/app-debug.apk`, `logcat -c`, launch the app, ask the user to open the cart, `logcat -d -v time > .kobiton/vusb/R5CT1234ABC/logcat-<ts>.txt`, `grep -n "FATAL EXCEPTION" -A 30` → quote the `NullPointerException` in `CartFragment.onViewCreated`.
7. `~/.kobiton/bin/vusb disconnect --udid R5CT1234ABC`; `status` no longer lists it; `listDevices({virtualUsb: true, udid: "R5CT1234ABC", available: false})` → `is_booked: false`.
8. Summary: device, times, the stack trace excerpt, the logcat path, released = yes.

### Example 2: the pick is not ready

> "Connect the Pixel 8 with UDID 3A091FDJH00042 over vusb."

`listDevices({virtualUsb: true, udid: "3A091FDJH00042"})` → `virtual_usb_ready: false`, `virtual_usb_reason: "host machine has virtualUSB disabled or its routing is not reachable yet; check the machine in Portal → Device Management"`. Relay it. The user is an organization admin, so call `listHostingMachines({udid: "3A091FDJH00042"})` → `sku_active: true`, one machine `{id: 12, host_name: "lab-mac-07", virtual_usb: {enabled: false, …}, virtual_usb_status: {state: "DISABLED", message: "virtualUSB is turned off on this machine.", next_step: "Enable virtualUSB for the machine in Portal → Device Management."}}`. Relay: "virtualUSB is turned off on this device's host machine (`lab-mac-07`)." Offer to enable it; the admin picks Kobiton-managed routing and confirms "enable virtualUSB on `lab-mac-07` with Kobiton-managed routing". Call `configureHostingMachineVirtualUsb({machineId: 12, networkRouting: "KOBITON"})` → `changed: true`, `virtual_usb_status.state: "ROUTING_PROVISIONING"`; relay its `message` and `next_step`, wait a few minutes, re-check `listHostingMachines({udid})` → `CONFIGURED`, then `listDevices({virtualUsb: true, udid})` → `virtual_usb_ready: true`, and continue from Step 4. If the admin declines, stop. A non-admin gets the permission error "You don't have permission to do this action." instead - relay "ask an organization admin to check the host machine in Portal → Device Management", do not attempt `vusb connect`, offer `listDevices({virtualUsb: true, platform: "ANDROID"})` for a ready alternative, and stop - nothing was connected, so no teardown.
