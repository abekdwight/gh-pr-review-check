import { describe, it, expect } from 'vitest';
import {
  getActionFromViewerReactions,
  normalizeReactionContent,
} from './reactions.js';
import type { ReactionGroup } from './types.js';

const viewer = (content: string): ReactionGroup => ({ content, viewerHasReacted: true });
const other = (content: string): ReactionGroup => ({ content, viewerHasReacted: false });

const permutations = <T>(items: T[]): T[][] => {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
  );
};

describe('normalizeReactionContent', () => {
  it.each([
    ['THUMBS_UP', '+1'],
    ['THUMBS_DOWN', '-1'],
    ['LAUGH', 'laugh'],
    ['HOORAY', 'hooray'],
    ['CONFUSED', 'confused'],
    ['HEART', 'heart'],
    ['ROCKET', 'rocket'],
    ['EYES', 'eyes'],
  ])('maps the GraphQL enum name %s to the REST name %s', (graphqlName, restName) => {
    expect(normalizeReactionContent(graphqlName)).toBe(restName);
  });

  it('keeps REST names as they are', () => {
    for (const restName of ['+1', '-1', 'laugh', 'hooray', 'confused', 'heart', 'rocket', 'eyes']) {
      expect(normalizeReactionContent(restName)).toBe(restName);
    }
  });

  it('ignores letter case of names that are not enum names', () => {
    expect(normalizeReactionContent('Eyes')).toBe('eyes');
  });
});

describe('getActionFromViewerReactions', () => {
  it.each([
    ['THUMBS_UP', 'done'],
    ['HOORAY', 'done'],
    ['THUMBS_DOWN', 'skip'],
    ['EYES', 'fix'],
    ['ROCKET', 'fix'],
  ])('reads the viewer reaction %s as %s', (content, action) => {
    expect(getActionFromViewerReactions([viewer(content)])).toBe(action);
  });

  it('reads REST reaction names the same way as GraphQL enum names', () => {
    expect(getActionFromViewerReactions([viewer('+1')])).toBe('done');
    expect(getActionFromViewerReactions([viewer('-1')])).toBe('skip');
    expect(getActionFromViewerReactions([viewer('eyes')])).toBe('fix');
    expect(getActionFromViewerReactions([viewer('hooray')])).toBe('done');
    expect(getActionFromViewerReactions([viewer('rocket')])).toBe('fix');
  });

  it('ignores reactions that carry no status', () => {
    expect(
      getActionFromViewerReactions([viewer('LAUGH'), viewer('CONFUSED'), viewer('HEART')]),
    ).toBeNull();
  });

  it('prefers done over skip over fix whatever order the reactions arrive in', () => {
    for (const groups of permutations([viewer('THUMBS_UP'), viewer('THUMBS_DOWN'), viewer('EYES')])) {
      expect(getActionFromViewerReactions(groups)).toBe('done');
    }
    for (const groups of permutations([viewer('THUMBS_DOWN'), viewer('EYES')])) {
      expect(getActionFromViewerReactions(groups)).toBe('skip');
    }
    for (const groups of permutations([viewer('HOORAY'), viewer('ROCKET')])) {
      expect(getActionFromViewerReactions(groups)).toBe('done');
    }
    for (const groups of permutations([viewer('ROCKET'), viewer('EYES')])) {
      expect(getActionFromViewerReactions(groups)).toBe('fix');
    }
  });

  it('uses only the reactions the viewer left', () => {
    expect(getActionFromViewerReactions([other('THUMBS_UP')])).toBeNull();
    expect(getActionFromViewerReactions([other('THUMBS_UP'), viewer('EYES')])).toBe('fix');
    expect(getActionFromViewerReactions([viewer('THUMBS_DOWN'), other('THUMBS_UP')])).toBe('skip');
  });

  it('reads the full group list GitHub returns, where untouched contents have viewerHasReacted false', () => {
    const contents = ['THUMBS_UP', 'THUMBS_DOWN', 'LAUGH', 'HOORAY', 'CONFUSED', 'HEART', 'ROCKET', 'EYES'];

    expect(getActionFromViewerReactions(contents.map(other))).toBeNull();
    expect(
      getActionFromViewerReactions(
        contents.map((content) => ({ content, viewerHasReacted: content === 'THUMBS_DOWN' })),
      ),
    ).toBe('skip');
  });

  it('returns null when there are no reaction groups', () => {
    expect(getActionFromViewerReactions(undefined)).toBeNull();
    expect(getActionFromViewerReactions(null)).toBeNull();
    expect(getActionFromViewerReactions([])).toBeNull();
  });
});
