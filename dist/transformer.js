/**
 * Build a map from review comment ID to thread ID
 */
function buildCommentToThreadMap(threads) {
    const map = new Map();
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
function getCommitForReviewComment(commentId, reviewComments) {
    const comment = reviewComments.find((c) => c.id === commentId);
    return comment?.commit_id || null;
}
/**
 * Transform fetched data to output entries
 */
export function transform(data) {
    const entries = [];
    const commentToThread = buildCommentToThreadMap(data.threads);
    // 1. Review Threads (primary source for inline comments)
    for (const thread of data.threads) {
        const entry = {
            id: thread.id,
            type: 'thread',
            commit: null, // Will be filled from first comment's review comment
            path: thread.path,
            line: thread.line,
            is_resolved: thread.isResolved,
            action: thread.isResolved ? 'done' : 'pending',
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
        const entry = {
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
        const entry = {
            id: comment.node_id,
            type: 'issue_comment',
            author: comment.author?.login || null,
            body: comment.body,
            action: 'pending',
        };
        entries.push(entry);
    }
    return entries;
}
/**
 * Format entries as JSONL
 */
export function toJsonl(entries) {
    return entries.map((e) => JSON.stringify(e)).join('\n');
}
//# sourceMappingURL=transformer.js.map