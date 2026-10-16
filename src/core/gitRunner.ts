import { spawn } from 'child_process';
import { existsSync } from 'fs';

/**
 * Options for a single git invocation.
 */
export interface GitExecOptions {
  /** Working directory (the repository root). */
  cwd: string;
  /** Aborting kills the git process and rejects with {@link GitCancelledError}. */
  signal?: AbortSignal;
  /** Written to git's stdin, which is then closed. */
  stdin?: string | Buffer;
  /** Extra environment variables for this call only. */
  extraEnv?: Record<string, string>;
  /** Exit codes that count as success. Defaults to `[0]`. */
  okExitCodes?: readonly number[];
}

export interface GitResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
}

export interface GitRunnerOptions {
  /** Path to the git executable. Defaults to `git` on the PATH. */
  gitPath?: string;
  /** Environment overrides applied to every call (tests use this for isolation). */
  env?: Record<string, string>;
}

/** git exited with an unexpected code, or could not be started. */
export class GitError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly exitCode: number | undefined,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

/** The call was aborted through its `AbortSignal`. */
export class GitCancelledError extends Error {
  constructor() {
    super('The git command was cancelled.');
    this.name = 'GitCancelledError';
  }
}

export function isCancellation(error: unknown): error is GitCancelledError {
  return error instanceof GitCancelledError;
}

/**
 * Settings prepended to every command so user configuration cannot change
 * the machine-readable output GitMap parses.
 */
const CONFIG_OVERRIDES = [
  '-c', 'log.showSignature=false',
  '-c', 'i18n.logOutputEncoding=UTF-8',
  '-c', 'color.ui=false',
  '-c', 'core.quotePath=false',
];

/**
 * Environment that keeps git non-interactive and side-effect free: no
 * optional index locks (so we never block the user's own git commands), no
 * credential prompts, no pager, and pathspecs taken literally.
 */
const HARDENED_ENV: Record<string, string> = {
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  GIT_LITERAL_PATHSPECS: '1',
};

/**
 * Runs git as a child process without a shell, so arguments are never
 * interpreted by one.
 */
export class GitRunner {
  readonly gitPath: string;
  private readonly env: Record<string, string>;

  constructor(options: GitRunnerOptions = {}) {
    this.gitPath = options.gitPath ?? 'git';
    this.env = options.env ?? {};
  }

  exec(args: readonly string[], options: GitExecOptions): Promise<GitResult> {
    const { signal } = options;
    if (signal?.aborted) {
      return Promise.reject(new GitCancelledError());
    }
    const fullArgs = [...CONFIG_OVERRIDES, ...args];
    const okExitCodes = options.okExitCodes ?? [0];

    return new Promise<GitResult>((resolve, reject) => {
      const child = spawn(this.gitPath, fullArgs, {
        cwd: options.cwd,
        env: { ...process.env, ...HARDENED_ENV, ...this.env, ...options.extraEnv },
        // Without input, stdin is not opened at all: writing to a pipe git
        // has already closed raises SIGPIPE in the extension host.
        stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;

      const onAbort = (): void => {
        if (!settled) {
          settled = true;
          child.kill();
          reject(new GitCancelledError());
        }
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      const finish = (fn: () => void): void => {
        signal?.removeEventListener('abort', onAbort);
        if (!settled) {
          settled = true;
          fn();
        }
      };

      child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));

      child.on('error', (error: NodeJS.ErrnoException) => {
        finish(() => {
          let message = `Failed to run git: ${error.message}`;
          if (error.code === 'ENOENT') {
            // spawn reports a missing working directory as ENOENT too.
            message = existsSync(options.cwd)
              ? `Git was not found at "${this.gitPath}". Install git or set "git.path".`
              : `The folder "${options.cwd}" does not exist.`;
          }
          reject(new GitError(message, args, undefined, ''));
        });
      });

      child.on('close', (code) => {
        finish(() => {
          const stderrText = Buffer.concat(stderr).toString('utf8');
          const exitCode = code ?? -1;
          if (okExitCodes.includes(exitCode)) {
            resolve({ stdout: Buffer.concat(stdout), stderr: stderrText, exitCode });
          } else {
            const detail = stderrText.trim() || `exit code ${exitCode}`;
            reject(new GitError(`git ${args[0] ?? ''} failed: ${detail}`, args, exitCode, stderrText));
          }
        });
      });

      if (child.stdin) {
        // git may exit before reading all of stdin (EPIPE); the exit code
        // reports the real outcome, so stdin errors are ignored.
        child.stdin.on('error', () => undefined);
        child.stdin.end(options.stdin);
      }
    });
  }

  /** Runs git and returns stdout decoded as UTF-8. */
  async text(args: readonly string[], options: GitExecOptions): Promise<string> {
    const result = await this.exec(args, options);
    return result.stdout.toString('utf8');
  }
}
