import * as assert from 'assert';
import * as vscode from 'vscode';
import { GitRunner } from '../../core/gitRunner';
import type { GitMapTestApi } from '../../extension';
import { GitRepository } from '../../git/repository';
import { activateGitMap } from '../helpers/extension';
import { TempRepo } from '../helpers/tempRepo';

suite('Comparing from the graph', () => {
  let repo: TempRepo;
  let api: GitMapTestApi;
  let git: GitRepository;
  let root: string;
  let second: string;
  let third: string;

  suiteSetup(async () => {
    api = await activateGitMap();
    repo = await TempRepo.create();
    root = await repo.commitFiles('root', { 'a.txt': '1\n', 'b.txt': '1\n' });
    second = await repo.commitFiles('second', { 'a.txt': '2\n' });
    third = await repo.commitFiles('third', { 'c.txt': '3\n' });
    git = new GitRepository(repo.root, new GitRunner());
    await api.graph.setRepository(git);
  });

  suiteTeardown(async () => {
    api.compareService.clear();
    await api.graph.setRepository(api.session.activeRepository, false);
    await repo.dispose();
  });

  const paths = () => (api.compareService.current?.changes ?? []).map((c) => c.path).sort();

  test('set as base and set as target update the selection and the footer', async () => {
    await vscode.commands.executeCommand('gitmap.graph.setBase', { hash: root });
    await vscode.commands.executeCommand('gitmap.graph.setTarget', { hash: third });
    const state = await api.footer.state();
    assert.strictEqual(state.baseLabel, root.slice(0, 7));
    assert.strictEqual(state.targetLabel, third.slice(0, 7));
    assert.strictEqual(state.baseHash, root);
    assert.strictEqual(state.targetHash, third);
    assert.strictEqual(state.canSwap, true);
  });

  test('the footer swaps, toggles PR-style and compares', async () => {
    await api.footer.run('swap');
    const swapped = api.compareState.selectionFor(git);
    assert.strictEqual(swapped.base.kind === 'commit' && swapped.base.ref, third);
    await api.footer.run('swap');
    await api.footer.run('toggleMode');
    assert.strictEqual(api.compareState.selectionFor(git).mode, 'mergeBase');
    await api.footer.run('toggleMode');
    await api.footer.run('compare');
    assert.deepStrictEqual(paths(), ['a.txt', 'c.txt']);
  });

  test('show commit changes compares a commit with its parent', async () => {
    await vscode.commands.executeCommand('gitmap.graph.showCommitChanges', { hash: second });
    assert.deepStrictEqual(paths(), ['a.txt']);
    assert.strictEqual(api.compareService.current?.left, root);
  });

  test('show commit changes on a root commit compares against nothing', async () => {
    await vscode.commands.executeCommand('gitmap.graph.showCommitChanges', { hash: root });
    assert.deepStrictEqual(paths(), ['a.txt', 'b.txt']);
    assert.strictEqual(api.compareService.current?.selection.base.kind, 'emptyTree');
  });

  test('compare with working tree uses the commit as base', async () => {
    await repo.write('b.txt', 'changed\n');
    try {
      await vscode.commands.executeCommand('gitmap.graph.compareWithWorkingTree', { hash: second });
      assert.strictEqual(api.compareService.current?.selection.target.kind, 'workingTree');
      assert.deepStrictEqual(paths(), ['b.txt', 'c.txt']);
      const footer = await api.footer.state();
      assert.strictEqual(footer.targetLabel, 'Working Tree');
      assert.strictEqual(footer.canSwap, false);
    } finally {
      await repo.git('checkout', '--', 'b.txt');
    }
  });

  test('swapping with the working tree as target is refused', async () => {
    const before = api.compareState.selectionFor(git);
    await api.footer.run('swap');
    assert.deepStrictEqual(api.compareState.selectionFor(git), before);
  });

  test('ignores invalid context arguments', async () => {
    const before = api.compareState.selectionFor(git);
    await vscode.commands.executeCommand('gitmap.graph.setBase', { hash: '--all' });
    await vscode.commands.executeCommand('gitmap.graph.setBase', undefined);
    assert.deepStrictEqual(api.compareState.selectionFor(git), before);
  });
});
