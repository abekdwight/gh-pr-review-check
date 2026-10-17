import type {
  FetchedData,
  OutputEntry,
  ThreadEntry,
  ReviewEntry,
  IssueCommentEntry,
  ActionStatus,
} from './types.js';
import { getActionFromViewerReactions } from './reactions.js';

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
 * Build a map from review database ID to associated thread IDs.
 * Uses reviewComment.node_id (GraphQL ID) to match thread comments,
 * and reviewComment.pull_request_review_id to group by review.
 */
function buildReviewToThreadsMap(
  data: FetchedData,
): Map<number, Set<string>> {
  // Map: thread comment GraphQL ID → thread ID
  const commentToThreadId = new Map<string, string>();
  for (const thread of data.threads) {
    for (const comment of thread.comments) {
      commentToThreadId.set(comment.id, thread.id);
    }
  }

  // Map: review database ID → set of thread IDs
  const map = new Map<number, Set<string>>();
  for (const rc of data.reviewComments) {
    if (rc.pull_request_review_id == null) continue;
    const threadId = commentToThreadId.get(rc.node_id);
    if (!threadId) continue;
    let threads = map.get(rc.pull_request_review_id);
    if (!threads) {
      threads = new Set();
      map.set(rc.pull_request_review_id, threads);
    }
    threads.add(threadId);
  }
  return map;
}

/**
 * Transform fetched data to output entries
 */
export function transform(data: FetchedData): OutputEntry[] {
  const entries: OutputEntry[] = [];
  const commentToThread = buildCommentToThreadMap(data.threads);
  const reviewToThreads = buildReviewToThreadsMap(data);

  // Build thread → parent review GraphQL ID mapping
  // (only for reviews that will appear in output)
  const threadToParentReview = new Map<string, string>();
  for (const review of data.reviews) {
    if (review.state === 'COMMENTED' && !review.body?.trim()) continue;
    if (review.databaseId == null) continue;
    const associatedThreadIds = reviewToThreads.get(review.databaseId);
    if (!associatedThreadIds) continue;
    for (const tid of associatedThreadIds) {
      threadToParentReview.set(tid, review.id);
    }
  }

  // 1. Review Threads (primary source for inline comments)
  const threadActions = new Map<string, ActionStatus>();
  for (const thread of data.threads) {
    // Determine action: isResolved takes priority, then the viewer's
    // reactions on the first comment
    let action: ActionStatus = 'pending';
    if (thread.isResolved) {
      action = 'done';
    } else if (thread.comments.length > 0) {
      const firstComment = thread.comments[0];
      const reactionAction = getActionFromViewerReactions(firstComment.reactionGroups);
      if (reactionAction) {
        action = reactionAction;
      }
    }

    threadActions.set(thread.id, action);

    const parentReviewId = threadToParentReview.get(thread.id);
    const entry: ThreadEntry = {
      id: thread.id,
      type: 'thread',
      commit: thread.comments[0]?.commit?.oid ?? null,
      path: thread.path,
      line: thread.line,
      is_resolved: thread.isResolved,
      action,
      ...(parentReviewId ? { parentReviewId } : {}),
      comments: thread.comments.map((c) => ({
        id: c.id,
        author: c.author?.login || null,
        body: c.body,
        created_at: c.createdAt,
      })),
    };

    entries.push(entry);
  }

  // 2. Reviews (APPROVED, CHANGES_REQUESTED, etc.)
  for (const review of data.reviews) {
    // Skip if it's just a container for review comments (state: COMMENTED with no body)
    if (review.state === 'COMMENTED' && !review.body?.trim()) {
      continue;
    }

    // Determine action: the viewer's reactions on the review itself, else
    // done when every associated thread is done
    let action: ActionStatus = 'pending';
    const reactionAction = getActionFromViewerReactions(review.reactionGroups);
    if (reactionAction) {
      action = reactionAction;
    } else if (review.databaseId != null) {
      const associatedThreadIds = reviewToThreads.get(review.databaseId);
      if (associatedThreadIds && associatedThreadIds.size > 0) {
        const allDone = [...associatedThreadIds].every(
          (tid) => threadActions.get(tid) === 'done',
        );
        if (allDone) {
          action = 'done';
        }
      }
    }

    const entry: ReviewEntry = {
      id: review.id,
      type: 'review',
      commit: review.commit?.oid || null,
      author: review.author?.login || null,
      state: review.state,
      body: review.body || '',
      action,
    };
    entries.push(entry);
  }

  // 3. Issue Comments (PR-level comments)
  for (const comment of data.issueComments) {
    // Determine action from the viewer's reactions
    let action: ActionStatus = 'pending';
    const reactionAction = getActionFromViewerReactions(comment.reactionGroups);
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
 * Format entries as JSON array
 */
export function toJson(entries: OutputEntry[]): string {
  return JSON.stringify(entries, null, 2);
}
