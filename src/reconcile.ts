import type {
  ReconciliationResult,
  ReviewComment,
  ReviewThread,
} from "./types.js";

/**
 * REST pulls/{n}/comments does not return comments that belong to a PENDING
 * (draft) review, while the GraphQL reviewThreads connection exposes the
 * viewer's own pending threads. Excluding PENDING comments keeps the
 * reconciliation from flagging a permanent false mismatch on drafts.
 */
const isPendingReviewComment = (comment: {
  pullRequestReview?: { state: string } | null;
}): boolean => comment.pullRequestReview?.state === "PENDING";

/**
 * Cross-check the two independent transports that observe the same review
 * comment population: REST review comments (node_id) vs comments materialized
 * inside GraphQL review threads (id). Both use the same PRRC_* node ID scheme,
 * so a non-empty set difference in either direction means one transport is
 * lagging (eventual consistency) or dropped data. As a secondary invariant,
 * the GraphQL totalCount is compared against the number of collected threads.
 */
export function reconcile(
  data: { threads: ReviewThread[]; reviewComments: ReviewComment[] },
  reviewThreadsTotalCount: number | null,
): ReconciliationResult {
  const threadedIds = new Set<string>();
  for (const thread of data.threads) {
    for (const comment of thread.comments) {
      if (!isPendingReviewComment(comment)) {
        threadedIds.add(comment.id);
      }
    }
  }

  const restIds = new Set<string>(data.reviewComments.map((c) => c.node_id));

  const missingFromThreads = [...restIds]
    .filter((id) => !threadedIds.has(id))
    .sort();
  const missingFromRest = [...threadedIds]
    .filter((id) => !restIds.has(id))
    .sort();

  const collectedReviewThreads = data.threads.length;
  const totalCountMatches =
    reviewThreadsTotalCount === null
      ? null
      : reviewThreadsTotalCount === collectedReviewThreads;

  return {
    restReviewCommentCount: restIds.size,
    threadedReviewCommentCount: threadedIds.size,
    missingFromThreads,
    missingFromRest,
    reviewThreadsTotalCount,
    collectedReviewThreads,
    totalCountMatches,
    consistent:
      missingFromThreads.length === 0 &&
      missingFromRest.length === 0 &&
      totalCountMatches !== false,
  };
}
