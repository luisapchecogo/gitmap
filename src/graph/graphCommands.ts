import * as vscode from 'vscode';
import { pickBranchFilter, pickRepository } from '../state/pickers';
import { Session } from '../state/session';
import { WorkspaceStore } from '../state/workspaceStore';
import { GraphController } from './graphController';

export function registerGraphCommands(session: Session, store: WorkspaceStore, graph: GraphController): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('gitmap.refresh', () => graph.reload()),

    vscode.commands.registerCommand('gitmap.selectRepository', async () => {
      const repository = await pickRepository(session, 'Select the repository to show in GitMap');
      if (repository) {
        session.setActiveRepository(repository);
      }
    }),

    vscode.commands.registerCommand('gitmap.selectBranch', async () => {
      const repository = graph.currentRepository;
      if (!repository) {
        return;
      }
      const picked = await pickBranchFilter(repository, graph.currentFilter.branch);
      if (picked) {
        await store.update(repository.root, { graphBranch: picked.branch });
        await graph.reload();
      }
    }),

    vscode.commands.registerCommand('gitmap.toggleRemoteBranches', async () => {
      const repository = graph.currentRepository;
      if (!repository) {
        return;
      }
      await store.update(repository.root, { showRemotes: !graph.currentFilter.showRemotes });
      await graph.reload();
    }),
  ];
}
