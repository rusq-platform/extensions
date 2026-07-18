# Rusq Extension Registry Schema

This document describes the two-layer schema used by the Rusq extension registry.

## Layer 1: Upstream Source References

### extensions.toml

Upstream-compatible extension registry format. Each entry contains:

```toml
[extension-id]
submodule = "extensions/<repo>"
version = "1.0.0"
description = "Extension description"
```

For shared repositories:

```toml
[extension-id]
submodule = "extensions/zed"
path = "extensions/<subdir>"
version = "1.0.0"
description = "Extension description"
```

### .gitmodules

Git submodule metadata. It contains repository URLs and paths, but not the
pinned commit itself. The pinned commit is stored by Git in the parent
repository tree as a `160000` Gitlink entry.

## Layer 2: Rusq Policy Layer

### rusq-extensions.toml

Rusq-owned policy file defining whether Rusq may build or distribute an extension.

#### Schema

```toml
[extension-id]
status = "candidate" | "upstream-verified" | "verified" | "external" | "blocked"
distribution = "source" | "binary" | "source-and-binary"
license = "SPDX-ID" | "SPDX-expression" | "NOASSERTION"
source_revision = "40-char-hex-commit"
api_versions = ["rusq:0.1", ...]  # optional for candidate
platforms = ["macos-aarch64", "macos-x86_64", "linux-x86_64"]  # optional for candidate
reviewed_at = "YYYY-MM-DD"  # required for upstream-verified, verified, external, blocked
```

#### Required Fields

| Field | Type | Required For | Description |
|-------|------|--------------|-------------|
| `status` | enum | all | Review status |
| `distribution` | enum | all | Distribution mode |
| `license` | SPDX | all | License identifier or expression |
| `source_revision` | string | all | Immutable upstream commit (40-char hex) |
| `api_versions` | array | upstream-verified, verified | Supported Rusq API versions |
| `platforms` | array | upstream-verified, verified | Supported build targets |
| `reviewed_at` | date | upstream-verified, verified, external, blocked | Date of last review |

#### Status Values

| Status | Description |
|--------|-------------|
| `candidate` | Initial entry, unreviewed. May use `NOASSERTION` for license. |
| `upstream-verified` | Present in the upstream registry and exposed for Rusq development/indexing, but not locally reviewed by Rusq. May use `NOASSERTION` for license. |
| `verified` | Reviewed for license, API compatibility, build, and distribution. |
| `external` | Rusq acknowledges but does not build/distribute. |
| `blocked` | Known incompatible or problematic. |

#### Distribution Values

| Value | Description |
|-------|-------------|
| `source` | Source code distribution only |
| `binary` | Pre-built binary distribution only |
| `source-and-binary` | Both source and binary distribution |

#### Supported SPDX Licenses

Initial supported licenses:

- `MIT`
- `Apache-2.0`
- `BSD-2-Clause`
- `BSD-3-Clause`
- `ISC`
- `Zlib`
- `0BSD`
- `GPL-3.0-only`
- `GPL-3.0-or-later`
- `LGPL-3.0-only`
- `LGPL-3.0-or-later`

SPDX expressions are supported (e.g., `MIT OR Apache-2.0`).

#### Example Entry

```toml
[catppuccin]
status = "verified"
distribution = "source"
license = "MIT"
source_revision = "b54cb81708d06912d50e6bb9fd2fd2103b9dda25"
api_versions = ["rusq:0.1"]
platforms = ["macos-aarch64", "macos-x86_64", "linux-x86_64"]
reviewed_at = "2026-07-18"
```

## Source Layout Variants

### Dedicated Repository

```toml
[catppuccin]
submodule = "extensions/catppuccin"
version = "1.0.0"
```

Submodule path: `extensions/<extension-id>`

### Shared Repository with Path

```toml
[html]
submodule = "extensions/zed"
path = "extensions/html"
version = "0.1.0"
```

The `path` field is required when the extension is not at the default location. Valid shared repositories include:
- `extensions/zed` (for `html`, `glsl`, `proto`, etc.)

## Import Tool

The `tools/import-upstream.mjs` tool imports extension metadata from upstream:

```bash
node tools/import-upstream.mjs \
  --source /path/to/source-registry \
  --output /path/to/extensions \
  --ids catppuccin,html
```

Import creates `candidate` entries with `NOASSERTION` license unless `--force` is used to overwrite existing entries.

**Note:** Importing a candidate is not the same as publishing a verified extension.
The importer reads the Gitlink from the source repository's `HEAD`; it does
not infer a revision from an initialized working-tree directory.

## Audit Tool

The `tools/audit-extension.mjs` tool emits a static report for one extension:

```bash
node tools/audit-extension.mjs catppuccin \
  --source /path/to/source-registry
```

The report checks registry presence, policy presence, submodule metadata,
license syntax, `source_revision` format, and upstream Gitlink consistency
when `--source` is provided. It does not clone source repositories, build
`extension.wasm`, scan dependency licenses, or change policy status.
