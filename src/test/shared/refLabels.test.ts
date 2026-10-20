import * as assert from 'assert';
import { RefBadge } from '../../shared/protocol';
import { refLines } from '../../shared/refLabels';

const local = (name: string, current = false): RefBadge => ({ name, kind: 'head', current });
const remote = (remoteName: string, branch: string): RefBadge => ({
  name: `${remoteName}/${branch}`,
  kind: 'remote',
  current: false,
  remote: remoteName,
});
const tag = (name: string): RefBadge => ({ name, kind: 'tag', current: false });

suite('refLines', () => {
  test('puts local branches and tags on top and shortens pushed branches below', () => {
    // In for-each-ref order: heads, remotes, tags.
    const lines = refLines([
      local('feature'),
      local('main', true),
      remote('origin', 'feature/x'),
      remote('origin', 'main'),
      remote('upstream', 'main'),
      tag('v1.0'),
    ]);
    assert.deepStrictEqual(lines.top, [
      { kind: 'branch', text: 'main', title: 'main', current: true },
      { kind: 'branch', text: 'feature', title: 'feature', current: false },
      { kind: 'tag', text: 'v1.0', title: 'v1.0', current: false },
    ]);
    assert.deepStrictEqual(lines.bottom, [
      { kind: 'remote', text: 'origin', title: 'origin/main', current: false },
      { kind: 'remote', text: 'upstream', title: 'upstream/main', current: false },
      // Not `feature`: only an exact branch name counts as the same branch.
      { kind: 'remote', text: 'feature/x', prefix: 'origin/', title: 'origin/feature/x', current: false },
    ]);
  });

  test('gives one remote a single label for all the local branches it mirrors', () => {
    const lines = refLines([local('dev'), local('main'), remote('origin', 'dev'), remote('origin', 'main')]);
    assert.deepStrictEqual(lines.bottom, [{ kind: 'remote', text: 'origin', title: 'origin/dev, origin/main', current: false }]);
  });
});
