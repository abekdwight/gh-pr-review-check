import { describe, it, expect } from 'vitest';
import { reconcile } from './reconcile.js';
import type { ReviewComment, ReviewThread, ReviewThreadComment } from './types.js';

describe('reconcile', () => {
  const createThreadComment = (
    id: string,
    overrides: Partial<ReviewThreadComment> = {},
  ): ReviewThreadComment => ({
    id,
    body: 'comment body',
    author: { login: 'reviewer' },
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  });

  const createThread = (
    id: string,
    comments: ReviewThreadComment[],
  ): ReviewThread => ({
    id,
    isResolved: false,
    path: 'src/index.ts',
    line: 10,
    comments,
  });

  const createRestComment = (nodeId: string): ReviewComment => ({
    id: 1,
    node_id: nodeId,
    user: { login: 'reviewer' },
    body: 'comment body',
    path: 'src/index.ts',
    line: 10,
    start_line: null,
    commit_id: 'abc123',
    original_commit_id: 'abc123',
    pull_request_review_id: null,
    in_reply_to_id: null,
    created_at: '2024-01-01T00:00:00Z',
    html_url: 'https://github.com/owner/repo/pull/1#discussion_r1',
  });

  it('reports consistent when both transports observe the same comments', () => {
    const result = reconcile(
      {
        threads: [
          createThread('PRRT_1', [
            createThreadComment('PRRC_1'),
            createThreadComment('PRRC_2'),
          ]),
        ],
        reviewComments: [createRestComment('PRRC_1'), createRestComment('PRRC_2')],
      },
      1,
    );

    expect(result).toMatchObject({
      consistent: true,
      restReviewCommentCount: 2,
      threadedReviewCommentCount: 2,
      missingFromThreads: [],
      missingFromRest: [],
      reviewThreadsTotalCount: 1,
      collectedReviewThreads: 1,
      totalCountMatches: true,
    });
  });

  it('flags REST comments whose threads were not collected', () => {
    // The incident class: REST already lists new comments while the GraphQL
    // reviewThreads connection has not materialized their threads yet.
    const result = reconcile(
      {
        threads: [createThread('PRRT_1', [createThreadComment('PRRC_1')])],
        reviewComments: [
          createRestComment('PRRC_1'),
          createRestComment('PRRC_2'),
          createRestComment('PRRC_3'),
        ],
      },
      1,
    );

    expect(result.consistent).toBe(false);
    expect(result.missingFromThreads).toEqual(['PRRC_2', 'PRRC_3']);
    expect(result.missingFromRest).toEqual([]);
  });

  it('flags threaded comments absent from the REST listing', () => {
    const result = reconcile(
      {
        threads: [
          createThread('PRRT_1', [
            createThreadComment('PRRC_1'),
            createThreadComment('PRRC_2'),
          ]),
        ],
        reviewComments: [createRestComment('PRRC_1')],
      },
      1,
    );

    expect(result.consistent).toBe(false);
    expect(result.missingFromThreads).toEqual([]);
    expect(result.missingFromRest).toEqual(['PRRC_2']);
  });

  it('excludes comments of PENDING reviews from the threaded side', () => {
    // REST pulls/comments never returns draft-review comments, while GraphQL
    // exposes the viewer's own pending threads. They must not count as a
    // mismatch.
    const result = reconcile(
      {
        threads: [
          createThread('PRRT_1', [createThreadComment('PRRC_1')]),
          createThread('PRRT_2', [
            createThreadComment('PRRC_draft', {
              pullRequestReview: { state: 'PENDING' },
            }),
          ]),
        ],
        reviewComments: [createRestComment('PRRC_1')],
      },
      2,
    );

    expect(result.consistent).toBe(true);
    expect(result.threadedReviewCommentCount).toBe(1);
    expect(result.missingFromRest).toEqual([]);
  });

  it('treats a submitted review state as a normal threaded comment', () => {
    const result = reconcile(
      {
        threads: [
          createThread('PRRT_1', [
            createThreadComment('PRRC_1', {
              pullRequestReview: { state: 'COMMENTED' },
            }),
          ]),
        ],
        reviewComments: [createRestComment('PRRC_1')],
      },
      1,
    );

    expect(result.consistent).toBe(true);
    expect(result.threadedReviewCommentCount).toBe(1);
  });

  it('fails consistency when totalCount disagrees with collected threads', () => {
    const result = reconcile(
      {
        threads: [createThread('PRRT_1', [createThreadComment('PRRC_1')])],
        reviewComments: [createRestComment('PRRC_1')],
      },
      3,
    );

    expect(result.consistent).toBe(false);
    expect(result.totalCountMatches).toBe(false);
    expect(result.reviewThreadsTotalCount).toBe(3);
    expect(result.collectedReviewThreads).toBe(1);
  });

  it('keeps totalCountMatches null when totalCount is unavailable', () => {
    const result = reconcile(
      {
        threads: [createThread('PRRT_1', [createThreadComment('PRRC_1')])],
        reviewComments: [createRestComment('PRRC_1')],
      },
      null,
    );

    expect(result.consistent).toBe(true);
    expect(result.totalCountMatches).toBeNull();
  });

  it('reports consistent for an empty PR', () => {
    const result = reconcile({ threads: [], reviewComments: [] }, 0);

    expect(result).toMatchObject({
      consistent: true,
      restReviewCommentCount: 0,
      threadedReviewCommentCount: 0,
      totalCountMatches: true,
    });
  });
});
