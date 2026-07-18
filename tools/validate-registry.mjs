#!/usr/bin/env node

/**
 * Registry Validation Tool
 *
 * Validates the Rusq extension registry for correctness and policy compliance.
 */

import { resolve } from 'path';
import { validateRegistry } from './lib/registry.mjs';

const registryDir = process.argv[2] || resolve(process.cwd());

console.log(`Validating registry: ${registryDir}`);

const result = validateRegistry(registryDir);

if (result.valid) {
  console.log('✓ Registry validation passed');
  process.exit(0);
} else {
  console.error('✗ Registry validation failed:');
  for (const error of result.errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}
