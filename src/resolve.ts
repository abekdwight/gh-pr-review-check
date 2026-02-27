import { execSync } from 'node:child_process';

export type Status = 'done' | 'skip' | 'in_progress';

export const STATUS_REACTIONS: Record<Status, string> = {
  done: '+1',
  skip: '-1',
  in_progress: 'eyes',
};

export interface ResolveOptions {
  owner: string;
  repo: string;
  entryId: string;
  status: Status;
  comment?: string;
}

function runGh(args: string): string {
  try {
    return execSync(`gh ${args}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    const err = error as { stderr?: string; message: string };
    throw new Error(`gh command failed: ${err.stderr || err.message}`);
  }
}

/**
 * Detect entry type from ID format
 */
export function detectEntryType(entryId: string): 'thread' | 'issue_comment' | 'review' | 'unknown' {
  if (entryId.startsWith('PRRT_')) return 'thread';
  if (entryId.startsWith('PRR_')) return 'review';
  // Issue comments use node_id format (e.g., IC_xxx or base64-like)
  // Check if it looks like a node_id (not starting with PRR)
  if (!entryId.startsWith('PRR')) return 'issue_comment';
  return 'unknown';
}

/**
 * Add reaction to an issue comment
 */
function addReactionToIssueComment(owner: string, repo: string, commentNodeId: string, reaction: string): void {
  // First, get the numeric comment ID from node_id
  // We need to query GitHub API to get the comment details
  const query = `
    query($owner: String!, $repo: String!, $nodeId: ID!) {
      node(id: $nodeId) {
        ... on IssueComment {
          id
          databaseId
        }
      }
    }
  `;

  const result = runGh(`api graphql -f query='${query}' -f owner=${owner} -f repo=${repo} -f nodeId=${commentNodeId}`);
  const data = JSON.parse(result);
  const databaseId = data.data?.node?.databaseId;

  if (!databaseId) {
    throw new Error(`Could not find issue comment with node_id: ${commentNodeId}`);
  }

  // Add reaction using REST API
  runGh(`api --method POST repos/${owner}/${repo}/issues/comments/${databaseId}/reactions -f content=${reaction}`);
}

/**
 * Add reaction to a review thread (first comment)
 */
function addReactionToThread(owner: string, repo: string, threadId: string, reaction: string): void {
  // Get thread details to find the first comment
  const query = `
    query($threadId: ID!) {
      node(id: $threadId) {
        ... on PullRequestReviewThread {
          comments(first: 1) {
            nodes {
              databaseId
            }
          }
        }
      }
    }
  `;

  const result = runGh(`api graphql -f query='${query}' -f threadId=${threadId}`);
  const data = JSON.parse(result);
  const firstComment = data.data?.node?.comments?.nodes?.[0];

  if (!firstComment || !firstComment.databaseId) {
    throw new Error(`Could not find comments in thread: ${threadId}`);
  }

  const databaseId = firstComment.databaseId;

  // Add reaction to the review comment using pulls/comments endpoint
  runGh(`api --method POST repos/${owner}/${repo}/pulls/comments/${databaseId}/reactions -f content=${reaction}`);
}

/**
 * Reply to a review thread
 */
function replyToThread(owner: string, repo: string, threadId: string, body: string): void {
  // Get thread's pull request and reply
  const query = `
    query($owner: String!, $repo: String!, $threadId: ID!) {
      node(id: $threadId) {
        ... on PullRequestReviewThread {
          pullRequest {
            number
          }
          comments(first: 1) {
            nodes {
              id
              pullRequestReview {
                id
              }
            }
          }
        }
      }
    }
  `;

  const result = runGh(`api graphql -f query='${query}' -f owner=${owner} -f repo=${repo} -f threadId=${threadId}`);
  const data = JSON.parse(result);
  const thread = data.data?.node;

  if (!thread?.pullRequest) {
    throw new Error(`Could not find pull request for thread: ${threadId}`);
  }

  const prNumber = thread.pullRequest.number;
  const reviewId = thread.comments?.nodes?.[0]?.pullRequestReview?.id;

  // Use gh pr comment to reply to the thread
  // We need to find the correct way to reply to a specific thread
  // For now, use the REST API to create a review comment as a reply
  const replyMutation = `
    mutation($threadId: ID!, $body: String!) {
      addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
        comment {
          id
        }
      }
    }
  `;

  runGh(`api graphql -f query='${replyMutation}' -f threadId=${threadId} -f body="${body.replace(/"/g, '\\"')}"`);
}

/**
 * Reply to an issue comment
 */
function replyToIssueComment(owner: string, repo: string, commentNodeId: string, body: string): void {
  // Get the issue/PR number from the comment
  const query = `
    query($nodeId: ID!) {
      node(id: $nodeId) {
        ... on IssueComment {
          issue {
            number
          }
        }
      }
    }
  `;

  const result = runGh(`api graphql -f query='${query}' -f nodeId=${commentNodeId}`);
  const data = JSON.parse(result);
  const issueNumber = data.data?.node?.issue?.number;

  if (!issueNumber) {
    throw new Error(`Could not find issue for comment: ${commentNodeId}`);
  }

  // Use gh pr comment to add a comment
  runGh(`pr comment ${issueNumber} --repo ${owner}/${repo} --body "${body.replace(/"/g, '\\"')}"`);
}

/**
 * Resolve a review entry by adding reaction and optionally commenting
 */
export function resolve(options: ResolveOptions): void {
  const { owner, repo, entryId, status, comment } = options;
  const reaction = STATUS_REACTIONS[status];
  const entryType = detectEntryType(entryId);

  console.error(`Resolving ${entryType} ${entryId} as ${status}...`);

  // Add reaction
  if (entryType === 'thread') {
    addReactionToThread(owner, repo, entryId, reaction);
  } else if (entryType === 'issue_comment') {
    addReactionToIssueComment(owner, repo, entryId, reaction);
  } else {
    throw new Error(`Reviews cannot be resolved directly (entry: ${entryId})`);
  }

  console.error(`Added reaction: ${reaction}`);

  // Add comment if provided
  if (comment) {
    console.error(`Adding comment...`);
    if (entryType === 'thread') {
      replyToThread(owner, repo, entryId, comment);
    } else if (entryType === 'issue_comment') {
      replyToIssueComment(owner, repo, entryId, comment);
    }
    console.error(`Comment added`);
  }

  console.error(`Done`);
}
