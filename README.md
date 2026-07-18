# Rusq Extension Registry

This repository is Rusq's official extension index for the Rusq editor. It serves as the authoritative registry of extensions that Rusq may build, distribute, or reference.

## Architecture

The registry uses a two-layer architecture:

### Layer 1: Upstream Source References (imported)

The files `extensions.toml` and `.gitmodules` are imported from upstream (`zed-industries/extensions`). They provide:

- Extension metadata (ID, version, description)
- Git repository URLs for extension sources
- Gitlink references (immutable upstream commits stored in the parent Git tree)

**These files are source-reference data only.** Rusq does not read
`zed-industries/extensions` at runtime.

### Layer 2: Rusq Policy Layer (Rusq-owned)

The file `rusq-extensions.toml` is Rusq's policy layer. It defines:

- Whether Rusq may build or distribute an extension
- Review status and distribution mode
- License approval and API compatibility
- Supported platforms

This file is the only registry file that controls Rusq's extension policy.
An upstream entry is not automatically authorized for Rusq use; at the
current bootstrap stage, only extensions with a corresponding policy entry
have a Rusq decision.

## Source Layout Variants

The imported upstream registry supports two source layout variants:

### 1. Dedicated Repository

Each extension has its own repository:

```toml
[catppuccin]
submodule = "extensions/catppuccin"
version = "1.0.0"
```

The submodule path is `extensions/<extension-id>`.

### 2. Shared Repository with Path

Multiple extensions share one repository:

```toml
[html]
submodule = "extensions/zed"
path = "extensions/html"
version = "0.1.0"
```

The `path` field specifies the subdirectory within the shared repository. This is valid for `html`, `glsl`, `proto`, and other extensions bundled in the Zed repository.

**Note:** A submodule count lower than the extension count is expected and valid when multiple entries share one submodule.

## No Mirroring

This registry does not download or mirror extension source code. Upstream repositories remain the authoritative source of extension code. Adding an entry to this registry does not transfer ownership of upstream code.

## Quick Start

```bash
# Validate the registry
npm run validate

# Run tests
npm test
```
