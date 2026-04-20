# Kobiton Automate

This plugin connects to the Kobiton mobile testing platform via MCP. It provides tools for managing devices, apps, and test sessions.

## Available Tools

Use these MCP tools for device, session, and app management:

- **Devices:** `listDevices`, `getDeviceStatus`, `reserveDevice`, `terminateReservation`
- **Sessions:** `listSessions`, `getSession`, `getSessionArtifacts`, `terminateSession`
- **Apps:** `listApps`, `getApp`, `uploadAppToStore`, `confirmAppUpload`

## Running Automation Tests

Use the **run-automation-suite** skill for guided test execution. It walks through app upload, device selection, Appium script parsing, and local execution with result collection.

## Authentication

Authentication is handled by the MCP server. Connect to the `kobiton` MCP server to authenticate via OAuth or API key.
