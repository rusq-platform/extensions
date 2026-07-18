/**
 * Registry Validator
 *
 * Validates the Rusq extension registry including:
 * - Upstream index validation (extensions.toml + .gitmodules)
 * - Policy validation (rusq-extensions.toml)
 */

import { readFileSync } from 'fs';
import toml from '@iarna/toml';
const { parse: parseTomlString } = toml;
import { parseGitmodules } from './gitmodules.mjs';
import { validateLicense } from './licenses.mjs';

// Allowed status values
const STATUS_VALUES = new Set(['candidate', 'upstream-verified', 'verified', 'external', 'blocked']);
const RUSQ_METADATA_STATUSES = new Set(['upstream-verified', 'verified']);

// Allowed distribution values
const DISTRIBUTION_VALUES = new Set(['source', 'binary', 'source-and-binary']);

// Valid shared submodule repositories
const VALID_SHARED_SUBMODULES = new Set(['extensions/zed']);

// Git revision pattern (40 hex characters)
const REVISION_PATTERN = /^[a-f0-9]{40}$/;

// Date pattern (YYYY-MM-DD)
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// API versions are Rusq host compatibility markers.
const API_VERSION_PATTERN = /^rusq:\d+\.\d+$/;

/**
 * Validate an upstream extensions.toml entry.
 * @param {string} extensionId
 * @param {object} entry
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateUpstreamEntry(extensionId, entry) {
  const errors = [];

  if (!entry.submodule) {
    errors.push(`[${extensionId}] missing 'submodule'`);
  }

  if (!entry.version) {
    errors.push(`[${extensionId}] missing 'version'`);
  }

  // Check for dedicated vs shared submodule pattern
  if (entry.submodule) {
    if (entry.submodule === 'extensions/zed') {
      // Shared submodule: requires path
      if (!entry.path) {
        errors.push(`[${extensionId}] shared submodule requires 'path' field`);
      } else if (!entry.path.startsWith('extensions/')) {
        errors.push(`[${extensionId}] shared submodule path must start with 'extensions/'`);
      }
    }
    // For dedicated submodules, path is optional and can be anything
    // (some dedicated repos have subdirectories like "rlsp-yaml/integrations/zed")
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate all upstream entries.
 * @param {Map} extensions - Parsed extensions.toml
 * @param {Map} submodules - Parsed .gitmodules
 * @param {boolean} requireSubmodules - Whether to require submodule existence
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateUpstreamIndex(extensions, submodules, requireSubmodules = true) {
  const errors = [];
  const seenIds = new Set();

  for (const [extensionId, entry] of extensions) {
    // Check for duplicate IDs
    if (seenIds.has(extensionId)) {
      errors.push(`Duplicate extension ID: ${extensionId}`);
    }
    seenIds.add(extensionId);

    // Validate entry
    const entryResult = validateUpstreamEntry(extensionId, entry);
    errors.push(...entryResult.errors);

    // Check submodule exists in .gitmodules
    if (entry.submodule) {
      const submoduleInGitmodules = submodules.has(entry.submodule);

      if (requireSubmodules && !submoduleInGitmodules) {
        errors.push(`[${extensionId}] submodule '${entry.submodule}' not found in .gitmodules`);
      }

      // Check HTTPS URL (only if submodule is defined in .gitmodules)
      const submodule = submodules.get(entry.submodule);
      if (submodule) {
        if (submodule.path !== entry.submodule) {
          errors.push(
            `[${extensionId}] submodule path '${submodule.path}' does not match '${entry.submodule}'`,
          );
        }
        if (submodule.url && !submodule.url.startsWith('https://')) {
          errors.push(`[${extensionId}] submodule URL must use HTTPS: ${submodule.url}`);
        }
        if (
          entry.submodule !== `extensions/${extensionId}` &&
          !VALID_SHARED_SUBMODULES.has(entry.submodule)
        ) {
          errors.push(
            `[${extensionId}] dedicated submodule must be 'extensions/${extensionId}'`,
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a rusq-extensions.toml entry.
 * @param {string} extensionId
 * @param {object} entry
 * @param {boolean} existsInUpstream
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePolicyEntry(extensionId, entry, existsInUpstream) {
  const errors = [];

  // Policy entries must exist in upstream
  if (!existsInUpstream) {
    errors.push(`[${extensionId}] policy entry not present in extensions.toml`);
    return { valid: false, errors };
  }

  // Validate status
  if (!entry.status) {
    errors.push(`[${extensionId}] missing 'status'`);
  } else if (!STATUS_VALUES.has(entry.status)) {
    errors.push(`[${extensionId}] unsupported status: ${entry.status}`);
  }

  // Validate distribution
  if (!entry.distribution) {
    errors.push(`[${extensionId}] missing 'distribution'`);
  } else if (!DISTRIBUTION_VALUES.has(entry.distribution)) {
    errors.push(`[${extensionId}] unsupported distribution: ${entry.distribution}`);
  }

  // Validate license
  if (!entry.license) {
    errors.push(`[${extensionId}] missing 'license'`);
  } else {
    const licenseResult = validateLicense(entry.license);
    if (!licenseResult.valid) {
      errors.push(`[${extensionId}] ${licenseResult.error}`);
    }

    // NOASSERTION is allowed while Rusq local license review is still pending.
    if (
      entry.license === 'NOASSERTION' &&
      entry.status &&
      !['candidate', 'upstream-verified'].includes(entry.status)
    ) {
      errors.push(
        `[${extensionId}] NOASSERTION license only allowed for 'candidate' or 'upstream-verified' status`,
      );
    }
  }

  // Validate source_revision
  if (!entry.source_revision) {
    errors.push(`[${extensionId}] missing 'source_revision'`);
  } else {
    if (!REVISION_PATTERN.test(entry.source_revision)) {
      errors.push(`[${extensionId}] source_revision must be 40 lowercase hex characters`);
    }
  }

  // Validate reviewed_at for non-candidate status
  if (entry.status && entry.status !== 'candidate') {
    if (!entry.reviewed_at) {
      errors.push(`[${extensionId}] 'reviewed_at' required for '${entry.status}' status`);
    } else if (!DATE_PATTERN.test(entry.reviewed_at)) {
      errors.push(`[${extensionId}] reviewed_at must be in YYYY-MM-DD format`);
    }
  }

  // Validate api_versions for statuses exposed to Rusq host compatibility checks.
  if (RUSQ_METADATA_STATUSES.has(entry.status)) {
    if (!entry.api_versions || !Array.isArray(entry.api_versions) || entry.api_versions.length === 0) {
      errors.push(`[${extensionId}] 'api_versions' required for '${entry.status}' status`);
    } else {
      for (const apiVersion of entry.api_versions) {
        if (typeof apiVersion !== 'string' || !API_VERSION_PATTERN.test(apiVersion)) {
          errors.push(
            `[${extensionId}] api_versions must use Rusq host versions like 'rusq:0.1'`,
          );
        }
      }
    }
  }

  // Validate platforms for statuses exposed to Rusq host compatibility checks.
  if (RUSQ_METADATA_STATUSES.has(entry.status)) {
    if (!entry.platforms || !Array.isArray(entry.platforms) || entry.platforms.length === 0) {
      errors.push(`[${extensionId}] 'platforms' required for '${entry.status}' status`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate all policy entries.
 * @param {Map} policyEntries - Parsed rusq-extensions.toml
 * @param {Set} upstreamIds - Set of extension IDs from extensions.toml
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePolicy(policyEntries, upstreamIds) {
  const errors = [];

  for (const [extensionId, entry] of policyEntries) {
    const existsInUpstream = upstreamIds.has(extensionId);
    const entryResult = validatePolicyEntry(extensionId, entry, existsInUpstream);
    errors.push(...entryResult.errors);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate the entire registry.
 * @param {string} registryDir - Path to registry directory
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateRegistry(registryDir) {
  const errors = [];

  // Load and parse upstream data
  let extensions;
  let submodules;
  let policyEntries;

  try {
    const extensionsContent = readFileSync(`${registryDir}/extensions.toml`, 'utf-8');
    extensions = parseTomlString(extensionsContent);
  } catch (e) {
    return { valid: false, errors: [`Failed to parse extensions.toml: ${e.message}`] };
  }

  try {
    const gitmodulesContent = readFileSync(`${registryDir}/.gitmodules`, 'utf-8');
    submodules = parseGitmodules(gitmodulesContent);
  } catch (e) {
    return { valid: false, errors: [`Failed to parse .gitmodules: ${e.message}`] };
  }

  try {
    const policyContent = readFileSync(`${registryDir}/rusq-extensions.toml`, 'utf-8');
    policyEntries = parseTomlString(policyContent);
  } catch (e) {
    return { valid: false, errors: [`Failed to parse rusq-extensions.toml: ${e.message}`] };
  }

  // Validate upstream index
  const extensionsMap = new Map(Object.entries(extensions));
  const upstreamResult = validateUpstreamIndex(extensionsMap, submodules);
  errors.push(...upstreamResult.errors);

  // Validate policy
  const upstreamIds = new Set(extensionsMap.keys());
  const policyMap = new Map(Object.entries(policyEntries));
  const policyResult = validatePolicy(policyMap, upstreamIds);
  errors.push(...policyResult.errors);

  return { valid: errors.length === 0, errors };
}
