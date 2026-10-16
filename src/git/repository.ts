import * as path from 'path';
import { FileChange, LineStats, parseNumstat, parseRawDiff } from '../core/diffParser';
import { GitExecOptions, GitResult, GitRunner } from '../core/gitRunner';
import { CommitInfo, LOG_FORMAT, parseLog } from '../core/logParser';
import { GitRef, parseRefs, REF_FORMAT, REF_PATTERNS } from '../core/refsParser';
import { Revision, revisionLabel } from '../core/revision';

export type RepoCallOptions = Omit<GitExecOptions, 'cwd'>;

export interface HeadState {
  /** Commit HEAD points to; `undefined` in a repository with no commits. */
  commit: string | undefined;
  /** Checked-out branch; `undefined` when HEAD is detached. */
  branch: string | undefined;
}

export type CommitOrder = 'date' | 'topo';

export interface LogQuery {
  /** Commit hashes to walk from (see selectTips). */
  tips: readonly string[];
  order: CommitOrder;
  /** Commits to skip from the start of the walk. */
  skip: number;
  maxCount: number;
}

export interface ChangesRequest {
  /** Left side. Must not be the working tree. */
  base: Revision;
  /** Right side. Must not be the empty tree. */
  target: Revision;
  /**
   * Compare from the merge base of base and target instead of base itself:
   * only what the target added since it diverged, as a pull request shows.
   */
  mergeBase?: boolean;
}

export interface ChangesResult {
  /** Tree-ish the left side was read from: a commit hash or the empty tree hash. */
  left: string;
  /** Commit hash of the right side; `undefined` for the working tree. */
  right: string | undefined;
  /** In merge-base mode, the commit used as the left side. */
  mergeBase?: string;
  changes: FileChange[];
}

/** Arguments shared by every diff GitMap runs. */
const DIFF_OPTIONS = ['-M', '--no-abbrev', '--no-color', '--no-ext-diff'];

/**
 * One git repository on disk. Holds no state of its own: every method runs
 * git in `root`. Kept free of `vscode` imports so it can be tested directly.
 */
export class GitRepository {
  private emptyTree: Promise<string> | undefined;

  constructor(
    readonly root: string,
    readonly runner: GitRunner,
  ) {}

  /** Folder name shown in pickers. */
  get name(): string {
    return path.basename(this.root);
  }

  exec(args: readonly string[], options: RepoCallOptions = {}): Promise<GitResult> {
    return this.runner.exec(args, { ...options, cwd: this.root });
  }

  text(args: readonly string[], options: RepoCallOptions = {}): Promise<string> {
    return this.runner.text(args, { ...options, cwd: this.root });
  }

  /**
   * Resolves a revision (branch, tag, hash, `HEAD~2`, ...) to a full commit
   * hash, or `undefined` if it does not name a commit.
   */
  async resolveCommit(revision: string, options: RepoCallOptions = {}): Promise<string | undefined> {
    // rev-parse has no reliable --end-of-options on older git, so refuse
    // anything git could read as an option instead.
    if (!revision || revision.startsWith('-')) {
      return undefined;
    }
    const result = await this.exec(['rev-parse', '--verify', '--quiet', `${revision}^{commit}`], {
      ...options,
      okExitCodes: [0, 1, 128],
    });
    const hash = result.stdout.toString('utf8').trim();
    return result.exitCode === 0 && hash ? hash : undefined;
  }

  /** Local branches, remote-tracking branches and tags. */
  async getRefs(options: RepoCallOptions = {}): Promise<GitRef[]> {
    const output = await this.text(['for-each-ref', `--format=${REF_FORMAT}`, ...REF_PATTERNS], options);
    return parseRefs(output);
  }

  async getHead(options: RepoCallOptions = {}): Promise<HeadState> {
    const [commit, branch] = await Promise.all([
      this.resolveCommit('HEAD', options),
      this.exec(['symbolic-ref', '--quiet', '--short', 'HEAD'], { ...options, okExitCodes: [0, 1, 128] }).then((result) =>
        result.exitCode === 0 ? result.stdout.toString('utf8').trim() || undefined : undefined,
      ),
    ]);
    return { commit, branch };
  }

  /**
   * One page of history from the given tips, newest first. Tips go through
   * stdin (`--stdin`), which avoids command-line length limits on Windows
   * for repositories with thousands of refs.
   */
  async getLog(query: LogQuery, options: RepoCallOptions = {}): Promise<CommitInfo[]> {
    if (query.tips.length === 0 || query.maxCount <= 0) {
      return [];
    }
    const output = await this.text(
      [
        'log',
        '-z',
        `--format=${LOG_FORMAT}`,
        query.order === 'topo' ? '--topo-order' : '--date-order',
        `--max-count=${query.maxCount}`,
        `--skip=${query.skip}`,
        '--no-color',
        '--stdin',
      ],
      { ...options, stdin: query.tips.join('\n') + '\n' },
    );
    return parseLog(output);
  }

