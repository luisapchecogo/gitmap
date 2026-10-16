import * as vscode from 'vscode';
import { ChangeStatus } from '../core/diffParser';
import { CHANGE_SCHEME, changeStatusOf } from './gitUri';

interface StatusStyle {
  badge: string;
  tooltip: string;
  color: string;
}

const STYLES: Record<ChangeStatus, StatusStyle> = {
  A: { badge: 'A', tooltip: 'Added', color: 'gitmap.addedResourceForeground' },
  C: { badge: 'C', tooltip: 'Copied', color: 'gitmap.addedResourceForeground' },
  D: { badge: 'D', tooltip: 'Deleted', color: 'gitmap.deletedResourceForeground' },
  M: { badge: 'M', tooltip: 'Modified', color: 'gitmap.modifiedResourceForeground' },
  R: { badge: 'R', tooltip: 'Renamed', color: 'gitmap.renamedResourceForeground' },
  T: { badge: 'T', tooltip: 'Type changed', color: 'gitmap.modifiedResourceForeground' },
  U: { badge: '!', tooltip: 'Unmerged (conflict)', color: 'gitmap.modifiedResourceForeground' },
  X: { badge: 'X', tooltip: 'Unknown change', color: 'gitmap.modifiedResourceForeground' },
  '?': { badge: 'U', tooltip: 'Untracked', color: 'gitmap.untrackedResourceForeground' },
};

export function statusTooltip(status: ChangeStatus): string {
  return STYLES[status].tooltip;
}

/**
 * Status letters and colors for Changes tree items. Only `gitmap-change:`
 * URIs are decorated, so nothing leaks onto the Explorer or other views.
 */
export class ChangeDecorationProvider implements vscode.FileDecorationProvider {
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== CHANGE_SCHEME) {
      return undefined;
    }
    const status = changeStatusOf(uri);
    const style = status && STYLES[status];
    if (!style) {
      return undefined;
    }
    return new vscode.FileDecoration(style.badge, style.tooltip, new vscode.ThemeColor(style.color));
  }
}
