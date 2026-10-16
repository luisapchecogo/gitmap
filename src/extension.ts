import * as vscode from 'vscode';
import { ChangeDecorationProvider } from './compare/changeDecorations';
import { ChangesTreeProvider, pageSize } from './compare/changesTreeProvider';
import { registerCompareCommands } from './compare/compareCommands';
import { CompareService } from './compare/compareService';
import { CompareState } from './compare/compareState';
import { GitFileSystemProvider } from './compare/gitFileSystemProvider';
import { GIT_SCHEME } from './compare/gitUri';
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
    ...registerCompareCommands({ session, state, service, changesTree }),
  );

  const graph = new GraphController({
    pageSize: () => vscode.workspace.getConfiguration('gitmap').get<number>('graph.pageSize', 300),
    commitOrder: () => vscode.workspace.getConfiguration('gitmap').get<CommitOrder>('graph.commitOrder', 'date'),
  });
  let discovering = true;
  const showActiveRepository = (): Promise<void> => graph.setRepository(session.activeRepository, discovering);
  void session.ready().then(() => {
    discovering = false;
    return showActiveRepository();
  });
  context.subscriptions.push(
    { dispose: () => graph.dispose() },
    session.onDidChangeActiveRepository(() => void showActiveRepository()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('gitmap.graph')) {
        void graph.reload();
      }
    }),
    vscode.window.registerWebviewViewProvider(GRAPH_VIEW_ID, new GraphViewProvider(context.extensionUri, graph)),
  );

  return { session, compareState: state, compareService: service, changesTree, graph };
}

export function deactivate(): void {}
