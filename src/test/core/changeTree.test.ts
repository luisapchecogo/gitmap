import * as assert from 'assert';
import { buildChangeTree, ChangeTreeNode } from '../../core/changeTree';
import { ChangeStatus, FileChange } from '../../core/diffParser';

function change(path: string, status: ChangeStatus = 'M'): FileChange {
  return { status, path, oldMode: '100644', newMode: '100644', oldOid: '0', newOid: '0' };
}

/** Renders a tree as indented lines: folders end with `/`, files show their status. */
function render(nodes: ChangeTreeNode[], indent = ''): string[] {
  return nodes.flatMap((node) => {
    switch (node.kind) {
      case 'folder':
        return [`${indent}${node.name}/ (${node.fileCount})`, ...render(node.children, indent + '  ')];
      case 'file':
        return [`${indent}${node.name} ${node.change.status}`];
      case 'more':
        return [`${indent}… ${node.remaining} more`];
    }
  });
}

suite('buildChangeTree', () => {
  test('groups files by folder with folders first, in natural order', () => {
    const tree = buildChangeTree([
      change('b.txt'),
      change('src/z.ts'),
      change('src/file10.ts'),
      change('A.txt', 'A'),
      change('src/file2.ts'),
      change('lib/x.ts'),
      change('src/sub/a.ts'),
    ]);
    assert.deepStrictEqual(render(tree.roots), [
      'lib/ (1)',
      '  x.ts M',
      'src/ (4)',
      '  sub/ (1)',
      '    a.ts M',
      '  file2.ts M',
      '  file10.ts M',
      '  z.ts M',
      'A.txt A',
      'b.txt M',
    ]);
    assert.strictEqual(tree.shown, 7);
    assert.strictEqual(tree.total, 7);
  });

  test('compacts chains of single-child folders', () => {
    const tree = buildChangeTree([change('src/core/git/runner.ts'), change('src/core/git/parser.ts'), change('docs/a/b.md')]);
    assert.deepStrictEqual(render(tree.roots), [
      'docs/a/ (1)',
      '  b.md M',
      'src/core/git/ (2)',
      '  parser.ts M',
      '  runner.ts M',
    ]);
    const src = tree.roots[1];
    assert.ok(src.kind === 'folder');
    assert.strictEqual(src.path, 'src/core/git');
    assert.strictEqual(src.id, 'd:src/core/git');
  });

  test('does not compact a folder that also holds files', () => {
    const tree = buildChangeTree([change('a/one.txt'), change('a/b/two.txt')]);
    assert.deepStrictEqual(render(tree.roots), ['a/ (2)', '  b/ (1)', '    two.txt M', '  one.txt M']);
  });

  test('keeps a file and a folder with the same path apart', () => {
    const tree = buildChangeTree([change('docs', 'D'), change('docs/readme.md', 'A')]);
    const ids = tree.roots.map((node) => node.id);
    assert.deepStrictEqual(ids, ['d:docs', 'f:docs']);
    assert.deepStrictEqual(render(tree.roots), ['docs/ (1)', '  readme.md A', 'docs D']);
  });

  test('gives duplicate paths distinct ids', () => {
    const tree = buildChangeTree([change('x.txt', 'D'), change('x.txt', '?')]);
    assert.deepStrictEqual(
      tree.roots.map((node) => node.id),
      ['f:x.txt', 'f:x.txt#2'],
    );
  });

  test('truncates in display order and reports what is left', () => {
    const tree = buildChangeTree(
      [change('z.txt'), change('a/1.txt'), change('a/2.txt'), change('b/c/3.txt'), change('y.txt')],
      3,
    );
    assert.deepStrictEqual(render(tree.roots), ['a/ (2)', '  1.txt M', '  2.txt M', 'b/c/ (1)', '  3.txt M', '… 2 more']);
    assert.strictEqual(tree.shown, 3);
    assert.strictEqual(tree.total, 5);
  });

  test('a zero limit shows only the more node', () => {
    const tree = buildChangeTree([change('a.txt')], 0);
    assert.deepStrictEqual(render(tree.roots), ['… 1 more']);
  });

  test('an empty comparison gives an empty tree', () => {
    assert.deepStrictEqual(buildChangeTree([]), { roots: [], shown: 0, total: 0 });
  });
});
