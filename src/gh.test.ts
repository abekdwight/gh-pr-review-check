import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

import { execFileSync, execSync } from 'node:child_process';
import {
  buildGraphQLArgs,
  currentBranchPullRequestUrl,
  detectRepo,
  runGh,
  runGhGraphQL,
} from './gh.js';

const execFileSyncMock = vi.mocked(execFileSync) as unknown as ReturnType<typeof vi.fn>;

const HOSTILE_TEXT =
  'a `touch /tmp/pwned` $(touch /tmp/pwned) "double" \'single\' \\ ${HOME} ; | & > < !x\nsecond line';

describe('runGh', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('starts gh directly with the argument vector and no shell', () => {
    execFileSyncMock.mockReturnValue('ok');

    expect(runGh(['pr', 'view', '7'])).toBe('ok');

    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    const [file, args, options] = execFileSyncMock.mock.calls[0];
    expect(file).toBe('gh');
    expect(args).toEqual(['pr', 'view', '7']);
    expect(options).toMatchObject({ encoding: 'utf-8' });
    expect(options.shell).toBeFalsy();
    expect(execSync).not.toHaveBeenCalled();
  });

  it('hands over shell metacharacters inside an argument unchanged', () => {
    execFileSyncMock.mockReturnValue('');

    runGh(['pr', 'comment', '1', '--body', HOSTILE_TEXT]);

    const [, args] = execFileSyncMock.mock.calls[0];
    expect(args).toHaveLength(5);
    expect(args[4]).toBe(HOSTILE_TEXT);
  });

  it('reports gh stderr when the command fails', () => {
    execFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error('Command failed: gh'), { stderr: 'HTTP 404: Not Found' });
    });

    expect(() => runGh(['api', 'repos/o/r'])).toThrow('gh command failed: HTTP 404: Not Found');
  });

  it('falls back to the error message when gh wrote nothing to stderr', () => {
    execFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error('spawn gh ENOENT'), { stderr: '' });
    });

    expect(() => runGh(['api', 'user'])).toThrow('gh command failed: spawn gh ENOENT');
  });
});

describe('buildGraphQLArgs', () => {
  it('passes the query as a single -f argument', () => {
    const query = `query($owner: String!) {
      repository(owner: $owner) { name } # it's "quoted" and has \`backticks\` and $variables
    }`;

    const args = buildGraphQLArgs(query, {});

    expect(args).toEqual(['api', 'graphql', '-f', `query=${query}`]);
  });

  it('passes each variable as one argument, strings with -f and numbers with -F', () => {
    const args = buildGraphQLArgs('query { a }', {
      owner: 'octo',
      repo: 'repo',
      number: 123,
    });

    expect(args).toEqual([
      'api',
      'graphql',
      '-f',
      'query=query { a }',
      '-f',
      'owner=octo',
      '-f',
      'repo=repo',
      '-F',
      'number=123',
    ]);
  });

  it('skips undefined variables', () => {
    const args = buildGraphQLArgs('query { a }', { threadsAfter: undefined, owner: 'octo' });

    expect(args).toEqual(['api', 'graphql', '-f', 'query=query { a }', '-f', 'owner=octo']);
  });

  it('keeps a string variable a string even when it looks like a file, a boolean or a number', () => {
    const args = buildGraphQLArgs('query { a }', {
      cursor: '@/etc/passwd',
      flag: 'true',
      numeric: '123',
    });

    expect(args.slice(4)).toEqual([
      '-f',
      'cursor=@/etc/passwd',
      '-f',
      'flag=true',
      '-f',
      'numeric=123',
    ]);
  });

  it('keeps a comment body with shell metacharacters in one argument', () => {
    const args = buildGraphQLArgs('mutation { a }', { threadId: 'PRRT_1', body: HOSTILE_TEXT });

    expect(args).toHaveLength(8);
    expect(args[7]).toBe(`body=${HOSTILE_TEXT}`);
  });
});

describe('runGhGraphQL', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('runs gh api graphql with the built argument vector', () => {
    execFileSyncMock.mockReturnValue('{}');

    runGhGraphQL('query { a }', { owner: 'octo', number: 5 });

    expect(execFileSyncMock.mock.calls[0][0]).toBe('gh');
    expect(execFileSyncMock.mock.calls[0][1]).toEqual(
      buildGraphQLArgs('query { a }', { owner: 'octo', number: 5 }),
    );
    expect(execSync).not.toHaveBeenCalled();
  });
});

describe('detectRepo', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('asks gh for the repository as an argument vector and parses owner/repo', () => {
    execFileSyncMock.mockReturnValue('octo/repo\n');

    expect(detectRepo()).toEqual({ owner: 'octo', repo: 'repo' });

    expect(execFileSyncMock.mock.calls[0][0]).toBe('gh');
    expect(execFileSyncMock.mock.calls[0][1]).toEqual([
      'repo',
      'view',
      '--json',
      'owner,name',
      '-q',
      '.owner.login+"/"+.name',
    ]);
  });

  it('returns null when gh cannot resolve a repository', () => {
    execFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error('failed'), { stderr: 'not a git repository' });
    });

    expect(detectRepo()).toBeNull();
  });
});

describe('currentBranchPullRequestUrl', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('asks gh for the pull request of the current branch as an argument vector', () => {
    execFileSyncMock.mockReturnValue('https://github.com/octo/repo/pull/9\n');

    expect(currentBranchPullRequestUrl()).toBe('https://github.com/octo/repo/pull/9');

    expect(execFileSyncMock.mock.calls[0][0]).toBe('gh');
    expect(execFileSyncMock.mock.calls[0][1]).toEqual(['pr', 'view', '--json', 'url', '-q', '.url']);
  });
});
