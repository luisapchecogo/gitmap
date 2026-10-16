import * as vscode from 'vscode';
import { GitFileSystemProvider } from './compare/gitFileSystemProvider';
import { GIT_SCHEME } from './compare/gitUri';
import { Session } from './state/session';

export function activate(context: vscode.ExtensionContext): void {
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

  // Placeholder until the commit-comparison tree exists: an empty tree makes
  // VS Code show the view's welcome content from package.json.
  const emptyTree: vscode.TreeDataProvider<vscode.TreeItem> = {
    getTreeItem: (item) => item,
    getChildren: () => [],
  };

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('gitmap.compare', emptyTree),
  );
}

export function deactivate(): void {}
