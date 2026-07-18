/**
 * Audit Extension Tool Tests
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { execSync, spawnSync } from 'child_process';

const FIXTURES_DIR = resolve(process.cwd(), 'tests/audit-fixtures');
const AUDIT_TOOL = resolve(process.cwd(), 'tools/audit-extension.mjs');

function cleanupFixtures() {
  if (existsSync(FIXTURES_DIR)) {
    rmSync(FIXTURES_DIR, { recursive: true, force: true });
  }
}

function createRegistryFixture(name, {
  extensionId = 'ext-a',
  policyRevision,
  status = 'candidate',
  license = 'NOASSERTION',
} = {}) {
  const fixtureDir = join(FIXTURES_DIR, name);
  const upstreamDir = join(fixtureDir, 'upstream-extension');
  mkdirSync(upstreamDir, { recursive: true });
  writeFileSync(join(upstreamDir, 'README.md'), '# upstream extension\n');

  execSync('git init', { cwd: upstreamDir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: upstreamDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: upstreamDir, stdio: 'pipe' });
  execSync('git add README.md', { cwd: upstreamDir, stdio: 'pipe' });
  execSync('git commit -m "Initial upstream extension"', { cwd: upstreamDir, stdio: 'pipe' });
  const upstreamCommit = execSync('git rev-parse HEAD', {
    cwd: upstreamDir,
    encoding: 'utf-8',
  }).trim();

  writeFileSync(
    join(fixtureDir, 'extensions.toml'),
    `[${extensionId}]\nsubmodule = "extensions/${extensionId}"\nversion = "1.0.0"\n`,
  );
  writeFileSync(
    join(fixtureDir, '.gitmodules'),
    `[submodule "extensions/${extensionId}"]\n` +
      `\tpath = extensions/${extensionId}\n` +
      `\turl = https://github.com/example/${extensionId}.git\n`,
  );
  writeFileSync(
    join(fixtureDir, 'rusq-extensions.toml'),
    `[${extensionId}]\n` +
      `status = "${status}"\n` +
      'distribution = "source"\n' +
      `license = "${license}"\n` +
      `source_revision = "${policyRevision || upstreamCommit}"\n`,
  );

  execSync('git init', { cwd: fixtureDir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: fixtureDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: fixtureDir, stdio: 'pipe' });
  execSync('git add extensions.toml .gitmodules rusq-extensions.toml', {
    cwd: fixtureDir,
    stdio: 'pipe',
  });
  execSync(
    `git update-index --add --cacheinfo 160000,${upstreamCommit},extensions/${extensionId}`,
    { cwd: fixtureDir, stdio: 'pipe' },
  );
  execSync('git commit -m "Initial registry"', { cwd: fixtureDir, stdio: 'pipe' });

  return { fixtureDir, upstreamCommit };
}

describe('Audit Extension Tool', () => {
  beforeEach(() => {
    cleanupFixtures();
    mkdirSync(FIXTURES_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanupFixtures();
  });

  test('reports candidate audit checks without failing the process', () => {
    const { fixtureDir } = createRegistryFixture('registry');

    const result = spawnSync(
      process.execPath,
      [AUDIT_TOOL, 'ext-a', '--registry', fixtureDir, '--source', fixtureDir],
      { encoding: 'utf-8' },
    );

    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /Audit report: ext-a/);
    assert.match(result.stdout, /WARN.*policy status is candidate/);
    assert.match(result.stdout, /PASS.*source revision matches upstream Gitlink/);
  });

  test('fails when policy source_revision does not match upstream Gitlink', () => {
    const { fixtureDir } = createRegistryFixture('registry', {
      policyRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });

    const result = spawnSync(
      process.execPath,
      [AUDIT_TOOL, 'ext-a', '--registry', fixtureDir, '--source', fixtureDir],
      { encoding: 'utf-8' },
    );

    assert.notStrictEqual(result.status, 0);
    assert.match(result.stdout, /FAIL.*source revision mismatch/);
  });

  test('fails for unknown extension ids', () => {
    const { fixtureDir } = createRegistryFixture('registry');

    const result = spawnSync(
      process.execPath,
      [AUDIT_TOOL, 'missing', '--registry', fixtureDir],
      { encoding: 'utf-8' },
    );

    assert.notStrictEqual(result.status, 0);
    assert.match(result.stdout, /FAIL.*upstream entry is missing/);
  });
});
