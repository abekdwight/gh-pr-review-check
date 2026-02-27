#!/usr/bin/env node
import { program } from 'commander';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parsePRUrl } from './utils.js';
import { fetchAll } from './fetcher.js';
import { transform, toJsonl } from './transformer.js';
function detectRepo() {
    try {
        const result = execSync('gh repo view --json owner,name -q ".owner.login+\\"/\\"+.name"', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        const [owner, repo] = result.split('/');
        return { owner, repo };
    }
    catch {
        return null;
    }
}
program
    .name('gh-pr-review-check')
    .description('Sync PR review data for AI-assisted review handling')
    .version('1.0.0')
    .argument('[pr]', 'PR number or URL (defaults to current branch)')
    .option('-o, --output <dir>', 'Output directory', '/tmp/github.com')
    .option('-R, --repo <repo>', 'Repository in OWNER/REPO format (auto-detected from cwd)')
    .option('-j, --json', 'Output as JSON (only the output directory path)')
    .option('-q, --quiet', 'Suppress progress messages')
    .action(async (pr, options) => {
    try {
        await main(pr, options);
    }
    catch (error) {
        const err = error;
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
});
async function main(pr, options) {
    const log = options.quiet ? () => { } : console.error;
    // Determine owner, repo, prNumber
    let owner;
    let repo;
    let prNumber;
    if (pr) {
        // Check if it's a URL
        if (pr.startsWith('http') || pr.includes('github.com')) {
            const parsed = parsePRUrl(pr);
            owner = parsed.owner;
            repo = parsed.repo;
            prNumber = parsed.prNumber;
        }
        else if (pr.includes('/')) {
            // Format: OWNER/REPO/PR_NUMBER or OWNER/REPO#PR_NUMBER
            const match = pr.match(/^([^/]+)\/([^/#]+)[#/]?(\d+)$/);
            if (!match) {
                throw new Error(`Invalid PR format: ${pr}`);
            }
            owner = match[1];
            repo = match[2];
            prNumber = parseInt(match[3], 10);
        }
        else {
            // Just a number - try to detect repo
            let repoStr = options.repo;
            if (!repoStr) {
                const detected = detectRepo();
                if (!detected) {
                    throw new Error('--repo is required when PR is just a number and no git repo detected');
                }
                owner = detected.owner;
                repo = detected.repo;
            }
            else {
                const [o, r] = repoStr.split('/');
                owner = o;
                repo = r;
            }
            prNumber = parseInt(pr, 10);
        }
    }
    else {
        // Try to get PR from current branch
        const prUrl = execSync('gh pr view --json url -q .url', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        const parsed = parsePRUrl(prUrl);
        owner = parsed.owner;
        repo = parsed.repo;
        prNumber = parsed.prNumber;
    }
    log(`Syncing PR #${prNumber} from ${owner}/${repo}...`);
    // Create output directory
    const outputDir = path.join(options.output, owner, repo, 'pr', prNumber.toString());
    fs.mkdirSync(outputDir, { recursive: true });
    // Fetch data
    const data = fetchAll({ owner, repo, prNumber }, options.quiet ?? false);
    // Write PR meta
    const metaPath = path.join(outputDir, 'pr-meta.json');
    fs.writeFileSync(metaPath, JSON.stringify(data.meta, null, 2));
    log(`Wrote ${metaPath}`);
    // Transform and write reviews.jsonl
    const entries = transform(data);
    const reviewsPath = path.join(outputDir, 'reviews.jsonl');
    fs.writeFileSync(reviewsPath, toJsonl(entries));
    log(`Wrote ${reviewsPath} (${entries.length} entries)`);
    // Summary
    const threadCount = entries.filter((e) => e.type === 'thread').length;
    const reviewCount = entries.filter((e) => e.type === 'review').length;
    const commentCount = entries.filter((e) => e.type === 'issue_comment').length;
    const pendingCount = entries.filter((e) => e.action === 'pending').length;
    if (!options.quiet) {
        log('');
        log('Summary:');
        log(`  Threads: ${threadCount}`);
        log(`  Reviews: ${reviewCount}`);
        log(`  Issue Comments: ${commentCount}`);
        log(`  Pending: ${pendingCount}`);
        log('');
    }
    // Output result
    if (options.json) {
        console.log(JSON.stringify({
            outputDir,
            prNumber,
            owner,
            repo,
            entries: entries.length,
            threads: threadCount,
            reviews: reviewCount,
            issueComments: commentCount,
            pending: pendingCount
        }));
    }
    else {
        console.log(outputDir);
    }
}
program.parse();
//# sourceMappingURL=index.js.map