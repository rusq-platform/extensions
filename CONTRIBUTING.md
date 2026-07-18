# Contributing to Rusq Extension Registry

Thank you for your interest in contributing to the Rusq extension registry.

## Adding a New Extension

Every new registry entry must provide the following information:

### Required Information

1. **Upstream Repository**: The URL of the extension's git repository
2. **Immutable Revision**: A specific git commit hash that Rusq will pin to
3. **Extension.toml Location**: The path to the extension manifest within the repository
4. **SPDX License**: A valid [SPDX license identifier](https://spdx.org/licenses/) or expression
5. **Distribution Mode**: How Rusq will distribute the extension:
   - `source` - Source code only
   - `binary` - Pre-built binaries only
   - `source-and-binary` - Both source and binaries
6. **Dependency Notes**: Any special dependencies or build requirements

### Status Lifecycle

1. **`candidate`**: Initial entry, license unreviewed, may use `NOASSERTION`
2. **`verified`**: Reviewed for license, API compatibility, build, and distribution
3. **`external`**: Rusq does not build/distribute, but acknowledges the extension
4. **`blocked`**: Known incompatible or problematic extensions

### Process

1. Fork this registry repository
2. Add an entry to `rusq-extensions.toml` with your extension's upstream information
3. Set `status = "candidate"` and `license = "NOASSERTION"` initially
4. Submit a pull request

The Rusq team will review your submission and update the status to `verified` once all checks pass.

## Guidelines

- Adding a registry entry does **not** transfer ownership of upstream code
- Extensions must be compatible with Rusq's extension API
- GPL-licensed extensions are supported but may have distribution restrictions
- Binary distribution requires source revision tracking
- All entries must reference immutable upstream commits

## Questions?

Open an issue in this repository for questions about the registry or contribution process.
