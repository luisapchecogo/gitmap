import * as vscode from 'vscode';
import { CompareDeps, runComparison } from '../compare/compareCommands';
import { commitRevision, EMPTY_TREE, Revision, shortHash, WORKING_TREE } from '../core/revision';
import { pickBranchFilter, pickRepository } from '../state/pickers';
import { Session } from '../state/session';
import { WorkspaceStore } from '../state/workspaceStore';
import { GraphController } from './graphController';

/** The argument VS Code passes to webview context-menu commands (from data-vscode-context). */
interface CommitContext {
  hash?: unknown;
}

function contextHash(context: unknown): string | undefined {
  const hash = (context as CommitContext | undefined)?.hash;
  return typeof hash === 'string' && /^[0-9a-f]{4,64}$/i.test(hash) ? hash : undefined;
}

export function registerGraphCommands(
  session: Session,
  store: WorkspaceStore,
  graph: GraphController,
  compare: CompareDeps,
): vscode.Disposable[] {
  /** Runs `action` with the graph's repository and the right-clicked commit. */
  const onCommit =
    (action: (repository: NonNullable<GraphController['currentRepository']>, hash: string) => PromiseLike<unknown>) =>
    async (context: unknown): Promise<void> => {
      const hash = contextHash(context);
      const repository = graph.currentRepository;
      if (hash && repository) {
        await action(repository, hash);
      }
    };

  return [
    vscode.commands.registerCommand(
      'gitmap.graph.setBase',
      onCommit((repository, hash) => compare.state.update(repository, { base: commitRevision(hash, shortHash(hash)) })),
    ),

    vscode.commands.registerCommand(
      'gitmap.graph.setTarget',
      onCommit((repository, hash) => compare.state.update(repository, { target: commitRevision(hash, shortHash(hash)) })),
    ),

    vscode.commands.registerCommand(
      'gitmap.graph.compareWithWorkingTree',
      onCommit((repository, hash) =>
        runComparison(compare, repository, {
          ...compare.state.selectionFor(repository),
          base: commitRevision(hash, shortHash(hash)),
          target: WORKING_TREE,
        }),
      ),
    ),

    vscode.commands.registerCommand(
      'gitmap.graph.showCommitChanges',
      onCommit(async (repository, hash) => {
        // A commit's own changes: its first parent (or nothing, for a root
        // commit) against the commit itself.
        const parent = await repository.resolveCommit(`${hash}^1`);
        const base: Revision = parent ? commitRevision(parent, shortHash(parent)) : EMPTY_TREE;
        await runComparison(compare, repository, { base, target: commitRevision(hash, shortHash(hash)), mode: 'direct' });
      }),
    ),

    vscode.commands.registerCommand(
      'gitmap.graph.copyHash',
      onCommit((_repository, hash) => vscode.env.clipboard.writeText(hash)),
    ),

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
