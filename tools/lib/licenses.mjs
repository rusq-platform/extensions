/**
 * SPDX License Policy
 *
 * Defines accepted SPDX license identifiers and expressions.
 * The validator records the license; it does not decide whether
 * distribution is allowed by the host.
 */

import parseSpdxExpression from 'spdx-expression-parse';

const KNOWN_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'Zlib',
  '0BSD',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
]);

/**
 * Check if a license identifier is valid.
 * @param {string} license
 * @returns {boolean}
 */
export function isValidLicense(license) {
  if (license === 'NOASSERTION') {
    return true;
  }
  return KNOWN_LICENSES.has(license);
}

/**
 * Validate an SPDX license identifier or expression.
 * @param {string} license
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateLicense(license) {
  if (!license || license.trim() === '') {
    return { valid: false, error: 'License cannot be empty' };
  }

  if (license === 'NOASSERTION') {
    return { valid: true };
  }

  let expression;
  try {
    expression = parseSpdxExpression(license);
  } catch (error) {
    return { valid: false, error: `Invalid SPDX expression: ${error.message}` };
  }

  const identifiers = new Set();
  const exceptions = new Set();
  const visit = (node) => {
    if (node.license) identifiers.add(node.license);
    if (node.exception) exceptions.add(node.exception);
    if (node.left) visit(node.left);
    if (node.right) visit(node.right);
  };
  visit(expression);

  for (const identifier of identifiers) {
    if (!KNOWN_LICENSES.has(identifier)) {
      return { valid: false, error: `Unknown license: ${identifier}` };
    }
  }

  if (exceptions.size > 0) {
    return {
      valid: false,
      error: `License exceptions are not supported: ${[...exceptions].join(', ')}`,
    };
  }

  return { valid: true };
}
