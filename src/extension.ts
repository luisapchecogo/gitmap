import * as vscode from 'vscode';
import { ChangeDecorationProvider } from './compare/changeDecorations';
import { ChangesTreeProvider } from './compare/changesTreeProvider';
import { registerCompareCommands } from './compare/compareCommands';
import { CompareService } from './compare/compareService';
import { CompareState } from './compare/compareState';
import { GitFileSystemProvider } from './compare/gitFileSystemProvider';
import { GIT_SCHEME } from './compare/gitUri';
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
  const service = new CompareService();
  const changesTree = new ChangesTreeProvider(service, session);
  context.subscriptions.push(
    state,
    service,
    changesTree,
    vscode.window.registerFileDecorationProvider(new ChangeDecorationProvider()),
    ...registerCompareCommands({ session, state, service }),
  );

  return { session, compareState: state, compareService: service };
}

export function deactivate(): void {}
