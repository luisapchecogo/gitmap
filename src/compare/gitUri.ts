import * as vscode from 'vscode';
import { ChangeStatus } from '../core/diffParser';

/** Read-only file system serving blobs from a repository's object database. */
export const GIT_SCHEME = 'gitmap';

/**
 * Identity-only URIs for items in the Changes tree. They give VS Code a
 * file name to pick an icon from, and carry the status our decoration
 * provider shows. They are never opened.
 */
export const CHANGE_SCHEME = 'gitmap-change';

/** Everything needed to read one side of a diff, encoded into a `gitmap:` URI. */
export interface GitFileRef {
  /** Absolute path of the repository root. */
  repo: string;
  /** Path of the file inside the repository (forward slashes). */
  path: string;
  /** Blob id to read. All zeros means the file does not exist on this side. */
  oid: string;
  /** Git file mode; `160000` marks a submodule. */
  mode: string;
  /** Label of the revision, e.g. `main` or `5b230b6` (informational). */
  ref: string;
}

/**
 * Builds a `gitmap:` URI. The repository-relative path is the URI path, so
 * editors show the right file name and pick the language from it; the rest
 * goes into the query. Diff editors restored after a reload reopen these
 * URIs as they are, so they must stay self-contained.
 */
export function toGitUri(ref: GitFileRef): vscode.Uri {
  const query = new URLSearchParams({ repo: ref.repo, oid: ref.oid, mode: ref.mode, ref: ref.ref });
  return vscode.Uri.from({ scheme: GIT_SCHEME, path: `/${ref.path}`, query: query.toString() });
}

export function fromGitUri(uri: vscode.Uri): GitFileRef {
  if (uri.scheme !== GIT_SCHEME) {
    throw vscode.FileSystemError.FileNotFound(uri);
  }
  const query = new URLSearchParams(uri.query);
  const repo = query.get('repo');
  const oid = query.get('oid');
  if (!repo || !oid || !/^[0-9a-f]+$/i.test(oid)) {
    throw vscode.FileSystemError.FileNotFound(uri);
  }
  return {
    repo,
    path: uri.path.replace(/^\//, ''),
    oid,
    mode: query.get('mode') ?? '100644',
    ref: query.get('ref') ?? '',
  };
}

/** Builds the resource URI for a Changes tree item. */
export function toChangeUri(path: string, status: ChangeStatus): vscode.Uri {
  return vscode.Uri.from({ scheme: CHANGE_SCHEME, path: `/${path}`, query: new URLSearchParams({ s: status }).toString() });
}

/** Reads the status back from a Changes tree item URI. */
export function changeStatusOf(uri: vscode.Uri): ChangeStatus | undefined {
  return (new URLSearchParams(uri.query).get('s') as ChangeStatus | null) ?? undefined;
}
