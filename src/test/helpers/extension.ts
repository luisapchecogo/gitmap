import * as vscode from 'vscode';
import type { GitMapTestApi } from '../../extension';

/** Activates GitMap and returns its internals for integration tests. */
export async function activateGitMap(): Promise<GitMapTestApi> {
  const extension = vscode.extensions.getExtension<GitMapTestApi>('luispacheco.gitmap');
  if (!extension) {
    throw new Error('GitMap is not loaded in the test instance.');
  }
  return extension.activate();
}

/** Closes every editor so tests that open diffs start clean. */
export async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}
