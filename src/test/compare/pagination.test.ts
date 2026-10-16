import * as assert from 'assert';
import * as vscode from 'vscode';
import { ChangeTreeNode } from '../../core/changeTree';
import { GitRunner } from '../../core/gitRunner';
import { commitRevision, EMPTY_TREE } from '../../core/revision';
import type { GitMapTestApi } from '../../extension';
import { GitRepository } from '../../git/repository';
import { activateGitMap } from '../helpers/extension';
import { TempRepo } from '../helpers/tempRepo';

function countFiles(nodes: ChangeTreeNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.kind === 'file' ? 1 : node.kind === 'folder' ? countFiles(node.children) : 0), 0);
}

suite('Large comparisons', () => {
  let repo: TempRepo;
  let git: GitRepository;
  let api: GitMapTestApi;
  const config = () => vscode.workspace.getConfiguration('gitmap');

  suiteSetup(async () => {
    api = await activateGitMap();
    repo = await TempRepo.create();
    const files: Record<string, string> = {};
    for (let i = 0; i < 7; i++) {
      files[`dir${i % 2}/file${i}.txt`] = `${i}\n`;
    }
    await repo.commitFiles('many files', files);
    git = new GitRepository(repo.root, new GitRunner());
    await config().update('compare.maxFiles', 3, vscode.ConfigurationTarget.Global);
  });

  suiteTeardown(async () => {
    await config().update('compare.maxFiles', undefined, vscode.ConfigurationTarget.Global);
    api.compareService.clear();
    await repo.dispose();
  });

  test('shows one page, a show-more item and a message', async () => {
    await api.compareService.compare(git, { base: EMPTY_TREE, target: commitRevision('HEAD'), mode: 'direct' });
    const roots = api.changesTree.getChildren();
    assert.strictEqual(countFiles(roots), 3);
    const more = roots[roots.length - 1];
    assert.strictEqual(more.kind, 'more');
    assert.strictEqual(more.kind === 'more' && more.remaining, 4);
    assert.strictEqual(api.changesTree.view.message, 'Showing the first 3 of 7 changed files.');
  });

  test('show more loads the next page until everything is shown', async () => {
    await api.compareService.compare(git, { base: EMPTY_TREE, target: commitRevision('HEAD'), mode: 'direct' });
    await vscode.commands.executeCommand('gitmap.showMoreFiles');
    assert.strictEqual(countFiles(api.changesTree.getChildren()), 6);
    await vscode.commands.executeCommand('gitmap.showMoreFiles');
    const roots = api.changesTree.getChildren();
    assert.strictEqual(countFiles(roots), 7);
    assert.ok(roots.every((node) => node.kind !== 'more'));
    assert.strictEqual(api.changesTree.view.message, undefined);
  });

  test('a new comparison starts from the first page again', async () => {
    await api.compareService.compare(git, { base: EMPTY_TREE, target: commitRevision('HEAD'), mode: 'direct' });
    await vscode.commands.executeCommand('gitmap.showMoreFiles');
    await api.compareService.compare(git, { base: EMPTY_TREE, target: commitRevision('HEAD'), mode: 'direct' });
    assert.strictEqual(countFiles(api.changesTree.getChildren()), 3);
  });
});
