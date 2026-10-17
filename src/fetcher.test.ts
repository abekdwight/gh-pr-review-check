import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

import { execFileSync, execSync } from 'node:child_process';
import {
  fetchAll,
  fetchIssueComments,
  fetchPRMeta,
  fetchReviews,
  fetchReviewThreads,
} from './fetcher.js';
import { transform } from './transformer.js';
import type { FetchedData, ReactionGroup } from './types.js';

const execFileSyncMock = vi.mocked(execFileSync) as unknown as ReturnType<typeof vi.fn>;

const config = { owner: 'octo', repo: 'repo', prNumber: 7 };

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

// The group list GitHub returns: every content, with the viewer's marked.
const groups = (viewerContents: string[] = []): ReactionGroup[] =>
  ALL_CONTENTS.map((content) => ({
    content,
    viewerHasReacted: viewerContents.includes(content),
  }));

const NO_NEXT_PAGE = { hasNextPage: false, endCursor: null };

const useFakeGh = (handler: (args: string[]) => string) => {
  execFileSyncMock.mockImplementation((_file: string, args: string[]) => handler(args));
};

const calls = (): string[][] => execFileSyncMock.mock.calls.map((call) => call[1] as string[]);

const parseGraphQLCall = (args: string[]) => {
  expect(args.slice(0, 2)).toEqual(['api', 'graphql']);
  const variables: Record<string, string> = {};
  const flags: Record<string, string> = {};
  let query = '';
  for (let index = 2; index < args.length; index += 2) {
    const flag = args[index];
    const pair = args[index + 1];
    expect(['-f', '-F']).toContain(flag);
    const separator = pair.indexOf('=');
    const key = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    flags[key] = flag;
    if (key === 'query') {
      query = value;
    } else {
      variables[key] = value;
    }
  }
  return { query, variables, flags };
};

const commentNode = (
  id: string,
  reactionGroups: ReactionGroup[],
  commitOid: string | null = 'c0ffee',
) => ({
  id,
  body: 'body',
  author: { login: 'reviewer' },
  createdAt: '2024-01-01T00:00:00Z',
  commit: commitOid === null ? null : { oid: commitOid },
  pullRequestReview: { state: 'COMMENTED' },
  reactionGroups,
});

const threadNode = (
  id: string,
  comments: ReturnType<typeof commentNode>[],
  commentsPageInfo: { hasNextPage: boolean; endCursor: string | null } = NO_NEXT_PAGE,
) => ({
  id,
  isResolved: false,
  path: 'src/a.ts',
  line: 1,
  comments: { nodes: comments, pageInfo: commentsPageInfo },
});

const threadsResponse = (
  threads: ReturnType<typeof threadNode>[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null } = NO_NEXT_PAGE,
) =>
  JSON.stringify({
    data: {
      repository: {
        pullRequest: { reviewThreads: { totalCount: threads.length, nodes: threads, pageInfo } },
      },
    },
  });

const threadCommentsResponse = (
  comments: ReturnType<typeof commentNode>[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null } = NO_NEXT_PAGE,
) => JSON.stringify({ data: { node: { comments: { nodes: comments, pageInfo } } } });

// Response of the query that reads the reactions of PR-level comments or reviews
const reactionNodesResponse = (
  connection: 'comments' | 'reviews',
  nodes: Array<{ id: string; reactionGroups: ReactionGroup[] }>,
  pageInfo: { hasNextPage: boolean; endCursor: string | null } = NO_NEXT_PAGE,
) =>
  JSON.stringify({
    data: { repository: { pullRequest: { [connection]: { nodes, pageInfo } } } },
  });

