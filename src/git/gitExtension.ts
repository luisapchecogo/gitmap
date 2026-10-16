import * as vscode from 'vscode';
import type { API, GitExtension } from './git';

/**
 * Looks up the built-in Git extension without depending on it.
 *
 * GitMap uses it only for hints (repository discovery, the configured git
 * path, change events). Declaring it in `extensionDependencies` would
 * disable GitMap whenever the user disables Git, so it is resolved softly
 * and every caller must cope with `undefined`.
 */
export async function getGitExtension(): Promise<GitExtension | undefined> {
  const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!extension) {
    return undefined;
  }
  try {
    return extension.isActive ? extension.exports : await extension.activate();
  } catch {
    return undefined;
  }
}

/** Returns the Git API, or `undefined` when the extension is missing or disabled. */
export function getGitApi(extension: GitExtension | undefined): API | undefined {
  if (!extension?.enabled) {
    return undefined;
  }
  try {
    return extension.getAPI(1);
  } catch {
    return undefined;
  }
}
