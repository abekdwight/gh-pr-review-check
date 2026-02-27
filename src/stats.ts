import type { FetchedData, OutputEntry } from './types.js';

export interface PRStats {
  // Conversation breakdown
  conversation: number;
  issueComments: number;
  reviewsRaw: number;
  reviewThreads: number;

  // Thread details
  threadsResolved: number;
  threadsUnresolved: number;

  // Filtered reviews
  reviewsFiltered: number;

  // Review comments breakdown
  reviewComments: number;
  threadRoots: number;
  threadReplies: number;

  // Output entries
  totalEntries: number;
  pendingEntries: number;

  // Validation
  warnings: string[];
}

export function computeStats(data: FetchedData, entries: OutputEntry[]): PRStats {
  const warnings: string[] = [];

  // Raw counts from fetched data
  const issueComments = data.issueComments.length;
  const reviewsRaw = data.reviews.length;
  const reviewThreads = data.threads.length;

  // Conversation total
  const conversation = issueComments + reviewsRaw + reviewThreads;

  // Thread resolution status
  const threadsResolved = data.threads.filter(t => t.isResolved).length;
  const threadsUnresolved = reviewThreads - threadsResolved;

  // Filtered reviews (exclude COMMENTED with empty body)
  const reviewsFiltered = data.reviews.filter(
    r => !(r.state === 'COMMENTED' && !r.body?.trim())
  ).length;

  // Review comments breakdown
  // Count total comments from threads (not from REST API which may be incomplete)
  const reviewComments = data.threads.reduce((sum, t) => sum + t.comments.length, 0);
  const threadRoots = reviewThreads;
  const threadReplies = reviewComments - threadRoots;

  // Output entries stats
  const totalEntries = entries.length;
  const pendingEntries = entries.filter(e => e.action === 'pending').length;

  // Validation checks
  const expectedConversation = issueComments + reviewsRaw + reviewThreads;
  if (conversation !== expectedConversation) {
    warnings.push(
      `Conversation mismatch: ${conversation} != ${issueComments} + ${reviewsRaw} + ${reviewThreads}`
    );
  }

  if (reviewComments < threadRoots) {
    warnings.push(
      `Review comments (${reviewComments}) less than thread roots (${threadRoots})`
    );
  }

  return {
    conversation,
    issueComments,
    reviewsRaw,
    reviewThreads,
    threadsResolved,
    threadsUnresolved,
    reviewsFiltered,
    reviewComments,
    threadRoots,
    threadReplies,
    totalEntries,
    pendingEntries,
    warnings,
  };
}

export function formatSummary(stats: PRStats): string {
  const lines: string[] = [];

  lines.push('Summary:');
  lines.push(`Conversation: ${stats.conversation}`);
  lines.push(`  Issue Comments: ${stats.issueComments}`);
  lines.push(`  Reviews (raw): ${stats.reviewsRaw}`);
  lines.push(`  Review Threads: ${stats.reviewThreads} (resolved: ${stats.threadsResolved}, unresolved: ${stats.threadsUnresolved})`);
  lines.push('');
  lines.push(`Reviews (filtered): ${stats.reviewsFiltered}`);
  lines.push(`Review Comments: ${stats.reviewComments} (thread roots: ${stats.threadRoots}, replies: ${stats.threadReplies})`);
  lines.push('');
  lines.push(`Output Entries: ${stats.totalEntries} (pending: ${stats.pendingEntries})`);

  if (stats.warnings.length > 0) {
    lines.push('');
    lines.push('WARNING: Data inconsistency detected:');
    for (const w of stats.warnings) {
      lines.push(`  - ${w}`);
    }
  }

  return lines.join('\n');
}
