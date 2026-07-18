/**
 * Import Upstream Tool Tests
 *
 * Tests for the import-upstream.mjs tool.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { execSync, spawnSync } from 'child_process';
import toml from '@iarna/toml';

const { parse: parseToml, stringify: stringifyToml } = toml;

const FIXTURES_DIR = resolve(process.cwd(), 'tests/fixtures');
const IMPORT_TOOL = resolve(process.cwd(), 'tools/import-upstream.mjs');

/**
 * Create a fixture with real Gitlink entries for each dedicated submodule.
 * Returns an object with sourceDir and the outer registry commit hash.
 */
function createSourceFixture(name, extensions) {
  const fixtureDir = join(FIXTURES_DIR, name);
  mkdirSync(fixtureDir, { recursive: true });

  // Write extensions.toml
  writeFileSync(join(fixtureDir, 'extensions.toml'), extensions);

  // Create .gitmodules
  const submoduleMatches = extensions.matchAll(/\[([^\]]+)\]\nsubmodule = "([^"]+)"/g);
  let gitmodulesContent = '';
  for (const match of submoduleMatches) {
    const [, extId, submodule] = match;
    gitmodulesContent += `[submodule "${submodule}"]\n`;
    gitmodulesContent += `\tpath = ${submodule}\n`;
    gitmodulesContent += `\turl = https://github.com/example/${extId}.git\n\n`;
  }
  writeFileSync(join(fixtureDir, '.gitmodules'), gitmodulesContent);

  // Initialize git repo
  execSync('git init', { cwd: fixtureDir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: fixtureDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: fixtureDir, stdio: 'pipe' });
  execSync('git add extensions.toml .gitmodules', { cwd: fixtureDir, stdio: 'pipe' });

  const submodulePaths = [
    ...new Set([...extensions.matchAll(/submodule = "([^"]+)"/g)].map(match => match[1])),
  ];
  for (const [index, submodulePath] of submodulePaths.entries()) {
    const upstreamDir = join(fixtureDir, `.upstream-${index}`);
    mkdirSync(upstreamDir, { recursive: true });
    writeFileSync(join(upstreamDir, 'README.md'), `# ${submodulePath}\n`);
    execSync('git init', { cwd: upstreamDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: upstreamDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: upstreamDir, stdio: 'pipe' });
    execSync('git add README.md', { cwd: upstreamDir, stdio: 'pipe' });
    execSync('git commit -m "Initial upstream extension"', {
      cwd: upstreamDir,
      stdio: 'pipe',
    });
    const upstreamCommit = execSync('git rev-parse HEAD', {
      cwd: upstreamDir,
      encoding: 'utf-8',
    }).trim();

    execSync(
      `git update-index --add --cacheinfo 160000,${upstreamCommit},${submodulePath}`,
      { cwd: fixtureDir, stdio: 'pipe' },
    );
  }
  execSync('git commit -m "Initial"', { cwd: fixtureDir, stdio: 'pipe' });

  // Get the commit hash
  const commitHash = execSync('git rev-parse HEAD', { cwd: fixtureDir, encoding: 'utf-8' }).trim();

  return { fixtureDir, commitHash };
}

/**
 * Create a source fixture whose extension entry is a real Gitlink (mode 160000).
 * Returns the outer source directory and the pinned upstream commit.
 */
function createGitlinkSourceFixture(name, extensionId = 'ext-a') {
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

  execSync('git init', { cwd: fixtureDir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: fixtureDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: fixtureDir, stdio: 'pipe' });
  execSync('git add extensions.toml .gitmodules', { cwd: fixtureDir, stdio: 'pipe' });
  execSync(
    `git update-index --add --cacheinfo 160000,${upstreamCommit},extensions/${extensionId}`,
    { cwd: fixtureDir, stdio: 'pipe' },
  );
  execSync('git commit -m "Initial registry"', { cwd: fixtureDir, stdio: 'pipe' });

  return { fixtureDir, upstreamCommit };
}

/**
 * Clean up fixture directory
 */
