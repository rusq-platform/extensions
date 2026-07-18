#!/usr/bin/env node

/**
 * Import Upstream Extensions Tool
 *
 * Imports extension metadata from an upstream registry into the Rusq registry.
 * This tool:
 * - Does NOT access the upstream registry over the network
 * - Does NOT initialize submodules
 * - Creates candidate entries in rusq-extensions.toml
 */

import { parseArgs } from 'util';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { execFileSync } from 'child_process';
import toml from '@iarna/toml';
import { parseGitmodules } from './lib/gitmodules.mjs';

const { parse: parseToml } = toml;

// Parse command line arguments
const { values: args } = parseArgs({
  options: {
    source: { type: 'string', short: 's' },
    output: { type: 'string', short: 'o' },
    ids: { type: 'string', short: 'i' },
    force: { type: 'boolean', short: 'f', default: false },
  },
});

// Validate required arguments
if (!args.source || !args.output) {
  console.error('Error: --source and --output are required');
  console.error('Usage: node import-upstream.mjs --source <path> --output <path> --ids <comma-separated-ids>');
  process.exit(1);
}

const sourceDir = resolve(args.source);
const outputDir = resolve(args.output);
const extensionIds = args.ids ? args.ids.split(',').map(id => id.trim()) : null;
const force = args.force || false;

// Validate directories
if (!existsSync(sourceDir)) {
  console.error(`Error: Source directory does not exist: ${sourceDir}`);
  process.exit(1);
}

if (!existsSync(`${sourceDir}/extensions.toml`)) {
  console.error(`Error: Source directory must contain extensions.toml`);
  process.exit(1);
}

if (!existsSync(`${sourceDir}/.gitmodules`)) {
  console.error(`Error: Source directory must contain .gitmodules`);
  process.exit(1);
}

if (!existsSync(outputDir)) {
  console.error(`Error: Output directory does not exist: ${outputDir}`);
  process.exit(1);
}

/**
 * Get gitlink commit for a submodule from the source git index
 */
function getGitlinkCommit(sourceDir, submoduleName) {
  try {
    // Gitlinks are entries in the parent tree, not trees that can be traversed.
    const output = execFileSync(
      'git',
      ['ls-tree', 'HEAD', '--', submoduleName],
      { cwd: sourceDir, encoding: 'utf-8' },
    ).trim();

    const match = output.match(/^160000 commit ([a-f0-9]{40})\s+/);
    if (match) {
      return match[1];
    }
  } catch (error) {
    // The source may not contain a committed gitlink for this submodule.
  }
  return null;
}

/**
 * Load existing rusq-extensions.toml if it exists
 */
function loadExistingPolicy(outputDir) {
  const policyPath = `${outputDir}/rusq-extensions.toml`;
  if (existsSync(policyPath)) {
    const content = readFileSync(policyPath, 'utf-8');
    return parseToml(content);
  }
  return {};
}

/**
 * Save rusq-extensions.toml with deterministic output
 */
function savePolicy(outputDir, policy) {
  const policyPath = `${outputDir}/rusq-extensions.toml`;
  const tomlString = toml.stringify(policy);
  writeFileSync(policyPath, tomlString, 'utf-8');
}

/**
 * Create a candidate entry for an extension
 */
function createCandidateEntry(entry, sourceRevision) {
  return {
    status: 'candidate',
    distribution: 'source',
    license: 'NOASSERTION',
    source_revision: sourceRevision,
  };
}

// Main import logic
console.log(`Importing from: ${sourceDir}`);
console.log(`Output to: ${outputDir}`);
if (extensionIds) {
  console.log(`Extension IDs: ${extensionIds.join(', ')}`);
}
console.log(`Force mode: ${force}`);
console.log('');

// Load source data
const sourceExtensionsToml = readFileSync(`${sourceDir}/extensions.toml`, 'utf-8');
const sourceGitmodules = readFileSync(`${sourceDir}/.gitmodules`, 'utf-8');

const sourceExtensions = parseToml(sourceExtensionsToml);
const sourceSubmodules = parseGitmodules(sourceGitmodules);

// Load existing policy
const existingPolicy = loadExistingPolicy(outputDir);

// Determine which extensions to import
const extensionsToImport = extensionIds || Object.keys(sourceExtensions);
let imported = 0;
let skipped = 0;
let errors = 0;

for (const extId of extensionsToImport) {
  if (!(extId in sourceExtensions)) {
    console.error(`Error: Extension '${extId}' not found in source extensions.toml`);
    errors++;
    continue;
  }

  const extEntry = sourceExtensions[extId];
  const submoduleName = extEntry.submodule;

  if (!submoduleName) {
    console.error(`Error: Extension '${extId}' has no submodule reference`);
    errors++;
    continue;
  }

  if (!sourceSubmodules.has(submoduleName)) {
    console.error(
      `Error: Extension '${extId}' references '${submoduleName}', which is not in .gitmodules`,
    );
    errors++;
    continue;
  }

  // Get source revision from gitlink
  const sourceRevision = getGitlinkCommit(sourceDir, submoduleName);

  if (!sourceRevision) {
    console.error(`Error: Could not resolve gitlink for '${submoduleName}'`);
    errors++;
    continue;
  }

  // Check if entry already exists and should be preserved
  if (!force && existingPolicy[extId]) {
    const existing = existingPolicy[extId];
    if (existing.status === 'verified' || existing.status === 'external' || existing.status === 'blocked') {
      console.log(`Skipping '${extId}': already reviewed (${existing.status})`);
      skipped++;
      continue;
    }
    if (existing.source_revision === sourceRevision) {
      console.log(`Skipping '${extId}': revision unchanged`);
      skipped++;
      continue;
    }
  }

  // Create or update entry
  const newEntry = createCandidateEntry(extEntry, sourceRevision);

  // Preserve existing review fields if they exist
  if (!force && existingPolicy[extId]) {
    const existing = existingPolicy[extId];
    if (existing.distribution) newEntry.distribution = existing.distribution;
    if (existing.license && existing.license !== 'NOASSERTION') {
      newEntry.license = existing.license;
      newEntry.status = existing.status || 'candidate';
    }
    if (existing.api_versions) newEntry.api_versions = existing.api_versions;
    if (existing.platforms) newEntry.platforms = existing.platforms;
    if (existing.reviewed_at) newEntry.reviewed_at = existing.reviewed_at;
  }

  existingPolicy[extId] = newEntry;
  console.log(`Imported '${extId}' at ${sourceRevision.slice(0, 12)}`);
  imported++;
}

// Save the updated policy
savePolicy(outputDir, existingPolicy);

console.log('');
console.log(`Summary:`);
console.log(`  Imported: ${imported}`);
console.log(`  Skipped: ${skipped}`);
console.log(`  Errors: ${errors}`);
console.log('');
console.log(`Updated: ${outputDir}/rusq-extensions.toml`);

if (errors > 0) {
  process.exitCode = 1;
}
