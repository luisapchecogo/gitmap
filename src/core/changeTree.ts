import { FileChange } from './diffParser';

export interface ChangeFolderNode {
  kind: 'folder';
  /** `d:<path>`; unique even when a file has the same path. */
  id: string;
  /** Display name; compacted chains read `a/b/c`. */
  name: string;
  /** Full path of the (deepest) folder, relative to the repository root. */
  path: string;
  children: ChangeTreeNode[];
  /** Number of files shown under this folder. */
  fileCount: number;
}

export interface ChangeFileNode {
  kind: 'file';
  /** `f:<path>`. */
  id: string;
  name: string;
  path: string;
  change: FileChange;
}

/** Placeholder at the end of a truncated tree. */
export interface ChangeMoreNode {
  kind: 'more';
  id: string;
  /** Files not shown. */
  remaining: number;
}

export type ChangeTreeNode = ChangeFolderNode | ChangeFileNode | ChangeMoreNode;

export interface ChangeTree {
  roots: ChangeTreeNode[];
  /** Files included in the tree. */
  shown: number;
  /** Files in the comparison. */
  total: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Explorer name order: natural and case-insensitive, then exact as a tiebreak. */
function compareNames(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

interface Draft {
  folders: Map<string, Draft>;
  files: ChangeFileNode[];
  path: string;
  name: string;
}

function newDraft(name: string, path: string): Draft {
  return { folders: new Map(), files: [], name, path };
}

/**
 * Groups changed files into an explorer-style folder tree.
 *
 * Children are sorted like VS Code's Explorer, then at most `limit` files
 * are kept in that display order (so truncation cuts the bottom of the
 * tree, not random files), and finally chains of single-child folders are
 * compacted into one `a/b/c` node.
 */
export function buildChangeTree(changes: readonly FileChange[], limit = Number.POSITIVE_INFINITY): ChangeTree {
  const root = newDraft('', '');
  const usedIds = new Set<string>();

  for (const change of changes) {
    const segments = change.path.split('/');
    const fileName = segments.pop() ?? change.path;
    let folder = root;
    for (const segment of segments) {
      const path = folder.path ? `${folder.path}/${segment}` : segment;
      let next = folder.folders.get(segment);
      if (!next) {
        next = newDraft(segment, path);
        folder.folders.set(segment, next);
      }
      folder = next;
    }
    let id = `f:${change.path}`;
    for (let n = 2; usedIds.has(id); n++) {
      id = `f:${change.path}#${n}`;
    }
    usedIds.add(id);
    folder.files.push({ kind: 'file', id, name: fileName, path: change.path, change });
  }

  let budget = Math.max(0, limit);
  const take = (draft: Draft): ChangeTreeNode[] => {
    // Folders first, then files, like the Explorer.
    const nodes: ChangeTreeNode[] = [];
    const folders = [...draft.folders.values()].sort((a, b) => compareNames(a.name, b.name));
    for (const child of folders) {
      if (budget <= 0) {
        break;
      }
      const children = take(child);
      if (children.length > 0) {
        nodes.push(compact({ kind: 'folder', id: `d:${child.path}`, name: child.name, path: child.path, children, fileCount: 0 }));
      }
    }
    for (const file of [...draft.files].sort((a, b) => compareNames(a.name, b.name))) {
      if (budget <= 0) {
        break;
      }
      budget--;
      nodes.push(file);
    }
    return nodes;
  };

  const roots = take(root);
  for (const node of roots) {
    countFiles(node);
  }
  const shown = Math.min(changes.length, Math.max(0, limit));
  if (shown < changes.length) {
    roots.push({ kind: 'more', id: 'more', remaining: changes.length - shown });
  }
  return { roots, shown, total: changes.length };
}

/** Merges a folder whose only child is a folder into one `a/b` node. */
function compact(folder: ChangeFolderNode): ChangeFolderNode {
  let current = folder;
  while (current.children.length === 1 && current.children[0].kind === 'folder') {
    const only: ChangeFolderNode = current.children[0];
    current = { ...only, name: `${current.name}/${only.name}` };
  }
  return current;
}

function countFiles(node: ChangeTreeNode): number {
  if (node.kind === 'file') {
    return 1;
  }
  if (node.kind === 'more') {
    return 0;
  }
  node.fileCount = node.children.reduce((sum, child) => sum + countFiles(child), 0);
  return node.fileCount;
}
