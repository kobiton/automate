# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this plugin, please report it responsibly. **Do not open a public GitHub issue.**

Email: [security@kobiton.com](mailto:security@kobiton.com)

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a detailed response within 5 business days, including next steps and timeline for a fix.

## Scope

This policy covers the plugin code in this repository:
- Tool schemas (`tools/*.yaml`)
- Skill definitions (`skills/`)
- Plugin manifests (`.claude-plugin/`, `.cursor-plugin/`)
- Validation scripts (`scripts/`)
- MCP configuration (`.mcp.json`)

For vulnerabilities in the Kobiton platform itself (API, portal, device infrastructure), report directly to Kobiton's security team via the [Kobiton Trust Center](https://kobiton.com/trust-center/).

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |
| < 1.0   | No        |
