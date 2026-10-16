import * as assert from 'assert';
import * as vscode from 'vscode';
import { GitRunner } from '../../core/gitRunner';
import type { GitMapTestApi } from '../../extension';
import { GitRepository } from '../../git/repository';
import { activateGitMap } from '../helpers/extension';
import { TempRepo } from '../helpers/tempRepo';

suite('Graph commands', () => {
  let repo: TempRepo;
  let api: GitMapTestApi;

  suiteSetup(async () => {
    api = await activateGitMap();
    repo = await TempRepo.create();
    await repo.commitFiles('local', { 'a.txt': '1\n' });
    await repo.git('switch', '--quiet', '-c', 'tmp');
    await repo.commitFiles('remote only', { 'r.txt': '1\n' });
    await repo.git('update-ref', 'refs/remotes/origin/feature', 'HEAD');
    await repo.git('switch', '--quiet', 'main');
    await repo.git('branch', '-D', 'tmp');
    await api.graph.setRepository(new GitRepository(repo.root, new GitRunner()));
  });

  suiteTeardown(async () => {
    await api.graph.setRepository(api.session.activeRepository, false);
    await repo.dispose();
  });

  test('toggle remote branches hides and shows remote-only commits', async () => {
    const subjects = () => api.graph.loadedRows.map((r) => r.subject);
    assert.ok(subjects().includes('remote only'));
    await vscode.commands.executeCommand('gitmap.toggleRemoteBranches');
    assert.strictEqual(api.graph.currentFilter.showRemotes, false);
    assert.deepStrictEqual(subjects(), ['local']);
    await vscode.commands.executeCommand('gitmap.toggleRemoteBranches');
    assert.ok(subjects().includes('remote only'));
  });

  test('refresh reloads the graph', async () => {
    const before = api.graph.currentGeneration;
    await vscode.commands.executeCommand('gitmap.refresh');
    assert.strictEqual(api.graph.currentGeneration, before + 1);
  });
});
