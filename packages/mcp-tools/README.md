# @kobiton/mcp-tools

The tool catalog served by the Kobiton MCP server at `https://api.kobiton.com/mcp`: every tool's name, title, description, annotations and input schema, in one YAML file.
The file is built from this repository's `tools/*.yaml` when the package is packed, so `tools/` stays the single source of truth.

## Contents

`tool-definitions.yaml` has the shape `{files: [{domain, tools: [...]}]}`, one entry per `tools/*.yaml` file in file-name order.

The package has no JavaScript entry point and no dependencies.
Resolve the file by path:

```js
const {readFileSync} = require('node:fs')

const catalog = readFileSync(require.resolve('@kobiton/mcp-tools/tool-definitions.yaml'), 'utf8')
const {version} = require('@kobiton/mcp-tools/package.json')
```

## Versions and dist-tags

| Version | dist-tag | Published from |
|---|---|---|
| `X.Y.Z` | `latest` | `main` only |
| `X.Y.Z-<channel>.N` (for example `X.Y.Z-beta.N`) | `<channel>` | any branch, by running the publish workflow manually |

Consumers pin an exact version.
Pre-release versions are for testing a catalog change before it merges.

## Releasing

1. Bump `version` in `packages/mcp-tools/package.json` in the same pull request as any change under `tools/`; CI fails a `tools/` change without a version bump.
2. After the pull request merges to `main`, the `Publish MCP tools` workflow publishes the new version through npm trusted publishing.
   A push that leaves the version unchanged publishes nothing.
3. For a pre-release, set a `X.Y.Z-<channel>.N` version on your branch and run the workflow manually on that branch.
