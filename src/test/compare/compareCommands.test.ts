import * as assert from 'assert';
import * as vscode from 'vscode';
import { ChangeFileNode } from '../../core/changeTree';
import { GitRunner } from '../../core/gitRunner';
import { commitRevision, WORKING_TREE } from '../../core/revision';
import type { GitMapTestApi } from '../../extension';
import { GitRepository } from '../../git/repository';
import { activateGitMap, closeAllEditors } from '../helpers/extension';
import { TempRepo } from '../helpers/tempRepo';

suite('Compare commands', () => {
  let repo: TempRepo;
  let git: GitRepository;
  let api: GitMapTestApi;

  suiteSetup(async () => {
    api = await activateGitMap();
    repo = await TempRepo.create();
    await repo.commitFiles('root', { 'shared.txt': 'base\n', 'main.txt': 'base\n' });
    await repo.git('switch', '--quiet', '-c', 'feature');
    await repo.commitFiles('feature work', { 'feature.txt': 'feature\n' });
    await repo.git('switch', '--quiet', 'main');
    await repo.commitFiles('main only', { 'main.txt': 'changed on main\n' });
    git = new GitRepository(repo.root, new GitRunner());
  });

  suiteTeardown(async () => {
    api.compareService.clear();
    await closeAllEditors();
    await repo.dispose();
  });

  function shownPaths(): string[] {
    return (api.compareService.current?.changes ?? []).map((c) => c.path).sort();
  }

  test('swap reverses the sides of the shown comparison', async () => {
    await api.compareService.compare(git, { base: commitRevision('main'), target: commitRevision('feature'), mode: 'direct' });
    await vscode.commands.executeCommand('gitmap.swapCompare');
    const selection = api.compareService.current?.selection;
    assert.strictEqual(selection?.base.kind === 'commit' && selection.base.ref, 'feature');
    assert.strictEqual(selection?.target.kind === 'commit' && selection.target.ref, 'main');
  });

  test('swap keeps the working tree as the target', async () => {
    await api.compareService.compare(git, { base: commitRevision('main'), target: WORKING_TREE, mode: 'direct' });
    await vscode.commands.executeCommand('gitmap.swapCompare');
    assert.strictEqual(api.compareService.current?.selection.target.kind, 'workingTree');
  });

  test('the mode toggle switches to a merge-base comparison and back', async () => {
    await api.compareService.compare(git, { base: commitRevision('main'), target: commitRevision('feature'), mode: 'direct' });
    assert.deepStrictEqual(shownPaths(), ['feature.txt', 'main.txt']);
    await vscode.commands.executeCommand('gitmap.toggleCompareMode');
    assert.strictEqual(api.compareService.current?.selection.mode, 'mergeBase');
    assert.deepStrictEqual(shownPaths(), ['feature.txt']);
    assert.match(api.compareService.current?.leftLabel ?? '', /^merge-base\(main\) [0-9a-f]{7}$/);
    await vscode.commands.executeCommand('gitmap.toggleCompareMode');
    assert.deepStrictEqual(shownPaths(), ['feature.txt', 'main.txt']);
  });

  test('opening a change shows a diff editor', async () => {
    await closeAllEditors();
    await api.compareService.compare(git, { base: commitRevision('main'), target: commitRevision('feature'), mode: 'direct' });
    const change = api.compareService.current?.changes.find((c) => c.path === 'main.txt');
    assert.ok(change);
    const node: ChangeFileNode = { kind: 'file', id: 'f:main.txt', name: 'main.txt', path: 'main.txt', change };
    await vscode.commands.executeCommand('gitmap.openChange', node);
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputTextDiff, 'a text diff editor should be active');
    assert.strictEqual(input.original.scheme, 'gitmap');
    assert.strictEqual(input.modified.scheme, 'gitmap');
  });

  test('open all changes opens the multi-file diff editor', async () => {
    await closeAllEditors();
    await api.compareService.compare(git, { base: commitRevision('main'), target: commitRevision('feature'), mode: 'direct' });
    await vscode.commands.executeCommand('gitmap.openAllChanges');
    assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab, 'an editor should be open');
  });
});
