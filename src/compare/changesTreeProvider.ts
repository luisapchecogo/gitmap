import * as vscode from 'vscode';
import { buildChangeTree, ChangeTree, ChangeTreeNode } from '../core/changeTree';
import { statusTooltip } from './changeDecorations';
import { CompareService } from './compareService';
import { Session } from '../state/session';
import { toChangeFolderUri, toChangeUri } from './gitUri';

export const CHANGES_VIEW_ID = 'gitmap.compare';

/** Folders start expanded unless the comparison is this large. */
const EXPAND_LIMIT = 300;

/**
 * The Changes view: the current comparison's files as a folder tree.
 * Clicking a file opens its diff.
 */
export class ChangesTreeProvider implements vscode.TreeDataProvider<ChangeTreeNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  readonly view: vscode.TreeView<ChangeTreeNode>;
  private tree: ChangeTree = { roots: [], shown: 0, total: 0 };
  private readonly disposables: vscode.Disposable[] = [this.emitter];

  constructor(
    private readonly service: CompareService,
    private readonly session: Session,
  ) {
    this.view = vscode.window.createTreeView(CHANGES_VIEW_ID, { treeDataProvider: this, showCollapseAll: true });
    this.disposables.push(this.view, service.onDidChange(() => this.refresh()));
    this.refresh();
  }

  getChildren(node?: ChangeTreeNode): ChangeTreeNode[] {
    if (!node) {
      return this.tree.roots;
    }
    return node.kind === 'folder' ? node.children : [];
  }

  getTreeItem(node: ChangeTreeNode): vscode.TreeItem {
    switch (node.kind) {
      case 'folder': {
        const item = new vscode.TreeItem(
          node.name,
          this.tree.shown > EXPAND_LIMIT ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
        );
        item.id = node.id;
        item.resourceUri = toChangeFolderUri(node.path);
        item.iconPath = vscode.ThemeIcon.Folder;
        item.description = `${node.fileCount}`;
        item.tooltip = `${node.path}\n${node.fileCount} changed ${node.fileCount === 1 ? 'file' : 'files'}`;
        item.contextValue = 'folder';
        return item;
      }
      case 'file': {
        const { change } = node;
        const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
        item.id = node.id;
        item.resourceUri = toChangeUri(node.path, change.status);
        item.iconPath = vscode.ThemeIcon.File;
        item.description = change.oldPath ? `← ${change.oldPath}` : undefined;
        item.tooltip = change.oldPath
          ? `${change.oldPath} → ${change.path}\n${statusTooltip(change.status)}`
          : `${change.path}\n${statusTooltip(change.status)}`;
        item.contextValue = 'file';
        item.command = { command: 'gitmap.openChange', title: 'Open Changes', arguments: [node] };
        return item;
      }
      case 'more': {
        const item = new vscode.TreeItem(`${node.remaining.toLocaleString()} more files…`);
        item.id = node.id;
        item.contextValue = 'more';
        return item;
      }
    }
  }

  private refresh(): void {
    const result = this.service.current;
    this.tree = result ? buildChangeTree(result.changes) : { roots: [], shown: 0, total: 0 };

    if (result) {
      const count = result.changes.length;
      const repo = this.session.repositories.length > 1 ? `${result.repository.name}: ` : '';
      this.view.description = `${repo}${result.leftLabel} ↔ ${result.rightLabel} · ${count.toLocaleString()} ${count === 1 ? 'file' : 'files'}`;
    } else {
      this.view.description = undefined;
    }

    if (this.service.error) {
      this.view.message = this.service.error;
    } else if (result && result.changes.length === 0) {
      this.view.message = `No differences between ${result.leftLabel} and ${result.rightLabel}.`;
    } else {
      this.view.message = undefined;
    }

    void vscode.commands.executeCommand('setContext', 'gitmap.hasComparison', !!result || !!this.service.error);
    void vscode.commands.executeCommand('setContext', 'gitmap.hasChanges', !!result && result.changes.length > 0);
    this.emitter.fire();
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
