/**
 * Status of one changed path, as reported by `git diff --raw`, plus `?` for
 * untracked files (which git lists separately).
 *
 * A added, C copied, D deleted, M modified, R renamed, T type changed
 * (e.g. file ↔ symlink), U unmerged, X unknown, ? untracked.
 */
export type ChangeStatus = 'A' | 'C' | 'D' | 'M' | 'R' | 'T' | 'U' | 'X' | '?';

export interface FileChange {
  status: ChangeStatus;
  /** Path on the target (right) side, relative to the repository root. */
  path: string;
  /** Source path for renames and copies. */
  oldPath?: string;
  /** Git file modes, e.g. `100644`, `100755`, `120000` (symlink), `160000` (submodule). */
  oldMode: string;
  newMode: string;
  /** Blob ids; all zeros when that side does not exist or is the working tree. */
  oldOid: string;
  newOid: string;
  /** Similarity percentage for renames and copies. */
  score?: number;
  /** Lines added/removed, filled in later by numstat; `null` for binary files. */
  additions?: number | null;
  deletions?: number | null;
}

/** Mode of a submodule entry (a "gitlink"). */
export const GITLINK_MODE = '160000';

/** True for an object id made only of zeros (git's "no object" marker). */
export function isNullOid(oid: string): boolean {
  return /^0+$/.test(oid);
}

const STATUSES = new Set<string>(['A', 'C', 'D', 'M', 'R', 'T', 'U', 'X']);

/**
 * Parses `git diff --raw -z` output.
 *
 * Each record is `:<oldMode> <newMode> <oldOid> <newOid> <status>[score]`
 * followed by NUL and the path, and for renames/copies a second NUL and the
 * destination path. Splitting on NUL keeps paths with spaces, tabs or
 * newlines intact.
 */
export function parseRawDiff(output: string): FileChange[] {
  const tokens = output.split('\0');
  const changes: FileChange[] = [];
  let i = 0;
  while (i < tokens.length) {
    const header = tokens[i++];
    if (!header) {
      continue;
    }
    if (!header.startsWith(':')) {
      throw new Error(`Unexpected git diff --raw record: ${JSON.stringify(header.slice(0, 80))}`);
    }
    const [oldMode, newMode, oldOid, newOid, statusField] = header.slice(1).split(' ');
    const letter = statusField?.charAt(0) ?? '';
    if (!STATUSES.has(letter) || newOid === undefined) {
      throw new Error(`Unexpected git diff --raw record: ${JSON.stringify(header.slice(0, 80))}`);
    }
    const status = letter as ChangeStatus;
    const scoreText = statusField.slice(1);
    const first = tokens[i++] ?? '';
    const change: FileChange = { status, path: first, oldMode, newMode, oldOid, newOid };
    if (status === 'R' || status === 'C') {
      change.oldPath = first;
      change.path = tokens[i++] ?? '';
    }
    if (scoreText) {
      change.score = Number.parseInt(scoreText, 10);
    }
    changes.push(change);
  }
  return changes;
}

export interface LineStats {
  path: string;
  oldPath?: string;
  /** `null` when git reports the file as binary. */
  additions: number | null;
  deletions: number | null;
}

/**
 * Parses `git diff --numstat -z` output.
 *
 * Records are `<added>\t<deleted>\t<path>\0`, or for renames/copies
 * `<added>\t<deleted>\t\0<old>\0<new>\0`. Binary files report `-` counts.
 */
export function parseNumstat(output: string): LineStats[] {
  const tokens = output.split('\0');
  const stats: LineStats[] = [];
  let i = 0;
  while (i < tokens.length) {
    const record = tokens[i++];
    if (!record) {
      continue;
    }
    const firstTab = record.indexOf('\t');
    const secondTab = record.indexOf('\t', firstTab + 1);
    if (firstTab < 0 || secondTab < 0) {
      throw new Error(`Unexpected git diff --numstat record: ${JSON.stringify(record.slice(0, 80))}`);
    }
    const count = (text: string): number | null => (text === '-' ? null : Number.parseInt(text, 10));
    const entry: LineStats = {
      additions: count(record.slice(0, firstTab)),
      deletions: count(record.slice(firstTab + 1, secondTab)),
      path: record.slice(secondTab + 1),
    };
    if (entry.path === '') {
      entry.oldPath = tokens[i++] ?? '';
      entry.path = tokens[i++] ?? '';
    }
    stats.push(entry);
  }
  return stats;
}

/** Copies numstat counts onto the matching changes (matched by target path). */
export function applyLineStats(changes: FileChange[], stats: readonly LineStats[]): void {
  const byPath = new Map(stats.map((stat) => [stat.path, stat]));
  for (const change of changes) {
    const stat = byPath.get(change.path);
    if (stat) {
      change.additions = stat.additions;
      change.deletions = stat.deletions;
    }
  }
}
