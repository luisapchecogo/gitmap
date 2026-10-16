import * as path from 'path';
import { GitExecOptions, GitResult, GitRunner } from '../core/gitRunner';

export type RepoCallOptions = Omit<GitExecOptions, 'cwd'>;

/**
 * One git repository on disk. Holds no state of its own: every method runs
 * git in `root`. Kept free of `vscode` imports so it can be tested directly.
 */
export class GitRepository {
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
}
