import { describe, it, expect } from 'vitest';
import { transform, toJson } from './transformer.js';
import type {
  FetchedData,
  ReactionGroup,
  ReviewThread,
  ReviewThreadComment,
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

  describe('commit of a thread', () => {
    const threadWith = (comments: ReviewThreadComment[]): ReviewThread => ({
      id: 'PRRT_1',
      isResolved: false,
      path: 'src/index.ts',
      line: 10,
      comments,
    });

    const threadCommit = (comments: ReviewThreadComment[], reviewComments: ReviewComment[] = []) => {
      const entry = transform(createMockData({ threads: [threadWith(comments)], reviewComments }))[0];
      if (entry.type !== 'thread') {
        throw new Error(`Expected thread entry but got ${entry.type}`);
      }
      return entry.commit;
    };

    const threadComment = (id: string, commitOid?: string | null): ReviewThreadComment => ({
      id,
      body: 'Test',
      author: { login: 'user' },
      createdAt: '2024-01-01T00:00:00Z',
      commit: commitOid === undefined ? undefined : commitOid === null ? null : { oid: commitOid },
    });

    it('is the commit of the first comment', () => {
      expect(threadCommit([threadComment('PRRC_1', 'commit123')])).toBe('commit123');
    });

    it('does not depend on the shape of the comment ID', () => {
      expect(threadCommit([threadComment('PRRC_kwDOPPCZqM7nxA5p', 'aaa111')])).toBe('aaa111');
      expect(threadCommit([threadComment('123', 'bbb222')])).toBe('bbb222');
    });

    it('comes from the thread comment, not from the REST review comment list', () => {
      const restComment: ReviewComment = {
        id: 123,
        node_id: 'PRRC_1',
        user: { login: 'user' },
        body: 'Test',
        path: 'src/index.ts',
        line: 10,
        start_line: null,
        commit_id: 'rest-commit',
        original_commit_id: 'rest-original-commit',
        pull_request_review_id: 1,
        in_reply_to_id: null,
        created_at: '2024-01-01T00:00:00Z',
        html_url: 'https://github.com/owner/repo/pull/1#discussion_r123',
      };

      expect(threadCommit([threadComment('PRRC_1', 'graphql-commit')], [restComment])).toBe('graphql-commit');
      expect(threadCommit([threadComment('PRRC_1')], [restComment])).toBeNull();
    });

    it('ignores the commit of replies', () => {
      expect(
        threadCommit([threadComment('PRRC_1', 'root-commit'), threadComment('PRRC_2', 'reply-commit')]),
      ).toBe('root-commit');
    });

    it('is null when GitHub has no commit for the comment', () => {
      expect(threadCommit([threadComment('PRRC_1', null)])).toBeNull();
      expect(threadCommit([threadComment('PRRC_1')])).toBeNull();
      expect(threadCommit([])).toBeNull();
    });
  });
});

