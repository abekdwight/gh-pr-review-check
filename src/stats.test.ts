import { describe, it, expect } from 'vitest';
import { computeStats, computeCollectionManifest } from './stats.js';
import type {
  CollectionSignals,
  ConsistencySignal,
  FetchedData,
  ReconciliationResult,
} from './types.js';

describe('computeCollectionManifest', () => {
  const createMockData = (overrides: Partial<FetchedData> = {}): FetchedData => ({
    meta: {
      number: 1,
      title: 'Test PR',
      state: 'OPEN',
      headRefName: 'feature',
      baseRefName: 'main',
      headRefOid: 'abc123',
    },
    threads: [],
    reviews: [],
    issueComments: [],
    reviewComments: [],
    ...overrides,
  });

  const consistentResult = (
    overrides: Partial<ReconciliationResult> = {},
  ): ReconciliationResult => ({
    restReviewCommentCount: 0,
    threadedReviewCommentCount: 0,
    missingFromThreads: [],
    missingFromRest: [],
    reviewThreadsTotalCount: 0,
    collectedReviewThreads: 0,
    totalCountMatches: true,
    consistent: true,
    ...overrides,
  });

  const createSignals = (
    consistency: ConsistencySignal,
    overrides: Partial<CollectionSignals> = {},
  ): CollectionSignals => ({
    fallbackUsed: false,
    warnings: [],
    errors: [],
    sources: {
      reviewThreads: { exhausted: true, state: 'complete', warnings: [], errors: [] },
      issueComments: { exhausted: true, state: 'complete', warnings: [], errors: [] },
      reviewComments: { exhausted: true, state: 'complete', warnings: [], errors: [] },
    },
    consistency,
    ...overrides,
  });

  it('reports complete only when reconciliation ran and agreed', () => {
    const data = createMockData();
    const stats = computeStats(data, []);
    const signals = createSignals({
      checked: true,
      retries: 0,
      result: consistentResult(),
    });

    const manifest = computeCollectionManifest(data, [], stats, signals);

    expect(manifest.completenessState).toBe('complete');
    expect(manifest.consistency).toMatchObject({
      checked: true,
      consistent: true,
      retries: 0,
      missingFromThreads: [],
      missingFromRest: [],
    });
  });

  it('downgrades to inconclusive when reconciliation found a mismatch', () => {
    const data = createMockData();
    const stats = computeStats(data, []);
    const signals = createSignals({
      checked: true,
      retries: 3,
      result: consistentResult({
        consistent: false,
        restReviewCommentCount: 283,
        threadedReviewCommentCount: 278,
        missingFromThreads: ['PRRC_a', 'PRRC_b', 'PRRC_c', 'PRRC_d', 'PRRC_e'],
      }),
    });

    const manifest = computeCollectionManifest(data, [], stats, signals);

    expect(manifest.completenessState).toBe('inconclusive');
    expect(manifest.consistency.consistent).toBe(false);
    expect(manifest.consistency.retries).toBe(3);
    expect(manifest.consistency.missingFromThreads).toHaveLength(5);
  });

  it('never reports complete when reconciliation could not run', () => {
    const data = createMockData();
    const stats = computeStats(data, []);
    const signals = createSignals({ checked: false, retries: 0, result: null });

    const manifest = computeCollectionManifest(data, [], stats, signals);

    expect(manifest.completenessState).not.toBe('complete');
    expect(manifest.consistency).toMatchObject({
      checked: false,
      consistent: null,
      restReviewComments: null,
    });
  });

  it('stays incomplete when a source failed before reconciliation', () => {
    const data = createMockData();
    const stats = computeStats(data, []);
    const signals = createSignals(
      { checked: false, retries: 0, result: null },
      {
        sources: {
          reviewThreads: { exhausted: true, state: 'complete', warnings: [], errors: [] },
          issueComments: { exhausted: true, state: 'complete', warnings: [], errors: [] },
          reviewComments: {
            exhausted: false,
            state: 'incomplete',
            warnings: [],
            errors: ['gh command failed'],
          },
        },
      },
    );

    const manifest = computeCollectionManifest(data, [], stats, signals);

    expect(manifest.completenessState).toBe('incomplete');
  });

  it('exposes both REST and threaded comment counts', () => {
    const data = createMockData({
      threads: [
        {
          id: 'PRRT_1',
          isResolved: false,
          path: 'src/index.ts',
          line: 1,
          comments: [
            {
              id: 'PRRC_1',
              body: 'b',
              author: { login: 'r' },
              createdAt: '2024-01-01T00:00:00Z',
            },
          ],
        },
      ],
      reviewComments: [
        {
          id: 1,
          node_id: 'PRRC_1',
          user: { login: 'r' },
          body: 'b',
          path: 'src/index.ts',
          line: 1,
          start_line: null,
          commit_id: 'abc',
          original_commit_id: 'abc',
          pull_request_review_id: null,
          in_reply_to_id: null,
          created_at: '2024-01-01T00:00:00Z',
          html_url: 'https://example.com',
        },
      ],
    });
    const stats = computeStats(data, []);
    const signals = createSignals({
      checked: true,
      retries: 0,
      result: consistentResult({
        restReviewCommentCount: 1,
        threadedReviewCommentCount: 1,
        reviewThreadsTotalCount: 1,
        collectedReviewThreads: 1,
      }),
    });

    const manifest = computeCollectionManifest(data, [], stats, signals);

    expect(manifest.counts.reviewComments).toBe(1);
    expect(manifest.counts.threadedReviewComments).toBe(1);
    expect(stats.restReviewComments).toBe(1);
  });
});
