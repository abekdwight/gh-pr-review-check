#!/usr/bin/env node

import { Command } from 'commander';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parsePRUrl } from './utils.js';
import { fetchAll } from './fetcher.js';
import { transform, toJsonl } from './transformer.js';
import { computeStats, formatSummary } from './stats.js';
import { resolve, Status } from './resolve.js';

function detectRepo(): { owner: string; repo: string } | null {
  try {
    const result = execSync('gh repo view --json owner,name -q ".owner.login+\\"/\\"+.name"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    const [owner, repo] = result.split('/');
    return { owner, repo };
  } catch {
    return null;
  }
}

const program = new Command();

program
  .name('gh-pr-review-check')
  .description('Sync PR review data for AI-assisted review handling')
  .version('0.0.3');

// Default command: sync
program
  .argument('[pr]', 'PR number or URL (defaults to current branch)')
  .option('-o, --output <dir>', 'Output directory', '/tmp/github.com')
  .option('-R, --repo <repo>', 'Repository in OWNER/REPO format (auto-detected from cwd)')
  .option('-j, --json', 'Output as JSON (only the output directory path)')
  .option('-q, --quiet', 'Suppress progress messages')
  .action(async (pr: string | undefined, options: { output: string; repo?: string; json?: boolean; quiet?: boolean }) => {
    try {
      await syncCommand(pr, options);
    } catch (error) {
      const err = error as Error;
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// Resolve command
program
  .command('resolve <entry-id>')
  .description('Mark an entry as done, skip, or in_progress by adding a reaction')
  .requiredOption('-s, --status <status>', 'Status to set (done, skip, in_progress)')
  .option('-c, --comment <text>', 'Add a comment with the status change')
  .option('-R, --repo <repo>', 'Repository in OWNER/REPO format (auto-detected from cwd)')
  .action((entryId: string, options: { status: string; comment?: string; repo?: string }) => {
    try {
      const status = options.status as Status;
      if (!['done', 'skip', 'in_progress'].includes(status)) {
        throw new Error(`Invalid status: ${status}. Must be one of: done, skip, in_progress`);
      }

      let owner: string;
      let repo: string;

      if (options.repo) {
        const [o, r] = options.repo.split('/');
        owner = o;
        repo = r;
      } else {
        const detected = detectRepo();
        if (!detected) {
          throw new Error('--repo is required when no git repo detected');
        }
        owner = detected.owner;
        repo = detected.repo;
      }

      resolve({
        owner,
        repo,
        entryId,
        status,
        comment: options.comment,
      });
    } catch (error) {
      const err = error as Error;
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

async function syncCommand(
  pr: string | undefined,
  options: { output: string; repo?: string; json?: boolean; quiet?: boolean }
): Promise<void> {
  const log = options.quiet ? () => {} : console.error;

  // Determine owner, repo, prNumber
  let owner: string;
  let repo: string;
  let prNumber: number;

  if (pr) {
    // Check if it's a URL
    if (pr.startsWith('http') || pr.includes('github.com')) {
      const parsed = parsePRUrl(pr);
      owner = parsed.owner;
      repo = parsed.repo;
      prNumber = parsed.prNumber;
    } else if (pr.includes('/')) {
      // Format: OWNER/REPO/PR_NUMBER or OWNER/REPO#PR_NUMBER
      const match = pr.match(/^([^/]+)\/([^/#]+)[#/]?(\d+)$/);
      if (!match) {
        throw new Error(`Invalid PR format: ${pr}`);
      }
      owner = match[1];
      repo = match[2];
      prNumber = parseInt(match[3], 10);
    } else {
      // Just a number - try to detect repo
      let repoStr = options.repo;
      if (!repoStr) {
        const detected = detectRepo();
        if (!detected) {
          throw new Error('--repo is required when PR is just a number and no git repo detected');
        }
        owner = detected.owner;
        repo = detected.repo;
      } else {
        const [o, r] = repoStr.split('/');
        owner = o;
        repo = r;
      }
      prNumber = parseInt(pr, 10);
    }
  } else {
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

  // Compute and display stats
  const stats = computeStats(data, entries);

  if (!options.quiet) {
    log('');
    log(formatSummary(stats));
    log('');
  }

  // Output result
  if (options.json) {
    console.log(JSON.stringify({
      outputDir,
      prNumber,
      owner,
      repo,
      conversation: stats.conversation,
      issueComments: stats.issueComments,
      reviewsRaw: stats.reviewsRaw,
      reviewThreads: stats.reviewThreads,
      threadsResolved: stats.threadsResolved,
      threadsUnresolved: stats.threadsUnresolved,
      reviewsFiltered: stats.reviewsFiltered,
      reviewComments: stats.reviewComments,
      threadRoots: stats.threadRoots,
      threadReplies: stats.threadReplies,
      totalEntries: stats.totalEntries,
      pendingEntries: stats.pendingEntries,
      warnings: stats.warnings,
    }));
  } else {
    console.log(outputDir);
  }
}

program.parse();
