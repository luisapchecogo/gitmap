import * as assert from 'assert';
import { FileChange } from '../../core/diffParser';
import { GitRunner } from '../../core/gitRunner';
import { commitRevision, EMPTY_TREE, WORKING_TREE } from '../../core/revision';
import { GitRepository } from '../../git/repository';
import { TempRepo } from '../helpers/tempRepo';

/** git's well-known empty tree in SHA-1 repositories (the test default). */
const EMPTY_TREE_SHA1 = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function summary(changes: FileChange[]): string[] {
  return changes
    .map((c) => (c.oldPath ? `${c.status} ${c.oldPath} -> ${c.path}` : `${c.status} ${c.path}`))
    .sort();
}

suite('GitRepository.getChanges', () => {
  let repo: TempRepo;
  let git: GitRepository;
  let root: string;
  let second: string;

  suiteSetup(async () => {
    repo = await TempRepo.create();
    root = await repo.commitFiles('root', {
      'keep.txt': 'keep\n',
      'edit.txt': 'one\n',
      'remove.txt': 'bye\n',
      'rename-me.txt': 'a fairly long line that keeps the rename similar\n'.repeat(5),
    });
    await repo.remove('remove.txt');
    await repo.remove('rename-me.txt');
    second = await repo.commitFiles('second', {
      'edit.txt': 'two\n',
      'renamed.txt': 'a fairly long line that keeps the rename similar\n'.repeat(5),
      'dir with space/new #1.txt': 'new\n',
    });
    git = new GitRepository(repo.root, new GitRunner({ env: repo.env }));
  });

  suiteTeardown(async () => {
    await repo.dispose();
  });

  test('compares two commits with every status', async () => {
    const result = await git.getChanges({ base: commitRevision(root), target: commitRevision(second) });
    assert.strictEqual(result.left, root);
    assert.strictEqual(result.right, second);
    assert.deepStrictEqual(summary(result.changes), [
      'A dir with space/new #1.txt',
      'D remove.txt',
      'M edit.txt',
      'R rename-me.txt -> renamed.txt',
    ]);
  });

  test('compares a root commit against the empty tree', async () => {
    const result = await git.getChanges({ base: EMPTY_TREE, target: commitRevision(root) });
    assert.strictEqual(result.left, EMPTY_TREE_SHA1);
    assert.deepStrictEqual(summary(result.changes), ['A edit.txt', 'A keep.txt', 'A remove.txt', 'A rename-me.txt']);
    assert.strictEqual(await git.parentOrEmptyTree(root), result.left);
    assert.strictEqual(await git.parentOrEmptyTree(second), root);
  });

  test('includes modified, deleted and untracked files from the working tree', async () => {
    await repo.write('edit.txt', 'three\n');
    await repo.remove('keep.txt');
    await repo.write('untracked dir/u.txt', 'u\n');
    await repo.write('staged.txt', 'staged\n');
    await repo.git('add', 'staged.txt');
    try {
      const result = await git.getChanges({ base: commitRevision('HEAD'), target: WORKING_TREE });
      assert.strictEqual(result.right, undefined);
      assert.deepStrictEqual(summary(result.changes), [
        '? untracked dir/u.txt',
        'A staged.txt',
        'D keep.txt',
        'M edit.txt',
      ]);
    } finally {
      await repo.git('reset', '--quiet', '--hard');
      await repo.git('clean', '-fdq');
    }
  });

  test('rejects the working tree as base and unknown revisions', async () => {
    await assert.rejects(git.getChanges({ base: WORKING_TREE, target: commitRevision('HEAD') }), /only be the target/);
    await assert.rejects(
      git.getChanges({ base: commitRevision('nope'), target: commitRevision('HEAD') }),
      /"nope" is not a commit/,
    );
  });

  test('reports gitlinks with their mode', async () => {
    const before = await repo.git('rev-parse', 'HEAD');
    await repo.git('update-index', '--add', '--cacheinfo', `160000,${root},vendor/lib`);
    // Commit the index directly: `add --all` would drop the gitlink, which
    // has no checkout on disk.
    repo.tick();
    await repo.git('commit', '--quiet', '-m', 'add submodule');
    const after = await repo.git('rev-parse', 'HEAD');
    try {
      const result = await git.getChanges({ base: commitRevision(before), target: commitRevision(after) });
      assert.strictEqual(result.changes.length, 1);
      assert.strictEqual(result.changes[0].path, 'vendor/lib');
      assert.strictEqual(result.changes[0].newMode, '160000');
      assert.strictEqual(result.changes[0].newOid, root);
    } finally {
      await repo.git('reset', '--quiet', '--hard', before);
    }
  });
});

suite('GitRepository.getChanges (merge base)', () => {
  let repo: TempRepo;
  let git: GitRepository;

  suiteSetup(async () => {
    repo = await TempRepo.create();
    await repo.commitFiles('root', { 'shared.txt': 'base\n', 'main.txt': 'base\n' });
    await repo.git('switch', '--quiet', '-c', 'feature');
    await repo.commitFiles('feature work', { 'feature.txt': 'feature\n' });
    await repo.git('switch', '--quiet', 'main');
    await repo.commitFiles('main only', { 'main.txt': 'changed on main\n' });
    git = new GitRepository(repo.root, new GitRunner({ env: repo.env }));
  });

  suiteTeardown(async () => {
    await repo.dispose();
  });

  test('direct mode shows both sides of the divergence', async () => {
    const result = await git.getChanges({ base: commitRevision('main'), target: commitRevision('feature') });
    assert.deepStrictEqual(summary(result.changes), ['A feature.txt', 'M main.txt']);
    assert.strictEqual(result.mergeBase, undefined);
  });

  test('PR mode excludes base-only commits', async () => {
    const result = await git.getChanges({
      base: commitRevision('main'),
      target: commitRevision('feature'),
      mergeBase: true,
    });
    assert.deepStrictEqual(summary(result.changes), ['A feature.txt']);
    assert.strictEqual(result.mergeBase, await repo.git('merge-base', 'main', 'feature'));
    assert.strictEqual(result.left, result.mergeBase);
  });

  test('PR mode against the working tree uses HEAD for the merge base', async () => {
    await repo.git('switch', '--quiet', 'feature');
    await repo.write('wip.txt', 'wip\n');
    try {
      const result = await git.getChanges({ base: commitRevision('main'), target: WORKING_TREE, mergeBase: true });
      assert.deepStrictEqual(summary(result.changes), ['? wip.txt', 'A feature.txt']);
    } finally {
      await repo.remove('wip.txt');
      await repo.git('switch', '--quiet', 'main');
    }
  });

  test('PR mode fails clearly for unrelated histories', async () => {
    await repo.git('switch', '--quiet', '--orphan', 'unrelated');
    await repo.commitFiles('unrelated root', { 'other.txt': 'x\n' });
    await repo.git('switch', '--quiet', 'main');
    await assert.rejects(
      git.getChanges({ base: commitRevision('main'), target: commitRevision('unrelated'), mergeBase: true }),
      /no common ancestor/,
    );
  });
});
