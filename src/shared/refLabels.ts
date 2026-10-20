// Shared by the extension host (tests) and the webview: no Node or vscode imports.

import { RefBadge } from './protocol';

/** One ref label (pill) on a commit row. */
export interface RefLabel {
  kind: 'branch' | 'remote' | 'tag';
  /** Main text: the branch or tag name, or just the remote name (see below). */
  text: string;
  /** Shown dimmed before `text`: `origin/` for a remote branch shown in full. */
  prefix?: string;
  /** Full ref names, for the tooltip. */
  title: string;
  /** The checked-out branch. */
  current: boolean;
}

/** A commit row's labels, split over its two text lines. */
export interface RefLines {
  /** Local branches (the checked-out one first), then tags: next to the subject. */
  top: RefLabel[];
  /** Remote-tracking branches: next to the author, date and hash. */
  bottom: RefLabel[];
}

/**
 * Splits a commit's refs into the two lines of its row. Local branches and
 * tags go on top, remote-tracking branches below, so remotes never crowd
 * the subject.
 *
 * A remote branch with the same name as a local branch on the same commit
 * (`origin/main` next to `main`: the branch is pushed) is shortened to its
 * remote's name, `origin`, right under the local branch. Several such
 * branches of one remote share one label. Other remote branches show their
 * full name, with the remote dimmed.
 */
export function refLines(refs: readonly RefBadge[]): RefLines {
  const locals = refs.filter((ref) => ref.kind === 'head');
  const localNames = new Set(locals.map((ref) => ref.name));
  const branches: RefLabel[] = [...locals]
    // Stable sort: the checked-out branch first, the others in git's order.
    .sort((a, b) => Number(b.current) - Number(a.current))
    .map((ref) => ({ kind: 'branch', text: ref.name, title: ref.name, current: ref.current }));
  const tags: RefLabel[] = refs
    .filter((ref) => ref.kind === 'tag')
    .map((ref) => ({ kind: 'tag', text: ref.name, title: ref.name, current: false }));

  /** Remote name → the full names of its branches that mirror a local branch. */
  const pushed = new Map<string, string[]>();
  const others: RefLabel[] = [];
  for (const ref of refs) {
    if (ref.kind !== 'remote') {
      continue;
    }
    const remote = ref.remote && ref.name.startsWith(`${ref.remote}/`) ? ref.remote : undefined;
    const branch = remote ? ref.name.slice(remote.length + 1) : ref.name;
    if (remote && localNames.has(branch)) {
      const names = pushed.get(remote);
      if (names) {
        names.push(ref.name);
      } else {
        pushed.set(remote, [ref.name]);
      }
    } else if (remote) {
      others.push({ kind: 'remote', text: branch, prefix: `${remote}/`, title: ref.name, current: false });
    } else {
      others.push({ kind: 'remote', text: ref.name, title: ref.name, current: false });
    }
  }
  const mirrors: RefLabel[] = [...pushed].map(([remote, names]) => ({
    kind: 'remote',
    text: remote,
    title: names.join(', '),
    current: false,
  }));

  return { top: [...branches, ...tags], bottom: [...mirrors, ...others] };
}
