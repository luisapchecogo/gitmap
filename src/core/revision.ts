/**
 * One side of a comparison.
 *
 * - `commit`: anything git resolves to a commit (branch, tag, hash,
 *   `HEAD~2`). `label` is what the UI shows, e.g. `main` or `5b230b6`.
 * - `workingTree`: the files on disk, including untracked ones.
 * - `emptyTree`: nothing at all; the left side when showing a root commit.
 */
export type Revision =
  | { readonly kind: 'commit'; readonly ref: string; readonly label: string }
  | { readonly kind: 'workingTree' }
  | { readonly kind: 'emptyTree' };

export const WORKING_TREE: Revision = { kind: 'workingTree' };
export const EMPTY_TREE: Revision = { kind: 'emptyTree' };

export function commitRevision(ref: string, label: string = ref): Revision {
  return { kind: 'commit', ref, label };
}

/** Text shown for a revision in titles, pickers and the footer. */
export function revisionLabel(revision: Revision): string {
  switch (revision.kind) {
    case 'commit':
      return revision.label;
    case 'workingTree':
      return 'Working Tree';
    case 'emptyTree':
      return 'Empty';
  }
}

export function sameRevision(a: Revision, b: Revision): boolean {
  if (a.kind === 'commit' && b.kind === 'commit') {
    return a.ref === b.ref;
  }
  return a.kind === b.kind;
}

/** Abbreviates a full commit hash for display. */
export function shortHash(hash: string): string {
  return hash.slice(0, 7);
}