  /**
   * Commits matching `query`, newest first, at most `limit`: the commit the
   * query names (a full or short hash, a branch, `HEAD~2`, ...), plus
   * commits reachable from `tips` whose message or author contains the
   * query (case-insensitive, taken literally rather than as a pattern).
   */
  async searchCommits(
    query: string,
    tips: readonly string[],
    limit: number,
    options: RepoCallOptions = {},
  ): Promise<{ hashes: string[]; truncated: boolean }> {
    const text = query.trim();
    if (!text) {
      return { hashes: [], truncated: false };
    }
    const stdin = tips.join('\n') + '\n';
    const find = async (filter: string): Promise<{ hash: string; time: number }[]> => {
      if (tips.length === 0) {
        return [];
      }
      const output = await this.text(
        ['log', '-z', '--format=%H %ct', '--regexp-ignore-case', '--fixed-strings', filter, `--max-count=${limit + 1}`, '--stdin'],
        { ...options, stdin },
      );
      return output
        .split('\0')
        .filter((line) => line)
        .map((line) => {
          const [hash, time] = line.trim().split(' ');
          return { hash, time: Number(time) };
        });
    };
    const named = async (): Promise<{ hash: string; time: number }[]> => {
      const hash = await this.resolveCommit(text, options);
      if (!hash) {
        return [];
      }
      const time = await this.text(['show', '-s', '--format=%ct', hash], options);
      return [{ hash, time: Number(time.trim()) }];
    };

    const results = await Promise.all([named(), find(`--grep=${text}`), find(`--author=${text}`)]);
    const byHash = new Map<string, number>();
    for (const { hash, time } of results.flat()) {
      byHash.set(hash, time);
    }
    const sorted = [...byHash].sort((a, b) => b[1] - a[1]).map(([hash]) => hash);
    return { hashes: sorted.slice(0, limit), truncated: sorted.length > limit };
  }

  /** Number of commits reachable from the tips. */
  async countCommits(tips: readonly string[], options: RepoCallOptions = {}): Promise<number> {
    if (tips.length === 0) {
      return 0;
    }
    const output = await this.text(['rev-list', '--count', '--stdin'], { ...options, stdin: tips.join('\n') + '\n' });
    return Number.parseInt(output.trim(), 10) || 0;
  }

  /** Hash of the empty tree in this repository's object format (SHA-1 or SHA-256). */
  emptyTreeHash(): Promise<string> {
    this.emptyTree ??= this.text(['hash-object', '-t', 'tree', '--stdin'], { stdin: '' }).then(
      (hash) => hash.trim(),
      (error: unknown) => {
        this.emptyTree = undefined;
        throw error;
      },
    );
    return this.emptyTree;
  }

  /** First parent of a commit, or the empty tree hash for a root commit. */
  async parentOrEmptyTree(commit: string, options: RepoCallOptions = {}): Promise<string> {
    return (await this.resolveCommit(`${commit}^1`, options)) ?? (await this.emptyTreeHash());
  }

  /**
   * Lists the files that differ between two revisions, or between a
   * revision and the working tree (untracked files included).
   */
  async getChanges(request: ChangesRequest, options: RepoCallOptions = {}): Promise<ChangesResult> {
    const { base, target } = request;
    if (base.kind === 'workingTree') {
      throw new Error('The working tree can only be the target of a comparison.');
    }
    if (target.kind === 'emptyTree') {
      throw new Error('The empty tree can only be the base of a comparison.');
    }

    const right = target.kind === 'commit' ? await this.requireCommit(target, options) : undefined;
    let left = base.kind === 'commit' ? await this.requireCommit(base, options) : await this.emptyTreeHash();
    let mergeBase: string | undefined;

    if (request.mergeBase && base.kind === 'commit') {
      const other = right ?? (await this.resolveCommit('HEAD', options));
      if (!other) {
        throw new Error('The working tree has no commits to find a merge base with.');
      }
      const result = await this.exec(['merge-base', '--end-of-options', left, other], {
        ...options,
        okExitCodes: [0, 1],
      });
      mergeBase = result.stdout.toString('utf8').trim();
      if (result.exitCode !== 0 || !mergeBase) {
        throw new Error(
          `${revisionLabel(base)} and ${revisionLabel(target)} have no common ancestor, so there is no merge base to compare from.`,
        );
      }
      left = mergeBase;
    }

    const revisions = right ? [left, right] : [left];
    const output = await this.text(['diff', '--raw', '-z', ...DIFF_OPTIONS, '--end-of-options', ...revisions, '--'], options);
    const changes = parseRawDiff(output);
    if (!right) {
      changes.push(...(await this.untrackedFiles(options)));
    }
    return { left, right, mergeBase, changes };
  }

  /**
   * Added/removed line counts per file between two tree-ishes (or a
   * tree-ish and the working tree), with the same rename detection as
   * {@link getChanges}.
   */
  async getLineStats(left: string, right: string | undefined, options: RepoCallOptions = {}): Promise<LineStats[]> {
    const revisions = right ? [left, right] : [left];
    const output = await this.text(['diff', '--numstat', '-z', ...DIFF_OPTIONS, '--end-of-options', ...revisions, '--'], options);
    return parseNumstat(output);
  }

  /** Untracked, non-ignored files in the working tree, as `?` changes. */
  async untrackedFiles(options: RepoCallOptions = {}): Promise<FileChange[]> {
    const output = await this.text(['ls-files', '--others', '--exclude-standard', '-z'], options);
    const nullOid = (await this.emptyTreeHash()).replace(/./g, '0');
    return output
      .split('\0')
      .filter((file) => file)
      .map((file): FileChange => ({
        status: '?',
        path: file,
        oldMode: '000000',
        newMode: '100644',
        oldOid: nullOid,
        newOid: nullOid,
      }));
  }

  private async requireCommit(revision: Extract<Revision, { kind: 'commit' }>, options: RepoCallOptions): Promise<string> {
    const hash = await this.resolveCommit(revision.ref, options);
    if (!hash) {
      throw new Error(`"${revision.label}" is not a commit in ${this.name}.`);
    }
    return hash;
  }
}
