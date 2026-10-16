import * as assert from 'assert';
import { applyLineStats, FileChange, isNullOid, parseNumstat, parseRawDiff } from '../../core/diffParser';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const Z = '0'.repeat(40);

function raw(...records: string[][]): string {
  return records.map((fields) => fields.join('\0') + '\0').join('');
}

suite('parseRawDiff', () => {
  test('parses added, modified, deleted and type-changed files', () => {
    const output = raw(
      [`:000000 100644 ${Z} ${A} A`, 'new.txt'],
      [`:100644 100644 ${A} ${B} M`, 'src/app.ts'],
      [`:100644 000000 ${A} ${Z} D`, 'gone.txt'],
      [`:100644 120000 ${A} ${B} T`, 'link'],
    );
    const changes = parseRawDiff(output);
    assert.deepStrictEqual(
      changes.map((c) => [c.status, c.path]),
      [
        ['A', 'new.txt'],
        ['M', 'src/app.ts'],
        ['D', 'gone.txt'],
        ['T', 'link'],
      ],
    );
    assert.strictEqual(changes[0].oldMode, '000000');
    assert.strictEqual(changes[0].newOid, A);
    assert.strictEqual(changes[1].oldOid, A);
    assert.strictEqual(changes[1].newOid, B);
  });

  test('parses renames and copies with both paths and the score', () => {
    const output = raw(
      [`:100644 100644 ${A} ${B} R086`, 'old name.txt', 'new name.txt'],
      [`:100644 100644 ${A} ${A} C100`, 'a.txt', 'copy/a.txt'],
    );
    const [rename, copy] = parseRawDiff(output);
    assert.deepStrictEqual(
      { status: rename.status, oldPath: rename.oldPath, path: rename.path, score: rename.score },
      { status: 'R', oldPath: 'old name.txt', path: 'new name.txt', score: 86 },
    );
    assert.deepStrictEqual(
      { status: copy.status, oldPath: copy.oldPath, path: copy.path, score: copy.score },
      { status: 'C', oldPath: 'a.txt', path: 'copy/a.txt', score: 100 },
    );
  });

  test('keeps unusual paths intact', () => {
    const paths = ['with space.txt', 'hash#and%percent.md', 'line\nbreak.txt', 'tab\there', 'ünïcødé/文件.txt', 'emoji 🎉.txt'];
    const output = raw(...paths.map((p) => [`:100644 100644 ${A} ${B} M`, p]));
    assert.deepStrictEqual(
      parseRawDiff(output).map((c) => c.path),
      paths,
    );
  });

  test('parses gitlinks and unmerged entries', () => {
    const output = raw([`:160000 160000 ${A} ${B} M`, 'vendor/lib'], [`:000000 000000 ${Z} ${Z} U`, 'conflict.txt']);
    const [gitlink, unmerged] = parseRawDiff(output);
    assert.strictEqual(gitlink.newMode, '160000');
    assert.strictEqual(unmerged.status, 'U');
    assert.ok(isNullOid(unmerged.newOid));
  });

  test('returns nothing for empty output', () => {
    assert.deepStrictEqual(parseRawDiff(''), []);
  });

  test('rejects output that is not --raw', () => {
    assert.throws(() => parseRawDiff('diff --git a/x b/x\0'));
  });
});

suite('parseNumstat', () => {
  test('parses counts, binary files and renames', () => {
    const output = '3\t1\tsrc/a.ts\0-\t-\timage.png\0' + '5\t0\t\0old.txt\0new.txt\0';
    assert.deepStrictEqual(parseNumstat(output), [
      { additions: 3, deletions: 1, path: 'src/a.ts' },
      { additions: null, deletions: null, path: 'image.png' },
      { additions: 5, deletions: 0, path: 'new.txt', oldPath: 'old.txt' },
    ]);
  });

  test('keeps paths with tabs and newlines', () => {
    assert.deepStrictEqual(parseNumstat('1\t2\ta\tb\nc\0'), [{ additions: 1, deletions: 2, path: 'a\tb\nc' }]);
  });

  test('applies stats to changes by target path', () => {
    const changes: FileChange[] = [
      { status: 'M', path: 'a', oldMode: '100644', newMode: '100644', oldOid: A, newOid: B },
      { status: 'R', path: 'new', oldPath: 'old', oldMode: '100644', newMode: '100644', oldOid: A, newOid: B },
      { status: 'A', path: 'untouched', oldMode: '000000', newMode: '100644', oldOid: Z, newOid: A },
    ];
    applyLineStats(changes, parseNumstat('1\t0\ta\0' + '2\t3\t\0old\0new\0'));
    assert.deepStrictEqual(
      changes.map((c) => [c.additions, c.deletions]),
      [
        [1, 0],
        [2, 3],
        [undefined, undefined],
      ],
    );
  });
});
