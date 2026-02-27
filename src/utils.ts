/**
 * Parse a GitHub PR URL to extract owner, repo, and PR number
 *
 * Supports formats:
 * - https://github.com/owner/repo/pull/123
 * - https://github.com/owner/repo/pull/123/files
 * - github.com/owner/repo/pull/123
 */
export function parsePRUrl(url: string): { owner: string; repo: string; prNumber: number } {
  // Remove protocol if present
  let cleanUrl = url.replace(/^https?:\/\//, '');

  // Remove trailing paths like /files, /commits, etc.
  cleanUrl = cleanUrl.replace(/\/(files|commits|checks|conflicts)$/, '');

  // Match pattern: github.com/owner/repo/pull/123
  const match = cleanUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);

  if (!match) {
    throw new Error(`Invalid PR URL: ${url}`);
  }

  return {
    owner: match[1],
    repo: match[2],
    prNumber: parseInt(match[3], 10),
  };
}

/**
 * Detect repository from current git directory
 */
export function detectRepo(): { owner: string; repo: string } | null {
  try {
    const { execSync } = require('node:child_process');
    const remote = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();

    // Parse git URL
    // git@github.com:owner/repo.git
    // https://github.com/owner/repo.git
    const match = remote.match(/(?:github\.com[/:]|github\.com\/)([^/]+)\/([^/.]+)/);

    if (!match) {
      return null;
    }

    return { owner: match[1], repo: match[2] };
  } catch {
    return null;
  }
}
