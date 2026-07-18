/**
 * .gitmodules parser tests.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseGitmodules } from '../tools/lib/gitmodules.mjs';

describe('.gitmodules parsing', () => {
  test('parses adjacent sections without requiring blank lines', () => {
    const content = [
      '[submodule "extensions/first"]',
      '\tpath = extensions/first',
      '\turl = https://example.com/first.git',
      '[submodule "extensions/second"]',
      '\tpath = extensions/second',
      '\turl = https://example.com/second.git',
    ].join('\n');

    const result = parseGitmodules(content);

    assert.deepStrictEqual(result.get('extensions/first'), {
      path: 'extensions/first',
      url: 'https://example.com/first.git',
    });
    assert.deepStrictEqual(result.get('extensions/second'), {
      path: 'extensions/second',
      url: 'https://example.com/second.git',
    });
  });

  test('normalizes section names without trailing quotes', () => {
    const result = parseGitmodules(
      '[submodule "extensions/theme"]\n\tpath = extensions/theme\n',
    );

    assert.ok(result.has('extensions/theme'));
    assert.ok(!result.has('extensions/theme"'));
  });
});
