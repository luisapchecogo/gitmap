import * as vscode from 'vscode';
import { ChangeDecorationProvider } from './compare/changeDecorations';
import { ChangesTreeProvider, pageSize } from './compare/changesTreeProvider';
import { registerCompareCommands } from './compare/compareCommands';
import { CompareService } from './compare/compareService';
import { CompareState } from './compare/compareState';
import { GitFileSystemProvider } from './compare/gitFileSystemProvider';
import { GIT_SCHEME } from './compare/gitUri';
import { GraphAutoRefresh } from './graph/autoRefresh';
import { CompareFooter } from './graph/compareFooter';
import { registerGraphCommands } from './graph/graphCommands';
import { GraphController } from './graph/graphController';
import { GRAPH_VIEW_ID, GraphViewProvider } from './graph/graphViewProvider';
import { CommitOrder } from './git/repository';
import { Session } from './state/session';
import { WorkspaceStore } from './state/workspaceStore';

/**
 * Internals returned from activate() for the integration tests. Not a
 * public API: it may change in any release.
 */
export interface GitMapTestApi {
  session: Session;
  compareState: CompareState;
  compareService: CompareService;
  changesTree: ChangesTreeProvider;
  graph: GraphController;
  footer: CompareFooter;
  graphView: GraphViewProvider;
}

export function activate(context: vscode.ExtensionContext): GitMapTestApi {
  const session = new Session(context);
  context.subscriptions.push(session);

  // Registered before anything asynchronous: diff editors restored after a
  // reload read gitmap: URIs as soon as the extension activates.
  const fileSystem = new GitFileSystemProvider(() => session.runner);
  context.subscriptions.push(
    fileSystem,
    vscode.workspace.registerFileSystemProvider(GIT_SCHEME, fileSystem, {
      isCaseSensitive: true,
      isReadonly: true,
    }),
  );

  const store = new WorkspaceStore(context.workspaceState);
  const state = new CompareState(session, store);
  const service = new CompareService(pageSize);
  const changesTree = new ChangesTreeProvider(service, session);
  context.subscriptions.push(
    state,
    service,
    changesTree,
    vscode.window.registerFileDecorationProvider(new ChangeDecorationProvider()),
  );
  const compareDeps = { session, state, service, changesTree };
  context.subscriptions.push(...registerCompareCommands(compareDeps));

  const graph = new GraphController({
    pageSize: () => vscode.workspace.getConfiguration('gitmap').get<number>('graph.pageSize', 300),
    commitOrder: () => vscode.workspace.getConfiguration('gitmap').get<CommitOrder>('graph.commitOrder', 'date'),
    filter: (repository) => {
      const saved = store.get(repository.root);
      return { branch: saved.graphBranch, showRemotes: saved.showRemotes ?? true };
    },
    repositoryCount: () => session.repositories.length,
  });
  const footer = new CompareFooter(compareDeps, graph);
  let discovering = true;
  const showActiveRepository = (): Promise<void> => graph.setRepository(session.activeRepository, discovering);
  void session.ready().then(() => {
    discovering = false;
    return showActiveRepository();
  });
  context.subscriptions.push(
    { dispose: () => graph.dispose() },
    session.onDidChangeActiveRepository(() => void showActiveRepository()),
    session.onDidChangeRepositories(() => graph.postToolbar()),
    ...registerGraphCommands(session, store, graph, compareDeps),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('gitmap.graph')) {
        void graph.reload();
      }
    }),
    footer,
  );
  const graphView = new GraphViewProvider(context.extensionUri, graph, footer);
  context.subscriptions.push(
    graphView,
    vscode.window.registerWebviewViewProvider(GRAPH_VIEW_ID, graphView),
    new GraphAutoRefresh(session, graph, () => graphView.visible, graphView.onDidBecomeVisible),
  );

  return { session, compareState: state, compareService: service, changesTree, graph, footer, graphView };
}

export function deactivate(): void {}
