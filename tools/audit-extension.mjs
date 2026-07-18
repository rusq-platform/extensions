#!/usr/bin/env node

/**
 * Audit a single Rusq extension registry entry.
 *
 * This is a static report tool. It does not clone sources, build WASM, or
 * update rusq-extensions.toml.
 */

import { parseArgs } from 'util';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';
import toml from '@iarna/toml';
import { parseGitmodules } from './lib/gitmodules.mjs';
import { validateLicense } from './lib/licenses.mjs';

const { parse: parseToml } = toml;

function usage() {
  return [
    'Usage: node tools/audit-extension.mjs <extension-id> [options]',
    '',
    'Options:',
    '  --registry <dir>  Rusq registry directory (default: current directory)',
    '  --source <dir>    Source registry checkout with committed Gitlinks',
    '  --json            Emit JSON instead of text',
    '  --help            Show this help',
  ].join('\n');
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    registry: { type: 'string', short: 'r' },
    source: { type: 'string', short: 's' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(usage());
  process.exit(0);
}

const extensionId = positionals[0];
if (!extensionId) {
  console.error('Error: extension id is required');
  console.error(usage());
  process.exit(1);
}

const registryDir = resolve(values.registry || process.cwd());
const sourceDir = values.source ? resolve(values.source) : null;

function readTomlFile(dir, filename) {
  const path = `${dir}/${filename}`;
  if (!existsSync(path)) {
    throw new Error(`${filename} not found in ${dir}`);
  }
  return parseToml(readFileSync(path, 'utf-8'));
}

function readGitmodules(dir) {
  const path = `${dir}/.gitmodules`;
  if (!existsSync(path)) {
    throw new Error(`.gitmodules not found in ${dir}`);
  }
  return parseGitmodules(readFileSync(path, 'utf-8'));
}

function getGitlinkCommit(dir, submoduleName) {
  try {
    const output = execFileSync(
      'git',
      ['ls-tree', 'HEAD', '--', submoduleName],
      { cwd: dir, encoding: 'utf-8' },
    ).trim();
    return output.match(/^160000 commit ([a-f0-9]{40})\s+/)?.[1] || null;
  } catch (error) {
    return null;
  }
}

function add(checks, level, message, details = {}) {
  checks.push({ level, message, ...details });
}

function auditExtension({ extensionId, registryDir, sourceDir }) {
  const checks = [];
  let extensions = {};
  let policy = {};
  let submodules = new Map();

  try {
    extensions = readTomlFile(registryDir, 'extensions.toml');
    add(checks, 'pass', 'extensions.toml loaded');
  } catch (error) {
    add(checks, 'fail', error.message);
  }

  try {
    policy = readTomlFile(registryDir, 'rusq-extensions.toml');
    add(checks, 'pass', 'rusq-extensions.toml loaded');
  } catch (error) {
    add(checks, 'fail', error.message);
  }

  try {
    submodules = readGitmodules(registryDir);
    add(checks, 'pass', '.gitmodules loaded');
  } catch (error) {
    add(checks, 'fail', error.message);
  }

  const upstreamEntry = extensions[extensionId];
  const policyEntry = policy[extensionId];

  if (!upstreamEntry) {
    add(checks, 'fail', 'upstream entry is missing');
  } else {
    add(checks, 'pass', 'upstream entry exists');
  }

  if (!policyEntry) {
    add(checks, 'fail', 'policy entry is missing');
  } else {
    add(checks, 'pass', 'policy entry exists');
  }

  if (!upstreamEntry || !policyEntry) {
    return { extensionId, registryDir, sourceDir, checks };
  }

  if (!upstreamEntry.submodule) {
    add(checks, 'fail', 'upstream entry has no submodule');
  } else if (!submodules.has(upstreamEntry.submodule)) {
    add(checks, 'fail', `submodule ${upstreamEntry.submodule} is missing from .gitmodules`);
  } else {
    const submodule = submodules.get(upstreamEntry.submodule);
    add(checks, 'pass', 'submodule is registered', {
      submodule: upstreamEntry.submodule,
      url: submodule.url,
    });
  }

  if (policyEntry.status === 'verified') {
    add(checks, 'pass', 'policy status is verified');
  } else if (policyEntry.status === 'upstream-verified') {
    add(checks, 'warn', 'policy status is upstream-verified; Rusq local review is pending');
  } else {
    add(checks, 'warn', `policy status is ${policyEntry.status}; not installable yet`);
  }

  const licenseResult = validateLicense(policyEntry.license);
  if (!licenseResult.valid) {
    add(checks, 'fail', `license is invalid: ${licenseResult.error}`);
  } else if (policyEntry.license === 'NOASSERTION') {
    add(checks, 'warn', 'license is NOASSERTION');
  } else {
    add(checks, 'pass', `license is ${policyEntry.license}`);
  }

  if (!/^[a-f0-9]{40}$/.test(policyEntry.source_revision || '')) {
    add(checks, 'fail', 'source_revision is missing or malformed');
  } else {
    add(checks, 'pass', 'source_revision is well formed');
  }

  if (sourceDir) {
    const gitlinkCommit = upstreamEntry.submodule
      ? getGitlinkCommit(sourceDir, upstreamEntry.submodule)
      : null;
    if (!gitlinkCommit) {
      add(checks, 'fail', 'upstream Gitlink could not be resolved');
    } else if (gitlinkCommit !== policyEntry.source_revision) {
      add(checks, 'fail', 'source revision mismatch', {
        policy_revision: policyEntry.source_revision,
        upstream_revision: gitlinkCommit,
      });
    } else {
      add(checks, 'pass', 'source revision matches upstream Gitlink');
    }
  } else {
    add(checks, 'warn', 'source Gitlink check skipped; pass --source to enable it');
  }

  if (['upstream-verified', 'verified'].includes(policyEntry.status)) {
    if (!Array.isArray(policyEntry.api_versions) || policyEntry.api_versions.length === 0) {
      add(checks, 'fail', `${policyEntry.status} entries require api_versions`);
    } else if (policyEntry.api_versions.some(version => !/^rusq:\d+\.\d+$/.test(version))) {
      add(checks, 'fail', 'api_versions must use Rusq host versions like rusq:0.1');
    } else {
      add(checks, 'pass', `api_versions: ${policyEntry.api_versions.join(', ')}`);
    }

    if (!Array.isArray(policyEntry.platforms) || policyEntry.platforms.length === 0) {
      add(checks, 'fail', `${policyEntry.status} entries require platforms`);
    } else {
      add(checks, 'pass', `platforms: ${policyEntry.platforms.join(', ')}`);
    }
  }

  return { extensionId, registryDir, sourceDir, checks };
}

function formatText(report) {
  const lines = [
    `Audit report: ${report.extensionId}`,
    `Registry: ${report.registryDir}`,
  ];
  if (report.sourceDir) {
    lines.push(`Source: ${report.sourceDir}`);
  }
  lines.push('');

  for (const check of report.checks) {
    lines.push(`[${check.level.toUpperCase()}] ${check.message}`);
    if (check.url) lines.push(`  url: ${check.url}`);
    if (check.policy_revision) lines.push(`  policy_revision: ${check.policy_revision}`);
    if (check.upstream_revision) lines.push(`  upstream_revision: ${check.upstream_revision}`);
  }

  const failures = report.checks.filter(check => check.level === 'fail').length;
  const warnings = report.checks.filter(check => check.level === 'warn').length;
  lines.push('');
  lines.push(`Summary: ${failures} fail, ${warnings} warn`);
  return lines.join('\n');
}

const report = auditExtension({ extensionId, registryDir, sourceDir });

if (values.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatText(report));
}

if (report.checks.some(check => check.level === 'fail')) {
  process.exitCode = 1;
}
