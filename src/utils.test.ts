import { beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

import { execFileSync, execSync } from 'node:child_process';
import { detectRepo, parsePRUrl } from './utils.js';

const execFileSyncMock = vi.mocked(execFileSync) as unknown as ReturnType<typeof vi.fn>;

describe('parsePRUrl', () => {
  it('parses full GitHub URL', () => {
    const result = parsePRUrl('https://github.com/owner/repo/pull/123');
    expect(result).toEqual({ owner: 'owner', repo: 'repo', prNumber: 123 });
  });

  it('parses GitHub URL with www', () => {
    const result = parsePRUrl('https://www.github.com/owner/repo/pull/456');
    expect(result).toEqual({ owner: 'owner', repo: 'repo', prNumber: 456 });
  });

  it('parses GitHub URL with trailing slash', () => {
    const result = parsePRUrl('https://github.com/owner/repo/pull/789/');
    expect(result).toEqual({ owner: 'owner', repo: 'repo', prNumber: 789 });
  });

  it('parses GitHub URL with query params', () => {
    const result = parsePRUrl('https://github.com/owner/repo/pull/100?foo=bar');
    expect(result).toEqual({ owner: 'owner', repo: 'repo', prNumber: 100 });
  });

  it('throws on invalid URL', () => {
    expect(() => parsePRUrl('https://github.com/owner/repo')).toThrow();
    expect(() => parsePRUrl('not-a-url')).toThrow();
  });
});

describe('detectRepo', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('reads the origin URL by starting git directly with an argument vector', () => {
    execFileSyncMock.mockReturnValue('git@github.com:owner/repo.git\n');

    expect(detectRepo()).toEqual({ owner: 'owner', repo: 'repo' });

    expect(execFileSyncMock.mock.calls[0][0]).toBe('git');
    expect(execFileSyncMock.mock.calls[0][1]).toEqual(['remote', 'get-url', 'origin']);
    expect(execSync).not.toHaveBeenCalled();
  });

  it('parses an https origin URL', () => {
    execFileSyncMock.mockReturnValue('https://github.com/owner/repo.git\n');

    expect(detectRepo()).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('returns null outside a git repository', () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repository');
    });

    expect(detectRepo()).toBeNull();
  });
});
