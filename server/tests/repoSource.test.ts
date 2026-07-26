import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGitHubRepo, topFolder } from '../src/store/repoSource.js';

test('parses a plain github repo URL', () => {
  assert.deepEqual(parseGitHubRepo('https://github.com/owner/repo'), {
    owner: 'owner',
    name: 'repo',
    branch: null,
  });
});

test('parses a .git suffix and a /tree/<branch> URL', () => {
  assert.deepEqual(parseGitHubRepo('https://github.com/o/r.git'), {
    owner: 'o',
    name: 'r',
    branch: null,
  });
  assert.deepEqual(parseGitHubRepo('https://github.com/o/r/tree/dev'), {
    owner: 'o',
    name: 'r',
    branch: 'dev',
  });
});

test('rejects non-github or malformed URLs', () => {
  assert.equal(parseGitHubRepo('https://gitlab.com/o/r'), null);
  assert.equal(parseGitHubRepo('not a url'), null);
  assert.equal(parseGitHubRepo('https://github.com/only-owner'), null);
});

test('topFolder detects the single GitHub wrapper folder', () => {
  assert.equal(topFolder(['repo-main/a.txt', 'repo-main/dir/b.txt']), 'repo-main');
  assert.equal(topFolder(['a.txt', 'b.txt']), null); // no common wrapper
  assert.equal(topFolder([]), null);
});