// Which connection (comments or reviews) a reaction-nodes query asks for, if it is one
const reactionNodesConnectionOf = (query: string): 'comments' | 'reviews' | null => {
  const match = query.match(
    /pullRequest\(number: \$number\)\s*\{\s*(comments|reviews)\(first: 100, after: \$after\)/,
  );
  return match ? (match[1] as 'comments' | 'reviews') : null;
};

const restIssueComment = (nodeId: string, reactions: Record<string, number> = {}) => ({
  node_id: nodeId,
  user: { login: 'bot' },
  body: `body of ${nodeId}`,
  created_at: '2024-01-01T00:00:00Z',
  reactions: { url: 'https://api.github.com/x', total_count: 0, ...reactions },
});

const restReview = (nodeId: string, id: number) => ({
  id,
  node_id: nodeId,
  user: { login: 'reviewer' },
  body: `body of ${nodeId}`,
  state: 'COMMENTED',
  commit_id: 'abc123',
  submitted_at: '2024-01-01T00:00:00Z',
});

const isRestListCall = (args: string[]) => args[0] === 'api' && args[1] === '--paginate';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('fetchPRMeta', () => {
  it('passes the repository and the fields as separate arguments', () => {
    useFakeGh(() => JSON.stringify({ number: 7 }));

    fetchPRMeta(config);

    expect(execFileSyncMock.mock.calls[0][0]).toBe('gh');
    expect(calls()[0]).toEqual([
      'pr',
      'view',
      '7',
      '--repo',
      'octo/repo',
      '--json',
      'number,title,state,headRefName,baseRefName,headRefOid',
    ]);
  });
});

describe('fetchReviewThreads', () => {
  it('asks for the commit and the reactions the viewer left on every comment', () => {
    useFakeGh(() =>
      threadsResponse([
        threadNode('PRRT_1', [commentNode('PRRC_1', groups(['THUMBS_DOWN']), 'abc123')]),
      ]),
    );

    const { threads } = fetchReviewThreads(config);

    const { query, variables, flags } = parseGraphQLCall(calls()[0]);
    expect(query).toMatch(/commit\s*\{\s*oid\s*\}/);
    expect(query).toMatch(/reactionGroups\s*\{\s*content\s+viewerHasReacted\s*\}/);
    expect(query).not.toContain('reactions(');
    expect(variables).toMatchObject({ owner: 'octo', repo: 'repo', number: '7' });
    expect(flags.number).toBe('-F');
    expect(flags.owner).toBe('-f');
    expect(threads[0].comments[0].reactionGroups).toEqual(groups(['THUMBS_DOWN']));
    expect(threads[0].comments[0].commit).toEqual({ oid: 'abc123' });
  });

  it('keeps the commit and the reactionGroups of every comment across thread pages and comment pages', () => {
    const handler = (args: string[]): string => {
      const { query, variables } = parseGraphQLCall(args);

      if (query.includes('node(id: $threadId)')) {
        expect(variables).toMatchObject({ threadId: 'PRRT_1', commentsAfter: 'comments-cursor' });
        expect(query).toMatch(/commit\s*\{\s*oid\s*\}/);
        expect(query).toMatch(/reactionGroups\s*\{\s*content\s+viewerHasReacted\s*\}/);
        expect(query).not.toContain('reactions(');
        return threadCommentsResponse([commentNode('PRRC_1b', groups(['EYES']), 'bbb')]);
      }

      if (variables.threadsAfter === 'threads-cursor') {
        return threadsResponse([
          threadNode('PRRT_2', [commentNode('PRRC_2a', groups(['THUMBS_UP']), 'ccc')]),
        ]);
      }

      return threadsResponse(
        [
          threadNode('PRRT_1', [commentNode('PRRC_1a', groups(['THUMBS_DOWN']), 'aaa')], {
            hasNextPage: true,
            endCursor: 'comments-cursor',
          }),
        ],
        { hasNextPage: true, endCursor: 'threads-cursor' },
      );
    };
    useFakeGh(handler);

    const { threads } = fetchReviewThreads(config);

    expect(calls()).toHaveLength(3);
    expect(threads.map((thread) => thread.id)).toEqual(['PRRT_1', 'PRRT_2']);
    expect(threads[0].comments.map((comment) => comment.id)).toEqual(['PRRC_1a', 'PRRC_1b']);
    expect(threads[0].comments[0].reactionGroups).toEqual(groups(['THUMBS_DOWN']));
    expect(threads[0].comments[1].reactionGroups).toEqual(groups(['EYES']));
    expect(threads[1].comments[0].reactionGroups).toEqual(groups(['THUMBS_UP']));
    expect(threads.map((thread) => thread.comments.map((comment) => comment.commit?.oid))).toEqual([
      ['aaa', 'bbb'],
      ['ccc'],
    ]);
  });

  it('makes an unresolved thread done through the viewer 👍 once transformed', () => {
    useFakeGh(() =>
      threadsResponse([
        threadNode('PRRT_1', [commentNode('PRRC_1', groups(['EYES', 'THUMBS_UP']))]),
        threadNode('PRRT_2', [commentNode('PRRC_2', groups([]))]),
      ]),
    );

    const { threads } = fetchReviewThreads(config);
    const entries = transform({ threads, reviews: [], issueComments: [], reviewComments: [] } as unknown as FetchedData);

    expect(entries.map((entry) => entry.action)).toEqual(['done', 'pending']);
  });

  it('puts the commit of the first comment on the thread entry, without any REST data', () => {
    useFakeGh(() =>
      threadsResponse([
        threadNode('PRRT_1', [
          commentNode('PRRC_kwDOPPCZqM7nxA5p', groups(), 'ee9f222e'),
          commentNode('PRRC_kwDOPPCZqM7nxA5q', groups(), 'reply-commit'),
        ]),
        threadNode('PRRT_2', [commentNode('PRRC_kwDOPPCZqM7nxA5r', groups(), null)]),
      ]),
    );

    const { threads } = fetchReviewThreads(config);
    const entries = transform({ threads, reviews: [], issueComments: [], reviewComments: [] } as unknown as FetchedData);

    expect(entries.map((entry) => (entry.type === 'thread' ? entry.commit : 'not a thread'))).toEqual([
      'ee9f222e',
      null,
    ]);
  });
});

describe('fetchReviews', () => {
  it('reads the review list through REST with the endpoint as one argument', () => {
    useFakeGh((args) =>
      isRestListCall(args)
        ? JSON.stringify([[restReview('PRR_1', 1)]])
        : reactionNodesResponse('reviews', [{ id: 'PRR_1', reactionGroups: groups() }]),
    );

    fetchReviews(config);

    expect(calls()[0]).toEqual(['api', '--paginate', '--slurp', 'repos/octo/repo/pulls/7/reviews']);
  });

  it('reads the reactions the viewer left on the reviews', () => {
    useFakeGh((args) => {
      if (isRestListCall(args)) {
        return JSON.stringify([[restReview('PRR_up', 1), restReview('PRR_none', 2), restReview('PRR_down_eyes', 3)]]);
      }
      const { query } = parseGraphQLCall(args);
      expect(reactionNodesConnectionOf(query)).toBe('reviews');
      return reactionNodesResponse('reviews', [
        { id: 'PRR_up', reactionGroups: groups(['THUMBS_UP']) },
        { id: 'PRR_none', reactionGroups: groups([]) },
        { id: 'PRR_down_eyes', reactionGroups: groups(['EYES', 'THUMBS_DOWN']) },
      ]);
    });

    const reviews = fetchReviews(config);
    const entries = transform({
      threads: [],
      reviews,
      issueComments: [],
      reviewComments: [],
    } as unknown as FetchedData);

    expect(reviews.map((review) => review.databaseId)).toEqual([1, 2, 3]);
    expect(entries.map((entry) => [entry.id, entry.action])).toEqual([
      ['PRR_up', 'done'],
      ['PRR_none', 'pending'],
      ['PRR_down_eyes', 'skip'],
    ]);
  });

  it('reads the reactions one GraphQL request per 100 reviews, not one request per review', () => {
    const total = 250;
    const ids = Array.from({ length: total }, (_, index) => `PRR_${index}`);
    const seenCursors: Array<string | undefined> = [];

    useFakeGh((args) => {
      if (isRestListCall(args)) {
        return JSON.stringify([ids.map((id, index) => restReview(id, index + 1))]);
      }

      const { query, variables } = parseGraphQLCall(args);
      expect(reactionNodesConnectionOf(query)).toBe('reviews');
      seenCursors.push(variables.after);
      const start = variables.after ? Number(variables.after.replace('cursor-', '')) : 0;
      const end = Math.min(start + 100, total);
      return reactionNodesResponse(
        'reviews',
        ids.slice(start, end).map((id) => ({ id, reactionGroups: groups(id === 'PRR_249' ? ['THUMBS_UP'] : []) })),
        end < total ? { hasNextPage: true, endCursor: `cursor-${end}` } : NO_NEXT_PAGE,
      );
    });

    const reviews = fetchReviews(config);

    // 1 REST request for the list + 3 GraphQL requests for 250 reviews
    expect(calls()).toHaveLength(4);
    expect(seenCursors).toEqual([undefined, 'cursor-100', 'cursor-200']);
    expect(reviews).toHaveLength(total);
    expect(reviews[249].reactionGroups).toEqual(groups(['THUMBS_UP']));
    expect(reviews[0].reactionGroups).toEqual(groups([]));
  });

  it('treats a review that GraphQL did not return as having no viewer reaction', () => {
    useFakeGh((args) =>
      isRestListCall(args)
        ? JSON.stringify([[restReview('PRR_known', 1), restReview('PRR_new', 2)]])
        : reactionNodesResponse('reviews', [{ id: 'PRR_known', reactionGroups: groups(['THUMBS_UP']) }]),
    );

    const reviews = fetchReviews(config);

    expect(reviews.map((review) => review.reactionGroups)).toEqual([groups(['THUMBS_UP']), []]);
  });

  it('keeps the fields REST provides', () => {
    useFakeGh((args) =>
      isRestListCall(args)
        ? JSON.stringify([[restReview('PRR_1', 11)]])
        : reactionNodesResponse('reviews', [{ id: 'PRR_1', reactionGroups: groups() }]),
    );

    expect(fetchReviews(config)[0]).toMatchObject({
      id: 'PRR_1',
      databaseId: 11,
      author: { login: 'reviewer' },
      state: 'COMMENTED',
      body: 'body of PRR_1',
      commit: { oid: 'abc123' },
      submittedAt: '2024-01-01T00:00:00Z',
    });
  });

  it('fails as a partial GraphQL collection when GraphQL reports errors', () => {
    useFakeGh((args) =>
      isRestListCall(args)
        ? JSON.stringify([[restReview('PRR_1', 1)]])
        : JSON.stringify({ data: null, errors: [{ message: 'boom' }] }),
    );

    expect(() => fetchReviews(config)).toThrowError(
      expect.objectContaining({ name: 'GRAPHQL_PARTIAL_DATA' }),
    );
  });
});

describe('fetchIssueComments', () => {
  it('reads the comment list through REST with the endpoint as one argument', () => {
    useFakeGh((args) =>
      isRestListCall(args)
        ? JSON.stringify([[restIssueComment('IC_1')]])
        : reactionNodesResponse('comments', [{ id: 'IC_1', reactionGroups: groups() }]),
    );

    fetchIssueComments(config);

    expect(calls()[0]).toEqual(['api', '--paginate', '--slurp', 'repos/octo/repo/issues/7/comments']);
  });

  it('uses the reactions the viewer left, not the reaction counts that REST reports', () => {
    useFakeGh((args) => {
      if (isRestListCall(args)) {
        return JSON.stringify([
          [
            // others reacted: REST counts 👍 and 👀, the viewer reacted with nothing
            restIssueComment('IC_others', { '+1': 3, eyes: 1 }),
            restIssueComment('IC_viewer_up', { '+1': 1 }),
            restIssueComment('IC_viewer_down_and_bot_eyes', { '-1': 1, eyes: 1 }),
          ],
        ]);
      }
      const { query } = parseGraphQLCall(args);
      expect(reactionNodesConnectionOf(query)).toBe('comments');
      return reactionNodesResponse('comments', [
        { id: 'IC_others', reactionGroups: groups([]) },
        { id: 'IC_viewer_up', reactionGroups: groups(['THUMBS_UP']) },
        { id: 'IC_viewer_down_and_bot_eyes', reactionGroups: groups(['THUMBS_DOWN']) },
      ]);
    });

    const issueComments = fetchIssueComments(config);
    const entries = transform({
      threads: [],
      reviews: [],
      issueComments,
      reviewComments: [],
    } as unknown as FetchedData);

    expect(entries.map((entry) => [entry.id, entry.action])).toEqual([
      ['IC_others', 'pending'],
      ['IC_viewer_up', 'done'],
      ['IC_viewer_down_and_bot_eyes', 'skip'],
    ]);
  });

  it('reads the reactions one GraphQL request per 100 comments, not one request per comment', () => {
    const total = 250;
    const ids = Array.from({ length: total }, (_, index) => `IC_${index}`);
    const seenCursors: Array<string | undefined> = [];

    useFakeGh((args) => {
      if (isRestListCall(args)) {
        return JSON.stringify([ids.map((id) => restIssueComment(id))]);
      }

      const { query, variables } = parseGraphQLCall(args);
      expect(reactionNodesConnectionOf(query)).toBe('comments');
      seenCursors.push(variables.after);
      const start = variables.after ? Number(variables.after.replace('cursor-', '')) : 0;
      const end = Math.min(start + 100, total);
      return reactionNodesResponse(
        'comments',
        ids.slice(start, end).map((id) => ({ id, reactionGroups: groups(id === 'IC_249' ? ['EYES'] : []) })),
        end < total ? { hasNextPage: true, endCursor: `cursor-${end}` } : NO_NEXT_PAGE,
      );
    });

    const issueComments = fetchIssueComments(config);

    // 1 REST request for the list + 3 GraphQL requests for 250 comments
    expect(calls()).toHaveLength(4);
    expect(seenCursors).toEqual([undefined, 'cursor-100', 'cursor-200']);
    expect(issueComments).toHaveLength(total);
    expect(issueComments[249].reactionGroups).toEqual(groups(['EYES']));
    expect(issueComments[0].reactionGroups).toEqual(groups([]));
  });

  it('treats a comment that GraphQL did not return as having no viewer reaction', () => {
    useFakeGh((args) =>
      isRestListCall(args)
        ? JSON.stringify([[restIssueComment('IC_known'), restIssueComment('IC_new')]])
        : reactionNodesResponse('comments', [{ id: 'IC_known', reactionGroups: groups(['THUMBS_UP']) }]),
    );

    const issueComments = fetchIssueComments(config);

    expect(issueComments.map((comment) => comment.reactionGroups)).toEqual([groups(['THUMBS_UP']), []]);
  });

  it('fails as a partial GraphQL collection when GraphQL reports errors', () => {
    useFakeGh((args) =>
      isRestListCall(args)
        ? JSON.stringify([[restIssueComment('IC_1')]])
        : JSON.stringify({ data: null, errors: [{ message: 'boom' }] }),
    );

    expect(() => fetchIssueComments(config)).toThrowError(
      expect.objectContaining({ name: 'GRAPHQL_PARTIAL_DATA' }),
    );
  });
});

describe('fetchAll', () => {
  it('only reads from GitHub and never goes through a shell', () => {
    useFakeGh((args) => {
      if (args[0] === 'pr') {
        return JSON.stringify({
          number: 7,
          title: 't',
          state: 'OPEN',
          headRefName: 'f',
          baseRefName: 'main',
          headRefOid: 'abc',
        });
      }

      if (args[1] === 'graphql') {
        const { query } = parseGraphQLCall(args);
        if (query.includes('reviewThreads(')) {
          return threadsResponse([threadNode('PRRT_1', [commentNode('PRRC_1', groups())])]);
        }
        const connection = reactionNodesConnectionOf(query);
        expect(connection).not.toBeNull();
        return connection === 'reviews'
          ? reactionNodesResponse('reviews', [{ id: 'PRR_1', reactionGroups: groups() }])
          : reactionNodesResponse('comments', [{ id: 'IC_1', reactionGroups: groups() }]);
      }

      const endpoint = args[args.length - 1];
      if (endpoint.endsWith('/pulls/7/reviews')) {
        return JSON.stringify([[restReview('PRR_1', 1)]]);
      }
      if (endpoint.endsWith('/issues/7/comments')) {
        return JSON.stringify([[restIssueComment('IC_1')]]);
      }
      return '[[]]';
    });

    const data = fetchAll(config, true);

    expect(data.threads).toHaveLength(1);
    expect(data.reviews).toHaveLength(1);
    expect(data.issueComments).toHaveLength(1);

    // pr view, threads, reviews (REST + GraphQL), PR comments (REST + GraphQL), review comments
    expect(calls()).toHaveLength(7);
    for (const args of calls()) {
      const isPrView = args[0] === 'pr' && args[1] === 'view';
      const isApi = args[0] === 'api';
      expect(isPrView || isApi).toBe(true);
      expect(args).not.toContain('--method');
      expect(args).not.toContain('-X');
      expect(args).not.toContain('POST');

      if (args[1] === 'graphql') {
        const { query } = parseGraphQLCall(args);
        expect(query.trim().startsWith('query')).toBe(true);
        expect(query).not.toMatch(/mutation/i);
      }
    }
    for (const call of execFileSyncMock.mock.calls) {
      expect(call[0]).toBe('gh');
    }
    expect(execSync).not.toHaveBeenCalled();
  });
});
