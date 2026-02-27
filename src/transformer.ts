import type {
  FetchedData,
  OutputEntry,
  ThreadEntry,
  ReviewEntry,
  IssueCommentEntry,
  ReviewComment,
  ActionStatus,
} from './types.js';

// Reaction content to action mapping (case-insensitive)
const REACTION_TO_ACTION: Record<string, ActionStatus> = {
  '+1': 'done',
  '-1': 'skip',
  'eyes': 'in_progress',
  'hooray': 'done',
  'rocket': 'in_progress',
};

/**
 * Determine action from reactions
 */
function getActionFromReactions(reactions?: { nodes: Array<{ content: string }> }): ActionStatus | null {
  if (!reactions?.nodes?.length) return null;

  // Check for known reactions (case-insensitive)
  for (const reaction of reactions.nodes) {
    const content = reaction.content.toLowerCase();
    const action = REACTION_TO_ACTION[content];
    if (action) return action;
  }

  return null;
}

/**
 * Build a map from review comment ID to thread ID
 */
function buildCommentToThreadMap(
  threads: FetchedData['threads']
): Map<string, string> {
  const map = new Map<string, string>();
  for (const thread of threads) {
    for (const comment of thread.comments) {
      map.set(comment.id, thread.id);
    }
  }
  return map;
}

/**
 * Get commit ID for a review comment
 */
function getCommitForReviewComment(
  commentId: number,
  reviewComments: ReviewComment[]
): string | null {
  const comment = reviewComments.find((c) => c.id === commentId);
  return comment?.commit_id || null;
}

/**
 * Transform fetched data to output entries
 */
export function transform(data: FetchedData): OutputEntry[] {
  const entries: OutputEntry[] = [];
  const commentToThread = buildCommentToThreadMap(data.threads);

  // 1. Review Threads (primary source for inline comments)
  for (const thread of data.threads) {
    // Determine action: isResolved takes priority, then check reactions
    let action: ActionStatus = 'pending';
    if (thread.isResolved) {
      action = 'done';
    } else if (thread.comments.length > 0) {
      // Check first comment's reactions
      const firstComment = thread.comments[0];
      const reactionAction = getActionFromReactions(firstComment.reactions);
      if (reactionAction) {
        action = reactionAction;
      }
    }

    const entry: ThreadEntry = {
      id: thread.id,
      type: 'thread',
      commit: null, // Will be filled from first comment's review comment
      path: thread.path,
      line: thread.line,
      is_resolved: thread.isResolved,
      action,
      comments: thread.comments.map((c) => ({
        id: c.id,
        author: c.author?.login || null,
        body: c.body,
        created_at: c.createdAt,
      })),
    };

    // Try to get commit from review comments
    if (thread.comments.length > 0) {
      const firstCommentId = thread.comments[0].id;
      // Extract numeric ID from PRRC_xxx format
      const numericId = firstCommentId.includes('_')
        ? undefined
        : parseInt(firstCommentId, 10);
      if (numericId) {
        entry.commit = getCommitForReviewComment(numericId, data.reviewComments);
      }
    }

    entries.push(entry);
  }

  // 2. Reviews (APPROVED, CHANGES_REQUESTED, etc.)
  for (const review of data.reviews) {
    // Skip if it's just a container for review comments (state: COMMENTED with no body)
    if (review.state === 'COMMENTED' && !review.body?.trim()) {
      continue;
    }

    const entry: ReviewEntry = {
      id: review.id,
      type: 'review',
      commit: review.commit?.oid || null,
      author: review.author?.login || null,
      state: review.state,
      body: review.body || '',
      action: 'pending',
    };
    entries.push(entry);
  }

  // 3. Issue Comments (PR-level comments)
  for (const comment of data.issueComments) {
    // Determine action from reactions
    let action: ActionStatus = 'pending';
    const reactionAction = getActionFromReactions(comment.reactions);
    if (reactionAction) {
      action = reactionAction;
    }

    const entry: IssueCommentEntry = {
      id: comment.node_id,
      type: 'issue_comment',
      author: comment.author?.login || null,
      body: comment.body,
      action,
    };
    entries.push(entry);
  }

  return entries;
}

/**
 * Format entries as JSONL
 */
export function toJsonl(entries: OutputEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join('\n');
}
