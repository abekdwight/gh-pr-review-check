import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

import { execFileSync, execSync } from 'node:child_process';
import { detectEntryType, resolve, STATUS_REACTIONS } from './resolve.js';
import { getActionFromViewerReactions } from './reactions.js';

const execFileSyncMock = vi.mocked(execFileSync) as unknown as ReturnType<typeof vi.fn>;

const HOSTILE_BODY =
  'Fixed `rm -rf ~` and $(touch /tmp/pwned) with "quotes" and \'apostrophes\' \\ ${HOME}; echo done | cat\n- next line';

type GhCall = string[];

const calls = (): GhCall[] => execFileSyncMock.mock.calls.map((call) => call[1] as string[]);

const queryOf = (args: string[]): string => {
  const pair = args.find((arg) => arg.startsWith('query='));
  expect(pair).toBeDefined();
  return pair!.slice('query='.length);
};

/**
 * Fake gh: answers the lookup queries of resolve and records every call.
 */
const fakeGh = () => {
  execFileSyncMock.mockImplementation((_file: string, args: string[]) => {
    const text = args.join('\n');
    if (text.includes('comments(first: 1)')) {
      return JSON.stringify({ data: { node: { comments: { nodes: [{ databaseId: 555 }] } } } });
    }
    if (text.includes('databaseId')) {
      return JSON.stringify({ data: { node: { id: 'IC_1', databaseId: 777 } } });
    }
    if (text.includes('issue {')) {
      return JSON.stringify({ data: { node: { issue: { number: 42 } } } });
    }
    return '{}';
  });
};

describe('resolve', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fakeGh();
  });

  it('adds the reaction to the first comment of a thread', () => {
    resolve({ owner: 'octo', repo: 'repo', entryId: 'PRRT_abc', status: 'done' });

    expect(calls()).toHaveLength(2);
    expect(calls()[0].slice(0, 2)).toEqual(['api', 'graphql']);
    expect(calls()[0]).toContain('threadId=PRRT_abc');
    expect(calls()[1]).toEqual([
      'api',
      '--method',
      'POST',
      'repos/octo/repo/pulls/comments/555/reactions',
      '-f',
      'content=+1',
    ]);
    expect(execSync).not.toHaveBeenCalled();
  });

  it('adds the reaction to a PR-level comment through its database ID', () => {
    resolve({ owner: 'octo', repo: 'repo', entryId: 'IC_kwDOabc', status: 'skip' });

    expect(calls()).toHaveLength(2);
    expect(calls()[0]).toContain('nodeId=IC_kwDOabc');
    expect(calls()[1]).toEqual([
      'api',
      '--method',
      'POST',
      'repos/octo/repo/issues/comments/777/reactions',
      '-f',
      'content=-1',
    ]);
  });

  it('writes the eyes reaction for in_progress', () => {
    resolve({ owner: 'octo', repo: 'repo', entryId: 'PRRT_abc', status: 'in_progress' });

    expect(calls()[1]).toContain('content=eyes');
  });

  it('sends a thread reply body as exactly one argument', () => {
    resolve({
      owner: 'octo',
      repo: 'repo',
      entryId: 'PRRT_abc',
      status: 'done',
      comment: HOSTILE_BODY,
    });

    const reply = calls()[2];
    expect(reply.slice(0, 2)).toEqual(['api', 'graphql']);
    expect(queryOf(reply)).toContain('addPullRequestReviewThreadReply');
    expect(reply.filter((arg) => arg.startsWith('body='))).toEqual([`body=${HOSTILE_BODY}`]);
    expect(reply).toContain('threadId=PRRT_abc');
    expect(reply).toHaveLength(8);
    expect(execSync).not.toHaveBeenCalled();
  });

  it('sends a PR comment body as exactly one argument', () => {
    resolve({
      owner: 'octo',
      repo: 'repo',
      entryId: 'IC_kwDOabc',
      status: 'done',
      comment: HOSTILE_BODY,
    });

    // reaction lookup, reaction, issue lookup, comment
    expect(calls()).toHaveLength(4);
    expect(calls()[3]).toEqual(['pr', 'comment', '42', '--repo', 'octo/repo', '--body', HOSTILE_BODY]);
    expect(execSync).not.toHaveBeenCalled();
  });

  it('does not post a comment when none is given', () => {
    resolve({ owner: 'octo', repo: 'repo', entryId: 'PRRT_abc', status: 'done' });

    expect(calls().some((args) => args.includes('pr'))).toBe(false);
    expect(calls().some((args) => args.some((arg) => arg.startsWith('body=')))).toBe(false);
  });

  it('refuses reviews', () => {
    expect(() =>
      resolve({ owner: 'octo', repo: 'repo', entryId: 'PRR_abc', status: 'done' }),
    ).toThrow('Reviews cannot be resolved directly');
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });
});

describe('detectEntryType', () => {
  it('detects the entry type from the node ID prefix', () => {
    expect(detectEntryType('PRRT_abc')).toBe('thread');
    expect(detectEntryType('PRR_abc')).toBe('review');
    expect(detectEntryType('IC_abc')).toBe('issue_comment');
  });
});

describe('STATUS_REACTIONS', () => {
  // GraphQL enum name of each reaction that resolve writes through REST.
  const GRAPHQL_NAME: Record<string, string> = { '+1': 'THUMBS_UP', '-1': 'THUMBS_DOWN', eyes: 'EYES' };

  it.each([
    ['done', 'done'],
    ['skip', 'skip'],
    ['in_progress', 'fix'],
  ] as const)('is read back as the matching action: resolve -s %s gives action %s', (status, action) => {
    const written = STATUS_REACTIONS[status];

    expect(
      getActionFromViewerReactions([{ content: GRAPHQL_NAME[written], viewerHasReacted: true }]),
    ).toBe(action);
  });
});
