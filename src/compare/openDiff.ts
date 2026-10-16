import * as path from 'path';
import * as vscode from 'vscode';
import { FileChange, GITLINK_MODE } from '../core/diffParser';
import { CompareResult } from './compareState';
import { toGitUri } from './gitUri';

export interface ChangeUris {
  /** Left side, or `undefined` when the file did not exist there. */
  left: vscode.Uri | undefined;
  /** Right side, or `undefined` when the file no longer exists there. */
  right: vscode.Uri | undefined;
  /** URI identifying the change (the right side, or the left for deletions). */
  resource: vscode.Uri;
}

/** Any all-zero id reads as an empty file. */
const NULL_OID = '0'.repeat(40);

function workingTreeTarget(result: CompareResult): boolean {
  return result.right === undefined;
}

/**
 * The URIs for both sides of one changed file. Committed content comes
 * from `gitmap:` (read by blob id); with the working tree as target the
 * right side is the real file, so it can be edited in the diff editor.
 */
export function changeUris(result: CompareResult, change: FileChange): ChangeUris {
  const repo = result.repository.root;
  const added = change.status === 'A' || change.status === '?';
  const deleted = change.status === 'D';

  const left = added
    ? undefined
    : toGitUri({
        repo,
        path: change.oldPath ?? change.path,
        oid: change.oldOid,
        mode: change.oldMode,
        ref: result.leftLabel,
      });

  let right: vscode.Uri | undefined;
  if (!deleted) {
    if (workingTreeTarget(result) && change.newMode !== GITLINK_MODE) {
      right = vscode.Uri.file(path.join(repo, ...change.path.split('/')));
    } else {
      right = toGitUri({ repo, path: change.path, oid: change.newOid, mode: change.newMode, ref: result.rightLabel });
    }
  }
  const resource = right ?? left ?? vscode.Uri.file(path.join(repo, change.path));
  return { left, right, resource };
}

/** An empty `gitmap:` file standing in for a side that does not exist. */
function emptySide(result: CompareResult, filePath: string, label: string): vscode.Uri {
  return toGitUri({ repo: result.repository.root, path: filePath, oid: NULL_OID, mode: '100644', ref: label });
}

/** Editor title: `name (left) ↔ name (right)`. */
export function diffTitle(result: CompareResult, change: FileChange): string {
  const leftName = path.posix.basename(change.oldPath ?? change.path);
  const rightName = path.posix.basename(change.path);
  return `${leftName} (${result.leftLabel}) ↔ ${rightName} (${result.rightLabel})`;
}

/** Opens VS Code's diff editor for one changed file: base on the left, target on the right. */
export async function openChange(
  result: CompareResult,
  change: FileChange,
  options: vscode.TextDocumentShowOptions = { preview: true },
): Promise<void> {
  const uris = changeUris(result, change);
  const left = uris.left ?? emptySide(result, change.path, result.leftLabel);
  const right = uris.right ?? emptySide(result, change.path, result.rightLabel);
  await vscode.commands.executeCommand('vscode.diff', left, right, diffTitle(result, change), options);
}

/** Opens the target-side version of a file on its own. */
export async function openTargetFile(result: CompareResult, change: FileChange): Promise<void> {
  const uris = changeUris(result, change);
  const uri = uris.right ?? uris.left;
  if (uri) {
    await vscode.commands.executeCommand('vscode.open', uri);
  }
}
