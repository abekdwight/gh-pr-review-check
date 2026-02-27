import { execSync } from 'node:child_process';
import type { ReviewThread, Review, IssueComment, ReviewComment, PRMeta, SyncConfig, FetchedData } from './types.js';

function runGh(args: string): string {
  try {
    return execSync(`gh ${args}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    const err = error as { stderr?: string; message: string };
    throw new Error(`gh command failed: ${err.stderr || err.message}`);
  }
}

function runGhApiGraphQL(query: string, variables: Record<string, string | number>): string {
  const varArgs = Object.entries(variables)
    .map(([key, value]) => {
      if (typeof value === 'number') {
        return `-F ${key}=${value}`;
      }
      return `-f ${key}=${value}`;
    })
    .join(' ');
  return runGh(`api graphql -f query='${query}' ${varArgs}`);
}

export function fetchPRMeta(config: SyncConfig): PRMeta {
  const json = runGh(
    `pr view ${config.prNumber} --repo ${config.owner}/${config.repo} --json number,title,state,headRefName,baseRefName,headRefOid`
  );
  return JSON.parse(json);
}

export function fetchReviewThreads(config: SyncConfig): ReviewThread[] {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              path
              line
              comments(first: 50) {
                nodes {
                  id
                  body
                  author { login }
                  createdAt
                }
              }
            }
          }
        }
      }
    }
  `;

  const result = runGhApiGraphQL(query, {
    owner: config.owner,
    repo: config.repo,
    number: config.prNumber,
  });

  const data = JSON.parse(result);
  const rawThreads = data.data.repository.pullRequest.reviewThreads.nodes;

  // Transform comments from { nodes: [...] } to [...]
  return rawThreads.map((thread: { id: string; isResolved: boolean; path: string | null; line: number | null; comments: { nodes: unknown[] } }) => ({
    id: thread.id,
    isResolved: thread.isResolved,
    path: thread.path,
    line: thread.line,
    comments: thread.comments.nodes,
  }));
}

export function fetchReviews(config: SyncConfig): Review[] {
  const json = runGh(
    `pr view ${config.prNumber} --repo ${config.owner}/${config.repo} --json reviews`
  );
  const data = JSON.parse(json);
  return data.reviews || [];
}

export function fetchIssueComments(config: SyncConfig): IssueComment[] {
  const json = runGh(
    `pr view ${config.prNumber} --repo ${config.owner}/${config.repo} --json comments`
  );
  const data = JSON.parse(json);
  return data.comments || [];
}

export function fetchReviewComments(config: SyncConfig): ReviewComment[] {
  const json = runGh(
    `api repos/${config.owner}/${config.repo}/pulls/${config.prNumber}/comments`
  );
  return JSON.parse(json);
}

export function fetchAll(config: SyncConfig, quiet: boolean = false): FetchedData {
  const log = quiet ? () => {} : console.error;

  log('Fetching PR metadata...');
  const meta = fetchPRMeta(config);

  log('Fetching review threads...');
  const threads = fetchReviewThreads(config);

  log('Fetching reviews...');
  const reviews = fetchReviews(config);

  log('Fetching issue comments...');
  const issueComments = fetchIssueComments(config);

  log('Fetching review comments...');
  const reviewComments = fetchReviewComments(config);

  return { meta, threads, reviews, issueComments, reviewComments };
}