describe('transform: action from reactions', () => {
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

  // GitHub returns one group per reaction content, with viewerHasReacted
  // telling which of them the authenticated account left.
  const ALL_CONTENTS = [
    'THUMBS_UP',
    'THUMBS_DOWN',
    'LAUGH',
    'HOORAY',
    'CONFUSED',
    'HEART',
    'ROCKET',
    'EYES',
  ];
  const groups = (viewerContents: string[]): ReactionGroup[] =>
    ALL_CONTENTS.map((content) => ({
      content,
      viewerHasReacted: viewerContents.includes(content),
    }));

  const comment = (
    id: string,
    reactionGroups?: ReactionGroup[],
  ): ReviewThreadComment => ({
    id,
    body: 'comment',
    author: { login: 'reviewer' },
    createdAt: '2024-01-01T00:00:00Z',
    reactionGroups,
  });

  const thread = (
    comments: ReviewThreadComment[],
    overrides: Partial<ReviewThread> = {},
  ): ReviewThread => ({
    id: 'PRRT_1',
    isResolved: false,
    path: 'src/index.ts',
    line: 10,
    comments,
    ...overrides,
  });

  const threadAction = (reactionGroups?: ReactionGroup[], overrides: Partial<ReviewThread> = {}) => {
    const entries = transform(
      createMockData({ threads: [thread([comment('PRRC_1', reactionGroups)], overrides)] }),
    );
    return entries[0].action;
  };

  const issueComment = (reactionGroups?: ReactionGroup[]): IssueComment => ({
    id: 'IC_1',
    node_id: 'IC_1',
    author: { login: 'bot' },
    body: 'Auto review',
    createdAt: '2024-01-01T00:00:00Z',
    reactionGroups,
  });

  const issueCommentAction = (reactionGroups?: ReactionGroup[]) => {
    const entries = transform(createMockData({ issueComments: [issueComment(reactionGroups)] }));
    return entries[0].action;
  };

  describe('threads', () => {
    it.each([
      ['THUMBS_UP', 'done'],
      ['THUMBS_DOWN', 'skip'],
      ['EYES', 'fix'],
      ['HOORAY', 'done'],
      ['ROCKET', 'fix'],
    ])('reads the viewer reaction %s on an unresolved thread as %s', (content, action) => {
      expect(threadAction(groups([content]))).toBe(action);
    });

    it('prefers a later 👍 (done) over an earlier 👀 (fix)', () => {
      // GitHub lists reaction groups in a fixed order that does not follow
      // the order in which the viewer reacted.
      const eyesBeforeThumbsUp: ReactionGroup[] = [
        { content: 'EYES', viewerHasReacted: true },
        { content: 'THUMBS_UP', viewerHasReacted: true },
      ];
      const thumbsUpBeforeEyes = [...eyesBeforeThumbsUp].reverse();

      expect(threadAction(eyesBeforeThumbsUp)).toBe('done');
      expect(threadAction(thumbsUpBeforeEyes)).toBe('done');
    });

    it('stays pending when only other users reacted', () => {
      const othersOnly: ReactionGroup[] = ALL_CONTENTS.map((content) => ({
        content,
        viewerHasReacted: false,
      }));

      expect(threadAction(othersOnly)).toBe('pending');
      expect(threadAction(groups([]))).toBe('pending');
    });

    it('ignores other users even when the viewer has a different reaction', () => {
      const groupList: ReactionGroup[] = [
        { content: 'THUMBS_UP', viewerHasReacted: false },
        { content: 'EYES', viewerHasReacted: true },
      ];

      expect(threadAction(groupList)).toBe('fix');
    });

    it('stays pending without reaction groups', () => {
      expect(threadAction(undefined)).toBe('pending');
      expect(threadAction([])).toBe('pending');
    });

    it('reads only the first comment of the thread', () => {
      const entries = transform(
        createMockData({
          threads: [
            thread([
              comment('PRRC_1', groups([])),
              comment('PRRC_2', groups(['THUMBS_UP'])),
            ]),
          ],
        }),
      );

      expect(entries[0].action).toBe('pending');
    });

    it('keeps a resolved thread done whatever the viewer reacted with', () => {
      expect(threadAction(groups(['THUMBS_DOWN']), { isResolved: true })).toBe('done');
      expect(threadAction(groups([]), { isResolved: true })).toBe('done');
    });
  });

  describe('issue comments', () => {
    it.each([
      ['THUMBS_UP', 'done'],
      ['THUMBS_DOWN', 'skip'],
      ['EYES', 'fix'],
      ['HOORAY', 'done'],
      ['ROCKET', 'fix'],
    ])('reads the viewer reaction %s as %s', (content, action) => {
      expect(issueCommentAction(groups([content]))).toBe(action);
    });

    it('uses the same precedence as threads', () => {
      expect(issueCommentAction(groups(['EYES', 'THUMBS_UP']))).toBe('done');
      expect(issueCommentAction(groups(['EYES', 'THUMBS_DOWN']))).toBe('skip');
      expect(issueCommentAction(groups(['ROCKET', 'HOORAY']))).toBe('done');
    });

    it('stays pending when only other users reacted', () => {
      expect(issueCommentAction(groups([]))).toBe('pending');
      expect(issueCommentAction(undefined)).toBe('pending');
    });
  });

  describe('reviews', () => {
    const reviewWith = (reactionGroups?: ReactionGroup[]): Review => ({
      id: 'PRR_1',
      databaseId: 77,
      author: { login: 'reviewer' },
      state: 'CHANGES_REQUESTED',
      body: 'Please fix',
      commit: { oid: 'abc123' },
      submittedAt: '2024-01-01T00:00:00Z',
      reactionGroups,
    });

    // A review whose threads carry the given viewer reactions, and whose own
    // viewer reactions are the second argument
    const reviewAction = (threadReactions: ReactionGroup[][], reviewReactions?: ReactionGroup[]) => {
      const threads = threadReactions.map((reactionGroups, index) =>
        thread([comment(`PRRC_${index}`, reactionGroups)], { id: `PRRT_${index}` }),
      );
      const reviewComments: ReviewComment[] = threadReactions.map((_, index) => ({
        id: index + 1,
        node_id: `PRRC_${index}`,
        user: { login: 'reviewer' },
        body: 'comment',
        path: 'src/index.ts',
        line: 10,
        start_line: null,
        commit_id: 'abc123',
        original_commit_id: 'abc123',
        pull_request_review_id: 77,
        in_reply_to_id: null,
        created_at: '2024-01-01T00:00:00Z',
        html_url: 'https://github.com/owner/repo/pull/1#discussion_r1',
      }));

      const entries = transform(
        createMockData({ threads, reviews: [reviewWith(reviewReactions)], reviewComments }),
      );
      return entries.find((entry) => entry.type === 'review')!.action;
    };

    it('is done once every thread of the review is done through the viewer reactions', () => {
      expect(reviewAction([groups(['THUMBS_UP']), groups(['HOORAY'])])).toBe('done');
    });

    it('stays pending while a thread of the review is not done', () => {
      expect(reviewAction([groups(['THUMBS_UP']), groups(['EYES'])])).toBe('pending');
      expect(reviewAction([groups(['THUMBS_UP']), groups([])])).toBe('pending');
    });

    it.each([
      ['THUMBS_UP', 'done'],
      ['THUMBS_DOWN', 'skip'],
      ['EYES', 'fix'],
      ['HOORAY', 'done'],
      ['ROCKET', 'fix'],
    ])('reads the viewer reaction %s on the review itself as %s', (content, action) => {
      expect(reviewAction([], groups([content]))).toBe(action);
    });

    it('uses the same precedence as threads and issue comments', () => {
      expect(reviewAction([], groups(['EYES', 'THUMBS_UP']))).toBe('done');
      expect(reviewAction([], groups(['EYES', 'THUMBS_DOWN']))).toBe('skip');
      expect(reviewAction([], groups(['ROCKET', 'HOORAY']))).toBe('done');
    });

    it('uses the viewer reaction on the review instead of the state of its threads', () => {
      // every thread is done, the viewer marked the review as in progress
      expect(reviewAction([groups(['THUMBS_UP']), groups(['THUMBS_UP'])], groups(['EYES']))).toBe('fix');
      // a thread is still open, the viewer marked the review as done
      expect(reviewAction([groups(['THUMBS_UP']), groups([])], groups(['THUMBS_UP']))).toBe('done');
    });

    it('falls back to the state of its threads when the viewer left no reaction on the review', () => {
      expect(reviewAction([groups(['THUMBS_UP'])], groups([]))).toBe('done');
      expect(reviewAction([groups([])], groups([]))).toBe('pending');
      expect(reviewAction([groups(['THUMBS_UP'])], undefined)).toBe('done');
    });

    it('ignores reactions that other users left on the review', () => {
      const othersOnly: ReactionGroup[] = ALL_CONTENTS.map((content) => ({
        content,
        viewerHasReacted: false,
      }));

      expect(reviewAction([], othersOnly)).toBe('pending');
      expect(reviewAction([groups(['THUMBS_UP'])], othersOnly)).toBe('done');
    });

    it('stays pending for a review without threads and without reactions', () => {
      expect(reviewAction([], undefined)).toBe('pending');
      expect(reviewAction([], null as unknown as undefined)).toBe('pending');
    });
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
