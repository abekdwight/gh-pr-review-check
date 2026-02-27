import { describe, it, expect } from 'vitest';
import { parsePRUrl } from './utils.js';

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
