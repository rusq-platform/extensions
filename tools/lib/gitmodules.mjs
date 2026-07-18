/**
 * Gitmodules Parser
 *
 * Parses .gitmodules file and provides access to submodule information.
 */

import { readFileSync } from 'fs';

/**
 * Parse .gitmodules content into structured data.
 * @param {string} content
 * @returns {Map<string, { url: string | null, path: string }>}
 */
export function parseGitmodules(content) {
  const submodules = new Map();
  let currentSubmodule = null;

  const flush = () => {
    if (currentSubmodule?.path) {
      submodules.set(currentSubmodule.name, {
        url: currentSubmodule.url,
        path: currentSubmodule.path,
      });
    }
    currentSubmodule = null;
  };

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    const sectionMatch = trimmed.match(/^\[submodule "([^"]+)"\]\s*$/);
    if (sectionMatch) {
      flush();
      currentSubmodule = {
        name: sectionMatch[1],
        url: null,
        path: null,
      };
    } else if (currentSubmodule) {
      const propertyMatch = trimmed.match(/^(url|path)\s*=\s*(.*)$/);
      if (propertyMatch) {
        currentSubmodule[propertyMatch[1]] = propertyMatch[2];
      }
    }

    if (trimmed === '' && currentSubmodule) {
      flush();
    }
  }

  flush();

  return submodules;
}

/**
 * Load and parse .gitmodules from a directory.
 * @param {string} dir
 * @returns {Map<string, { url: string, path: string }>}
 */
export function loadGitmodules(dir) {
  const content = readFileSync(`${dir}/.gitmodules`, 'utf-8');
  return parseGitmodules(content);
}

/**
 * Check if a submodule URL uses HTTPS.
 * @param {string} url
 * @returns {boolean}
 */
export function isHttpsUrl(url) {
  return url.startsWith('https://');
}

/**
 * Check if a submodule path follows the dedicated repository pattern.
 * @param {string} path
 * @param {string} extensionId
 * @returns {boolean}
 */
export function isDedicatedSubmodulePath(path, extensionId) {
  return path === `extensions/${extensionId}`;
}
