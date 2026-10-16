import * as vscode from 'vscode';
import { Session } from './state/session';

export function activate(context: vscode.ExtensionContext): void {
  const session = new Session(context);
  context.subscriptions.push(session);

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
