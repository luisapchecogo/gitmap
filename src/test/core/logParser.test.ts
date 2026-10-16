import * as assert from 'assert';
import { parseLog } from '../../core/logParser';
import { GitRef, selectTips } from '../../core/refsParser';

const H1 = '1'.repeat(40);
const H2 = '2'.repeat(40);
const H3 = '3'.repeat(40);

function record(hash: string, parents: string, subject: string, body = ''): string {
  return [hash, parents, 'Ünï Côdé', 'u@example.com', '1704067200', subject, body].join('\0') + '\0';
}

suite('parseLog', () => {
  test('parses commits with parents, unicode and multi-line bodies', () => {
    const output = record(H1, `${H2} ${H3}`, 'Merge branch “x” 🎉', 'Line one\n\nLine three\n') + record(H2, '', 'root');
    const [merge, root] = parseLog(output);
    assert.strictEqual(merge.hash, H1);
    assert.deepStrictEqual(merge.parents, [H2, H3]);
    assert.strictEqual(merge.authorName, 'Ünï Côdé');
    assert.strictEqual(merge.authorDate, 1704067200);
    assert.strictEqual(merge.subject, 'Merge branch “x” 🎉');
    assert.strictEqual(merge.body, 'Line one\n\nLine three');
    assert.deepStrictEqual(root.parents, []);
    assert.strictEqual(root.body, '');
  });

  test('returns nothing for empty output', () => {
    assert.deepStrictEqual(parseLog(''), []);
  });
});

suite('selectTips', () => {
  const refs: GitRef[] = [
    { kind: 'head', fullName: 'refs/heads/main', name: 'main', commit: H1, isHead: true },
    { kind: 'head', fullName: 'refs/heads/topic', name: 'topic', commit: H2, isHead: false },
    { kind: 'remote', fullName: 'refs/remotes/origin/main', name: 'origin/main', commit: H3, isHead: false, remote: 'origin' },
    { kind: 'tag', fullName: 'refs/tags/v1', name: 'v1', commit: H2, isHead: false },
  ];

  test('all branches include HEAD, tags and remotes, without duplicates', () => {
    assert.deepStrictEqual(selectTips(refs, H1, { showRemotes: true }), [H1, H2, H3]);
  });

  test('remotes can be hidden', () => {
    assert.deepStrictEqual(selectTips(refs, H1, { showRemotes: false }), [H1, H2]);
  });

  test('a detached HEAD is included', () => {
    const detached = '9'.repeat(40);
    assert.deepStrictEqual(selectTips(refs, detached, { showRemotes: false })[0], detached);
  });

  test('one branch shows only that branch', () => {
    assert.deepStrictEqual(selectTips(refs, H1, { branch: 'refs/heads/topic', showRemotes: true }), [H2]);
    assert.deepStrictEqual(selectTips(refs, H1, { branch: 'refs/heads/deleted', showRemotes: true }), []);
  });
});
