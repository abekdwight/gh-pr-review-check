import { describe, it, expect } from 'vitest';
import { transform, toJson } from './transformer.js';
import type {
  FetchedData,
  ReviewThread,
  Review,
  IssueComment,
  ReviewComment,
  OutputEntry,
} from './types.js';

describe('transform', () => {
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

  it('creates thread entries from review threads', () => {
    const thread: ReviewThread = {
      id: 'PRRT_1',
      isResolved: false,
      path: 'src/index.ts',
      line: 10,
      comments: [
        { id: 'C1', body: 'Fix this', author: { login: 'reviewer' }, createdAt: '2024-01-01T00:00:00Z' },
      ],
    };

    const data = createMockData({ threads: [thread] });
    const entries = transform(data);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'PRRT_1',
      type: 'thread',
      path: 'src/index.ts',
      line: 10,
      is_resolved: false,
      action: 'pending',
    });
  });

  it('sets action to done for resolved threads', () => {
    const thread: ReviewThread = {
      id: 'PRRT_2',
      isResolved: true,
      path: 'src/app.ts',
      line: 20,
      comments: [],
    };

    const data = createMockData({ threads: [thread] });
    const entries = transform(data);

    expect(entries[0].action).toBe('done');
  });

  it('creates review entries', () => {
    const review: Review = {
      id: 'PRR_1',
      author: { login: 'reviewer' },
      state: 'APPROVED',
      body: 'LGTM',
      commit: { oid: 'def456' },
      submittedAt: '2024-01-01T00:00:00Z',
    };

    const data = createMockData({ reviews: [review] });
    const entries = transform(data);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'PRR_1',
      type: 'review',
      author: 'reviewer',
      state: 'APPROVED',
      action: 'pending',
    });
  });

  it('skips COMMENTED reviews with empty body', () => {
    const reviews: Review[] = [
      { id: 'PRR_1', author: null, state: 'COMMENTED', body: '', commit: null, submittedAt: null },
      { id: 'PRR_2', author: { login: 'user' }, state: 'APPROVED', body: '', commit: null, submittedAt: null },
    ];

    const data = createMockData({ reviews });
    const entries = transform(data);

    // Only APPROVED should be included
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('PRR_2');
  });

  it('creates issue_comment entries', () => {
    const comment: IssueComment = {
      id: 'IC_1',
      node_id: 'NODE_1',
      author: { login: 'bot' },
      body: 'Auto review',
      createdAt: '2024-01-01T00:00:00Z',
    };

    const data = createMockData({ issueComments: [comment] });
    const entries = transform(data);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'NODE_1',  // Uses node_id not id
      type: 'issue_comment',
      author: 'bot',
      action: 'pending',
    });
  });

  it('includes commit info from review comments for threads', () => {
    const thread: ReviewThread = {
      id: 'PRRT_1',
      isResolved: false,
      path: 'src/index.ts',
      line: 10,
      comments: [{ id: '123', body: 'Test', author: { login: 'user' }, createdAt: '2024-01-01T00:00:00Z' }],
    };

    const reviewComment: ReviewComment = {
      id: 123,  // Must match the thread comment id numerically
      node_id: 'PRRC_1',
      user: { login: 'user' },
      body: 'Test',
      path: 'src/index.ts',
      line: 10,
      start_line: null,
      commit_id: 'commit123',
      original_commit_id: 'commit123',
      pull_request_review_id: 1,
      in_reply_to_id: null,
      created_at: '2024-01-01T00:00:00Z',
      html_url: 'https://github.com/owner/repo/pull/1#discussion_r123',
    };

    const data = createMockData({ threads: [thread], reviewComments: [reviewComment] });
    const entries = transform(data);

    const entry = entries[0];
    expect(entry.type).toBe('thread');
    if (entry.type !== 'thread') {
      throw new Error(`Expected thread entry but got ${entry.type}`);
    }
    expect(entry.commit).toBe('commit123');
  });
});

describe('toJson', () => {
  it('converts entries to JSON array format', () => {
    const entries: OutputEntry[] = [
      {
        id: '1',
        type: 'thread',
        commit: null,
        path: 'src/index.ts',
        line: 1,
        is_resolved: false,
        action: 'pending',
        comments: [],
      },
      {
        id: '2',
        type: 'review',
        commit: 'abc123',
        author: 'reviewer',
        state: 'APPROVED',
        body: 'Looks good',
        action: 'done',
      },
    ];

    const json = toJson(entries);
    const parsed = JSON.parse(json);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual(entries[0]);
    expect(parsed[1]).toEqual(entries[1]);
  });

  it('returns empty array for empty array', () => {
    expect(toJson([])).toBe('[]');
  });
});
