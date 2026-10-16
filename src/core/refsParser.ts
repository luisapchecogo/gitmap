export type RefKind = 'head' | 'remote' | 'tag';

export interface GitRef {
  kind: RefKind;
  /** Full name, e.g. `refs/heads/main`. */
  fullName: string;
  /** Short display name: `main`, `origin/main`, `v1.0`. */
  name: string;
  /** Commit the ref points to (annotated tags are peeled). */
  commit: string;
  /** True for the checked-out branch. */
  isHead: boolean;
  /** Short name of the upstream branch, for local branches that track one. */
  upstream?: string;
  /** Remote name, for remote-tracking branches. */
  remote?: string;
}

/** Format string for {@link parseRefs}: one ref per line, fields separated by NUL. */
export const REF_FORMAT = [
  '%(refname)',
  '%(objecttype)',
  '%(objectname)',
  '%(*objecttype)',
  '%(*objectname)',
  '%(HEAD)',
  '%(upstream)',
  '%(symref)',
].join('%00');

/** Ref namespaces GitMap shows. */
export const REF_PATTERNS = ['refs/heads', 'refs/remotes', 'refs/tags'];

const PREFIXES: [string, RefKind][] = [
  ['refs/heads/', 'head'],
  ['refs/remotes/', 'remote'],
  ['refs/tags/', 'tag'],
];

/**
 * Parses `git for-each-ref --format=<REF_FORMAT>` output.
 *
 * Symbolic refs such as `origin/HEAD` are skipped (they duplicate the
 * branch they point to), and so are tags that do not end at a commit
 * (tags of trees or blobs).
 */
export function parseRefs(output: string): GitRef[] {
  const refs: GitRef[] = [];
  for (const line of output.split('\n')) {
    if (!line) {
      continue;
    }
    const [fullName, type, oid, peeledType, peeledOid, head, upstream, symref] = line.split('\0');
    if (symref) {
      continue;
    }
    const prefix = PREFIXES.find(([p]) => fullName.startsWith(p));
    if (!prefix) {
      continue;
    }
    const [prefixText, kind] = prefix;
    let commit: string | undefined;
    if (type === 'commit') {
      commit = oid;
    } else if (type === 'tag' && peeledType === 'commit') {
      commit = peeledOid;
    }
    if (!commit) {
      continue;
    }
    const name = fullName.slice(prefixText.length);
    const ref: GitRef = { kind, fullName, name, commit, isHead: head === '*' };
    if (upstream) {
      ref.upstream = upstream.replace(/^refs\/remotes\//, '');
    }
    if (kind === 'remote') {
      ref.remote = name.split('/')[0];
    }
    refs.push(ref);
  }
  return refs;
}

/** Groups refs by the commit they point to, for drawing badges. */
export function refsByCommit(refs: readonly GitRef[]): Map<string, GitRef[]> {
  const map = new Map<string, GitRef[]>();
  for (const ref of refs) {
    const list = map.get(ref.commit);
    if (list) {
      list.push(ref);
    } else {
      map.set(ref.commit, [ref]);
    }
  }
  return map;
}
