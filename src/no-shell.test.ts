import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runGh } from './gh.js';
import { resolve } from './resolve.js';

/**
 * These tests start a real process: a fake `gh` executable placed first on
 * PATH records the arguments it receives. If any argument went through a
 * shell, the backticks and $( ) in the text below would run `touch` and leave
 * a canary file behind, and the recorded arguments would differ.
 */
describe.skipIf(process.platform === 'win32')('gh is started without a shell', () => {
  let dir: string;
  let logFile: string;
  let canaryA: string;
  let canaryB: string;
  let hostileBody: string;
  const originalPath = process.env.PATH;

  const FAKE_GH = `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'fail') {
  process.stderr.write('simulated failure\\n');
  process.exit(1);
}
const text = args.join('\\n');
let out = '{}';
if (text.includes('comments(first: 1)')) {
  out = JSON.stringify({ data: { node: { comments: { nodes: [{ databaseId: 555 }] } } } });
} else if (text.includes('databaseId')) {
  out = JSON.stringify({ data: { node: { id: 'IC_1', databaseId: 777 } } });
} else if (text.includes('issue {')) {
  out = JSON.stringify({ data: { node: { issue: { number: 42 } } } });
}
process.stdout.write(out);
`;

  const recordedCalls = (): string[][] =>
    fs
      .readFileSync(logFile, 'utf-8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as string[]);

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-gh-'));
    logFile = path.join(dir, 'calls.jsonl');
    canaryA = path.join(dir, 'canary-backtick');
    canaryB = path.join(dir, 'canary-substitution');
    hostileBody = `done \`touch ${canaryA}\` and $(touch ${canaryB}) "q" 'a' \\ \${HOME}; echo x | cat\nsecond line`;

    fs.writeFileSync(path.join(dir, 'fake-gh.cjs'), FAKE_GH);
    fs.writeFileSync(
      path.join(dir, 'gh'),
      `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'fake-gh.cjs')}" "$@"\n`,
      { mode: 0o755 },
    );
    process.env.PATH = `${dir}${path.delimiter}${originalPath}`;
    process.env.FAKE_GH_LOG = logFile;
  });

  afterAll(() => {
    process.env.PATH = originalPath;
    delete process.env.FAKE_GH_LOG;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fs.writeFileSync(logFile, '');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const expectNothingWasExecuted = () => {
    expect(fs.existsSync(canaryA)).toBe(false);
    expect(fs.existsSync(canaryB)).toBe(false);
  };

  it('runGh delivers an argument with shell metacharacters unchanged and runs nothing', () => {
    runGh(['pr', 'comment', '1', '--body', hostileBody]);

    expect(recordedCalls()).toEqual([['pr', 'comment', '1', '--body', hostileBody]]);
    expectNothingWasExecuted();
  });

  it('runGh reports the stderr of a failing gh', () => {
    expect(() => runGh(['fail'])).toThrow('gh command failed: simulated failure');
  });

  it('resolve -c on a thread delivers the reply body unchanged and runs nothing', () => {
    resolve({
      owner: 'octo',
      repo: 'repo',
      entryId: 'PRRT_abc',
      status: 'done',
      comment: hostileBody,
    });

    const reply = recordedCalls().find((args) =>
      args.some((arg) => arg.includes('addPullRequestReviewThreadReply')),
    );
    expect(reply).toBeDefined();
    expect(reply!.filter((arg) => arg.startsWith('body='))).toEqual([`body=${hostileBody}`]);
    expectNothingWasExecuted();
  });

  it('resolve -c on a PR comment delivers the comment body unchanged and runs nothing', () => {
    resolve({
      owner: 'octo',
      repo: 'repo',
      entryId: 'IC_kwDOabc',
      status: 'skip',
      comment: hostileBody,
    });

    const calls = recordedCalls();
    expect(calls[calls.length - 1]).toEqual([
      'pr',
      'comment',
      '42',
      '--repo',
      'octo/repo',
      '--body',
      hostileBody,
    ]);
    expectNothingWasExecuted();
  });
});
