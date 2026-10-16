import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/** First commit timestamp: 2024-01-01T00:00:00Z. Each commit adds a minute. */
const BASE_TIME = 1704067200;

/**
 * A throwaway git repository for integration tests.
 *
 * Every git call uses an isolated configuration (no user or system config)
 * and fixed author/committer dates, so hashes and ordering are reproducible
 * no matter who runs the tests.
 */
export class TempRepo {
  private clock = 0;

  private constructor(
    /** Repository root (a real path: macOS's /var symlink is resolved). */
    readonly root: string,
    /** Environment that isolates git from the machine's configuration. */
    readonly env: Record<string, string>,
  ) {}

  static async create(options: { init?: boolean } = {}): Promise<TempRepo> {
    const tmp = await fs.realpath(os.tmpdir());
    const dir = await fs.mkdtemp(path.join(tmp, 'gitmap-test-'));
    const root = path.join(dir, 'repo');
    await fs.mkdir(root);
    const configPath = path.join(dir, 'gitconfig');
    await fs.writeFile(
      configPath,
      [
        '[user]',
        '\tname = GitMap Test',
        '\temail = test@example.com',
        '[init]',
        '\tdefaultBranch = main',
        '[commit]',
        '\tgpgSign = false',
        '[tag]',
        '\tgpgSign = false',
        '',
      ].join('\n'),
    );
    const env = {
      GIT_CONFIG_GLOBAL: configPath,
      GIT_CONFIG_NOSYSTEM: '1',
    };
    const repo = new TempRepo(root, env);
    if (options.init !== false) {
      await repo.git('init', '--quiet');
    }
    return repo;
  }

  /** The temporary directory that holds the repository. */
  get dir(): string {
    return path.dirname(this.root);
  }

  /** Runs git in the repository and returns trimmed stdout. */
  git(...args: string[]): Promise<string> {
    return this.gitIn(this.root, ...args);
  }

  gitIn(cwd: string, ...args: string[]): Promise<string> {
    const time = `@${BASE_TIME + this.clock * 60} +0000`;
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        args,
        {
          cwd,
          env: {
            ...process.env,
            ...this.env,
            GIT_AUTHOR_DATE: time,
            GIT_COMMITTER_DATE: time,
          },
          maxBuffer: 64 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`git ${args.join(' ')} failed: ${stderr || error.message}`));
          } else {
            resolve(stdout.trim());
          }
        },
      );
    });
  }

  async write(relativePath: string, content: string | Uint8Array): Promise<void> {
    const file = path.join(this.root, relativePath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }

  async remove(relativePath: string): Promise<void> {
    await fs.rm(path.join(this.root, relativePath), { recursive: true, force: true });
  }

  /**
   * Stages everything and commits it. Each commit is one minute after the
   * previous one, so date order is deterministic. Returns the commit hash.
   */
  async commit(message: string, options: { allowEmpty?: boolean } = {}): Promise<string> {
    this.clock++;
    await this.git('add', '--all');
    await this.git(
      'commit',
      '--quiet',
      '--no-verify',
      ...(options.allowEmpty ? ['--allow-empty'] : []),
      '-m',
      message,
    );
    return this.git('rev-parse', 'HEAD');
  }

  /** Writes the given files and commits them. */
  async commitFiles(message: string, files: Record<string, string | Uint8Array>): Promise<string> {
    for (const [file, content] of Object.entries(files)) {
      await this.write(file, content);
    }
    return this.commit(message);
  }

  /** Advances the clock used for the next git call (merges, tags, ...). */
  tick(): void {
    this.clock++;
  }

  async dispose(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}
