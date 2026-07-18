/**
 * Registry Validation Tests
 *
 * Tests for the registry validation logic.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import toml from '@iarna/toml';
const { parse: parseTomlString } = toml;
import { parseGitmodules } from '../tools/lib/gitmodules.mjs';
import { validateLicense } from '../tools/lib/licenses.mjs';
import {
  validateUpstreamIndex,
  validatePolicy,
  validateRegistry,
} from '../tools/lib/registry.mjs';

const FIXTURES_DIR = resolve(process.cwd(), 'tests/registry-fixtures');

describe('License Validation', () => {
  test('accepts valid SPDX licenses', () => {
    const licenses = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'GPL-3.0-only'];
    for (const license of licenses) {
      const result = validateLicense(license);
      assert.strictEqual(result.valid, true, `Expected ${license} to be valid`);
    }
  });

  test('accepts NOASSERTION', () => {
    const result = validateLicense('NOASSERTION');
    assert.strictEqual(result.valid, true);
  });

  test('accepts SPDX expressions', () => {
    const result = validateLicense('MIT OR Apache-2.0');
    assert.strictEqual(result.valid, true);
  });

  test('accepts parenthesized SPDX expressions', () => {
    const result = validateLicense('(MIT OR Apache-2.0) AND BSD-3-Clause');
    assert.strictEqual(result.valid, true);
  });

  test('rejects unknown licenses', () => {
    const result = validateLicense('UnknownLicenseXYZ');
    assert.strictEqual(result.valid, false);
  });

  test('rejects empty license', () => {
    const result = validateLicense('');
    assert.strictEqual(result.valid, false);
  });
});

describe('Upstream Index Validation', () => {
  test('validates matching entries and submodules', () => {
    const extensions = new Map([
      ['catppuccin', { submodule: 'extensions/catppuccin', version: '1.0.0' }],
      ['html', { submodule: 'extensions/zed', path: 'extensions/html', version: '0.3.1' }],
    ]);

    const submodules = new Map([
      ['extensions/catppuccin', { url: 'https://github.com/catppuccin/zed.git', path: 'extensions/catppuccin' }],
      ['extensions/zed', { url: 'https://github.com/zed-industries/zed.git', path: 'extensions/zed' }],
    ]);

    const result = validateUpstreamIndex(extensions, submodules);
    assert.strictEqual(result.valid, true, result.errors.join(', '));
  });

  test('detects missing submodule', () => {
    const extensions = new Map([
      ['missing-ext', { submodule: 'extensions/missing', version: '1.0.0' }],
    ]);

    const submodules = new Map([
      ['extensions/other', { url: 'https://example.com/other.git', path: 'extensions/other' }],
    ]);

    // With requireSubmodules = true, should detect missing submodule
    const result = validateUpstreamIndex(extensions, submodules, true);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('not found in .gitmodules')));
  });

  test('requires matching submodules by default', () => {
    const extensions = new Map([
      ['missing-ext', { submodule: 'extensions/missing', version: '1.0.0' }],
    ]);

    const result = validateUpstreamIndex(extensions, new Map());
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('not found in .gitmodules')));
  });

  test('detects non-HTTPS submodule URL', () => {
    const extensions = new Map([
      ['ssh-ext', { submodule: 'extensions/ssh-ext', version: '1.0.0' }],
    ]);

    const submodules = new Map([
      ['extensions/ssh-ext', { url: 'git@github.com:user/repo.git', path: 'extensions/ssh-ext' }],
    ]);

    const result = validateUpstreamIndex(extensions, submodules);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('HTTPS')));
  });

  test('allows shared submodule with path', () => {
    const extensions = new Map([
      ['html', { submodule: 'extensions/zed', path: 'extensions/html', version: '0.3.1' }],
    ]);

    const submodules = new Map([
      ['extensions/zed', { url: 'https://github.com/zed-industries/zed.git', path: 'extensions/zed' }],
    ]);

    const result = validateUpstreamIndex(extensions, submodules);
    assert.strictEqual(result.valid, true, result.errors.join(', '));
  });
});

describe('Policy Validation', () => {
  test('validates complete verified entry', () => {
    const policyEntries = new Map([
      ['catppuccin', {
        status: 'verified',
        distribution: 'source',
        license: 'MIT',
        source_revision: 'b54cb81708d06912d50e6bb9fd2fd2103b9dda25',
        api_versions: ['rusq:0.1'],
        platforms: ['macos-aarch64', 'linux-x86_64'],
        reviewed_at: '2026-07-18',
      }],
    ]);

    const upstreamIds = new Set(['catppuccin']);
    const result = validatePolicy(policyEntries, upstreamIds);
    assert.strictEqual(result.valid, true, result.errors.join(', '));
  });

  test('validates candidate with NOASSERTION', () => {
    const policyEntries = new Map([
      ['new-ext', {
        status: 'candidate',
        distribution: 'source',
        license: 'NOASSERTION',
        source_revision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }],
    ]);

    const upstreamIds = new Set(['new-ext']);
    const result = validatePolicy(policyEntries, upstreamIds);
    assert.strictEqual(result.valid, true, result.errors.join(', '));
  });

  test('validates upstream-verified with NOASSERTION and Rusq metadata', () => {
    const policyEntries = new Map([
      ['upstream-ext', {
        status: 'upstream-verified',
        distribution: 'source',
        license: 'NOASSERTION',
        source_revision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        api_versions: ['rusq:0.1'],
        platforms: ['macos-aarch64', 'macos-x86_64', 'linux-x86_64'],
        reviewed_at: '2026-07-18',
      }],
    ]);

    const upstreamIds = new Set(['upstream-ext']);
    const result = validatePolicy(policyEntries, upstreamIds);
    assert.strictEqual(result.valid, true, result.errors.join(', '));
  });

  test('rejects policy entry not in upstream', () => {
    const policyEntries = new Map([
      ['ghost-ext', {
        status: 'verified',
        distribution: 'source',
        license: 'MIT',
        source_revision: 'b54cb81708d06912d50e6bb9fd2fd2103b9dda25',
      }],
    ]);

    const upstreamIds = new Set([]);
    const result = validatePolicy(policyEntries, upstreamIds);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('not present in extensions.toml')));
  });

  test('rejects missing status', () => {
    const policyEntries = new Map([
      ['no-status', {
        distribution: 'source',
        license: 'MIT',
        source_revision: 'b54cb81708d06912d50e6bb9fd2fd2103b9dda25',
      }],
    ]);

    const upstreamIds = new Set(['no-status']);
    const result = validatePolicy(policyEntries, upstreamIds);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("missing 'status'")));
  });

  test('rejects unsupported status', () => {
    const policyEntries = new Map([
      ['bad-status', {
        status: 'pending',
        distribution: 'source',
        license: 'MIT',
        source_revision: 'b54cb81708d06912d50e6bb9fd2fd2103b9dda25',
      }],
    ]);

    const upstreamIds = new Set(['bad-status']);
    const result = validatePolicy(policyEntries, upstreamIds);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('unsupported status')));
  });

  test('rejects malformed source_revision', () => {
    const policyEntries = new Map([
      ['bad-rev', {
        status: 'verified',
        distribution: 'source',
        license: 'MIT',
        source_revision: 'short',
        api_versions: ['rusq:0.1'],
        platforms: ['macos-aarch64'],
        reviewed_at: '2026-07-18',
      }],
    ]);

    const upstreamIds = new Set(['bad-rev']);
    const result = validatePolicy(policyEntries, upstreamIds);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('40 lowercase hex')));
  });

  test('rejects verified without reviewed_at', () => {
    const policyEntries = new Map([
      ['no-date', {
        status: 'verified',
        distribution: 'source',
        license: 'MIT',
        source_revision: 'b54cb81708d06912d50e6bb9fd2fd2103b9dda25',
        api_versions: ['rusq:0.1'],
        platforms: ['macos-aarch64'],
      }],
    ]);

    const upstreamIds = new Set(['no-date']);
    const result = validatePolicy(policyEntries, upstreamIds);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("'reviewed_at' required")));
  });

  test('rejects verified without api_versions', () => {
    const policyEntries = new Map([
      ['no-api', {
        status: 'verified',
        distribution: 'source',
        license: 'MIT',
        source_revision: 'b54cb81708d06912d50e6bb9fd2fd2103b9dda25',
        platforms: ['macos-aarch64'],
        reviewed_at: '2026-07-18',
      }],
    ]);

    const upstreamIds = new Set(['no-api']);
    const result = validatePolicy(policyEntries, upstreamIds);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("'api_versions' required")));
  });

  test('rejects non-Rusq api_versions for verified entries', () => {
    const policyEntries = new Map([
      ['zed-api', {
        status: 'verified',
        distribution: 'source',
        license: 'MIT',
        source_revision: 'b54cb81708d06912d50e6bb9fd2fd2103b9dda25',
        api_versions: ['zed:0.8'],
        platforms: ['macos-aarch64'],
        reviewed_at: '2026-07-18',
      }],
    ]);

    const upstreamIds = new Set(['zed-api']);
    const result = validatePolicy(policyEntries, upstreamIds);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('rusq:')));
  });

  test('rejects verified without platforms', () => {
    const policyEntries = new Map([
      ['no-platforms', {
        status: 'verified',
        distribution: 'source',
        license: 'MIT',
        source_revision: 'b54cb81708d06912d50e6bb9fd2fd2103b9dda25',
        api_versions: ['rusq:0.1'],
        reviewed_at: '2026-07-18',
      }],
    ]);

    const upstreamIds = new Set(['no-platforms']);
    const result = validatePolicy(policyEntries, upstreamIds);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("'platforms' required")));
  });

  test('rejects NOASSERTION for non-candidate', () => {
    const policyEntries = new Map([
      ['noassert-verified', {
        status: 'verified',
        distribution: 'source',
        license: 'NOASSERTION',
        source_revision: 'b54cb81708d06912d50e6bb9fd2fd2103b9dda25',
        api_versions: ['rusq:0.1'],
        platforms: ['macos-aarch64'],
        reviewed_at: '2026-07-18',
      }],
    ]);

    const upstreamIds = new Set(['noassert-verified']);
    const result = validatePolicy(policyEntries, upstreamIds);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('NOASSERTION')));
  });
});

describe('Full Registry Validation', () => {
  test('validates the actual registry', () => {
    const result = validateRegistry(process.cwd());
    assert.strictEqual(result.valid, true, result.errors.join('\n'));
  });
});
