import * as assert from 'assert';
import { parseRefs, refsByCommit, refsFingerprint } from '../../core/refsParser';

const C1 = '1'.repeat(40);
const C2 = '2'.repeat(40);
const T1 = 't'.repeat(40);

function line(...fields: string[]): string {
  return fields.join('\0');
}

suite('parseRefs', () => {
  const output = [
    line('refs/heads/main', 'commit', C1, '', '', '*', 'refs/remotes/origin/main', ''),
    line('refs/heads/feature/x', 'commit', C2, '', '', ' ', '', ''),
    line('refs/remotes/origin/HEAD', 'commit', C1, '', '', ' ', '', 'refs/remotes/origin/main'),
    line('refs/remotes/origin/main', 'commit', C1, '', '', ' ', '', ''),
    line('refs/tags/v1', 'tag', T1, 'commit', C2, ' ', '', ''),
    line('refs/tags/light', 'commit', C1, '', '', ' ', '', ''),
    line('refs/tags/tree-tag', 'tag', T1, 'tree', C2, ' ', '', ''),
    line('refs/tags/blob', 'blob', C2, '', '', ' ', '', ''),
    '',
  ].join('\n');

  test('parses branches, remotes and tags', () => {
    const refs = parseRefs(output);
    assert.deepStrictEqual(
      refs.map((r) => `${r.kind} ${r.name} ${r.commit[0]}`),
      ['head main 1', 'head feature/x 2', 'remote origin/main 1', 'tag v1 2', 'tag light 1'],
    );
  });

  test('marks HEAD and records upstream and remote names', () => {
    const [main, feature, remote] = parseRefs(output);
    assert.strictEqual(main.isHead, true);
    assert.strictEqual(main.upstream, 'origin/main');
    assert.strictEqual(feature.isHead, false);
    assert.strictEqual(feature.upstream, undefined);
    assert.strictEqual(remote.remote, 'origin');
  });

  test('groups refs by commit', () => {
    const byCommit = refsByCommit(parseRefs(output));
    assert.deepStrictEqual(
      byCommit.get(C1)?.map((r) => r.name),
      ['main', 'origin/main', 'light'],
    );
  });
});

suite('refsFingerprint', () => {
  const ref = (fullName: string, commit: string) =>
    ({ kind: 'head', fullName, name: fullName, commit, isHead: false }) as const;

  test('ignores order but notices moves, additions and HEAD changes', () => {
    const base = refsFingerprint([ref('refs/heads/a', C1), ref('refs/heads/b', C2)], { commit: C1, branch: 'a' });
    assert.strictEqual(refsFingerprint([ref('refs/heads/b', C2), ref('refs/heads/a', C1)], { commit: C1, branch: 'a' }), base);
    assert.notStrictEqual(refsFingerprint([ref('refs/heads/a', C2), ref('refs/heads/b', C2)], { commit: C1, branch: 'a' }), base);
    assert.notStrictEqual(refsFingerprint([ref('refs/heads/a', C1)], { commit: C1, branch: 'a' }), base);
    assert.notStrictEqual(refsFingerprint([ref('refs/heads/a', C1), ref('refs/heads/b', C2)], { commit: C2, branch: undefined }), base);
  });
});