function cleanupFixture(name) {
  const fixtureDir = join(FIXTURES_DIR, name);
  if (existsSync(fixtureDir)) {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

describe('Import Upstream Tool', () => {
  const outputDir = join(FIXTURES_DIR, 'output');

  beforeEach(() => {
    mkdirSync(FIXTURES_DIR, { recursive: true });
    mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    cleanupFixture('source');
    cleanupFixture('output');
  });

  test('produces deterministic output for multiple extensions', () => {
    const extensions = `[ext-a]
submodule = "extensions/ext-a"
version = "1.0.0"

[ext-b]
submodule = "extensions/ext-b"
version = "2.0.0"
`;
    const { fixtureDir: sourceDir } = createSourceFixture('source', extensions);

    // Run import first time
    execSync(
      `node "${IMPORT_TOOL}" --source "${sourceDir}" --output "${outputDir}" --ids ext-a,ext-b`,
      { encoding: 'utf-8' }
    );
    const output1 = readFileSync(join(outputDir, 'rusq-extensions.toml'), 'utf-8');

    // Delete and recreate output
    rmSync(join(outputDir, 'rusq-extensions.toml'), { force: true });

    // Run import second time with force
    execSync(
      `node "${IMPORT_TOOL}" --source "${sourceDir}" --output "${outputDir}" --ids ext-a,ext-b --force`,
      { encoding: 'utf-8' }
    );
    const output2 = readFileSync(join(outputDir, 'rusq-extensions.toml'), 'utf-8');

    // Outputs should be identical (deterministic)
    assert.strictEqual(output1, output2, 'Repeated imports should produce identical output');
  });

  test('imports extensions with correct structure', () => {
    const extensions = `[ext1]
submodule = "extensions/ext1"
version = "1.0.0"

[ext2]
submodule = "extensions/ext2"
version = "2.0.0"
`;
    const { fixtureDir: sourceDir } = createSourceFixture('source', extensions);

    // Run import
    execSync(
      `node "${IMPORT_TOOL}" --source "${sourceDir}" --output "${outputDir}" --ids ext1,ext2`,
      { encoding: 'utf-8' }
    );

    // Verify output
    assert.ok(existsSync(join(outputDir, 'rusq-extensions.toml')));
    const policy = parseToml(readFileSync(join(outputDir, 'rusq-extensions.toml'), 'utf-8'));

    assert.ok(policy.ext1, 'ext1 should be imported');
    assert.ok(policy.ext2, 'ext2 should be imported');
    assert.strictEqual(policy.ext1.status, 'candidate');
    assert.strictEqual(policy.ext1.license, 'NOASSERTION');
    assert.strictEqual(policy.ext2.status, 'candidate');
    assert.strictEqual(policy.ext2.license, 'NOASSERTION');
    assert.ok(policy.ext1.source_revision, 'source_revision should be set');
    assert.ok(policy.ext2.source_revision, 'source_revision should be set');
  });

  test('reads the pinned revision from a real gitlink', () => {
    const { fixtureDir: sourceDir, upstreamCommit } =
      createGitlinkSourceFixture('source');

    const result = spawnSync(
      process.execPath,
      [IMPORT_TOOL, '--source', sourceDir, '--output', outputDir, '--ids', 'ext-a'],
      { encoding: 'utf-8' },
    );

    assert.strictEqual(result.status, 0, result.stderr);
    const policy = parseToml(
      readFileSync(join(outputDir, 'rusq-extensions.toml'), 'utf-8'),
    );
    assert.strictEqual(policy['ext-a'].source_revision, upstreamCommit);
  });

  test('returns a non-zero exit code when an import error occurs', () => {
    const { fixtureDir: sourceDir } = createSourceFixture(
      'source',
      '[ext-a]\nsubmodule = "extensions/ext-a"\nversion = "1.0.0"\n',
    );

    const result = spawnSync(
      process.execPath,
      [IMPORT_TOOL, '--source', sourceDir, '--output', outputDir, '--ids', 'missing'],
      { encoding: 'utf-8' },
    );

    assert.notStrictEqual(result.status, 0);
  });

  test('rejects a submodule missing from .gitmodules', () => {
    const { fixtureDir: sourceDir } = createSourceFixture(
      'source',
      '[ext-a]\nsubmodule = "extensions/ext-a"\nversion = "1.0.0"\n',
    );
    writeFileSync(join(sourceDir, '.gitmodules'), '');

    const result = spawnSync(
      process.execPath,
      [IMPORT_TOOL, '--source', sourceDir, '--output', outputDir, '--ids', 'ext-a'],
      { encoding: 'utf-8' },
    );

    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /not in \.gitmodules/);
  });

  test('force flag overwrites existing entries', () => {
    const extensions = `[ext1]
submodule = "extensions/ext1"
version = "1.0.0"
`;
    const { fixtureDir: sourceDir } = createSourceFixture('source', extensions);

    // Create existing verified policy
    const existingPolicy = {
      ext1: {
        status: 'verified',
        distribution: 'source',
        license: 'MIT',
        source_revision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        reviewed_at: '2026-07-15',
      },
    };
    writeFileSync(
      join(outputDir, 'rusq-extensions.toml'),
      stringifyToml(existingPolicy)
    );

    // Run import with force
    execSync(
      `node "${IMPORT_TOOL}" --source "${sourceDir}" --output "${outputDir}" --ids ext1 --force`,
      { encoding: 'utf-8' }
    );

    // Verify entry is reset to candidate
    const policy = parseToml(readFileSync(join(outputDir, 'rusq-extensions.toml'), 'utf-8'));

    assert.strictEqual(policy.ext1.status, 'candidate', 'force should reset to candidate');
    assert.strictEqual(policy.ext1.license, 'NOASSERTION', 'force should reset license');
  });

  test('without force, skips verified entries', () => {
    const extensions = `[ext1]
submodule = "extensions/ext1"
version = "1.0.0"
`;
    const { fixtureDir: sourceDir } = createSourceFixture('source', extensions);

    // Create existing verified policy
    const existingPolicy = {
      ext1: {
        status: 'verified',
        distribution: 'source',
        license: 'MIT',
        source_revision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        reviewed_at: '2026-07-15',
      },
    };
    writeFileSync(
      join(outputDir, 'rusq-extensions.toml'),
      stringifyToml(existingPolicy)
    );

    // Run import without force
    const output = execSync(
      `node "${IMPORT_TOOL}" --source "${sourceDir}" --output "${outputDir}" --ids ext1`,
      { encoding: 'utf-8' }
    );

    // Verify the output mentions skipping
    assert.ok(output.includes('already reviewed'));

    // Verify entry is still verified
    const policy = parseToml(readFileSync(join(outputDir, 'rusq-extensions.toml'), 'utf-8'));
    assert.strictEqual(policy.ext1.status, 'verified');
  });
});
