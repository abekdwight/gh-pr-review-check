/**
 * Parse a GitHub PR URL to extract owner, repo, and PR number
 *
 * Supports formats:
 * - https://github.com/owner/repo/pull/123
 * - https://github.com/owner/repo/pull/123/files
 * - github.com/owner/repo/pull/123
 */
export declare function parsePRUrl(url: string): {
    owner: string;
    repo: string;
    prNumber: number;
};
/**
 * Detect repository from current git directory
 */
export declare function detectRepo(): {
    owner: string;
    repo: string;
} | null;
//# sourceMappingURL=utils.d.ts.map