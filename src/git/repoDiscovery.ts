import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { GitRunner } from '../core/gitRunner';
import type { API, GitExtension } from './git';
import { getGitApi } from './gitExtension';

/**
 * Returns the repository root that contains `folder`, or `undefined` when
 * the folder is not inside a git work tree.
 */
export async function findRepositoryRoot(runner: GitRunner, folder: string): Promise<string | undefined> {
  try {
    const result = await runner.exec(['rev-parse', '--show-toplevel'], {
      cwd: folder,
      okExitCodes: [0, 128],
    });
    const root = result.stdout.toString('utf8').trim();
    return result.exitCode === 0 && root ? path.normalize(root) : undefined;
  } catch {
    return undefined;
  }
}

/** Normalizes a path so the same repository reported twice compares equal. */
async function canonical(root: string): Promise<string> {
  try {
    return await fs.realpath(root);
  } catch {
    return path.normalize(root);
  }
}

/**
 * Finds the git repositories in the workspace.
 *
 * Two sources are merged: the built-in Git extension (when it is enabled,
 * it also finds nested repositories and submodules) and a fallback that
 * asks git for the top level of every workspace folder, so GitMap still
 * works with `git.enabled: false`.
 */
export class RepoDiscovery implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  private readonly disposables: vscode.Disposable[] = [this.changeEmitter];
  private apiDisposables: vscode.Disposable[] = [];
  private api: API | undefined;
  private roots: string[] = [];
  private scan: Promise<void> | undefined;
  private rescanRequested = false;

  constructor(
    private readonly runner: () => GitRunner,
    private readonly gitExtension: GitExtension | undefined,
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
    );
    if (gitExtension) {
      this.disposables.push(gitExtension.onDidChangeEnablement(() => this.attachApi()));
    }
    this.attachApi();
  }

  /** Repository roots, sorted for stable display. */
  get repositories(): readonly string[] {
    return this.roots;
  }

  /** The Git extension API, when it is available. */
  get gitApi(): API | undefined {
    return this.api;
  }

  /** Resolves once the current scan (if any) has finished. */
  async ready(): Promise<void> {
    while (this.scan) {
      await this.scan;
    }
  }

  /** Rescans; concurrent requests are coalesced into one follow-up scan. */
  refresh(): void {
    if (this.scan) {
      this.rescanRequested = true;
      return;
    }
    this.scan = this.runScan().finally(() => {
      this.scan = undefined;
      if (this.rescanRequested) {
        this.rescanRequested = false;
        this.refresh();
      }
    });
  }

  private attachApi(): void {
    vscode.Disposable.from(...this.apiDisposables).dispose();
    this.apiDisposables = [];
    this.api = getGitApi(this.gitExtension);
    if (this.api) {
      this.apiDisposables.push(
        this.api.onDidOpenRepository(() => this.refresh()),
        this.api.onDidCloseRepository(() => this.refresh()),
        this.api.onDidChangeState(() => this.refresh()),
      );
    }
    this.refresh();
  }

  private async runScan(): Promise<void> {
    const found = new Set<string>();
    const add = async (root: string | undefined): Promise<void> => {
      if (root) {
        found.add(await canonical(root));
      }
    };

    for (const repository of this.api?.repositories ?? []) {
      await add(repository.rootUri.fsPath);
    }
    const folders = (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === 'file');
    const runner = this.runner();
    const fallback = await Promise.all(folders.map((folder) => findRepositoryRoot(runner, folder.uri.fsPath)));
    for (const root of fallback) {
      await add(root);
    }

    const roots = [...found].sort((a, b) => a.localeCompare(b));
    if (roots.join('\0') !== this.roots.join('\0')) {
      this.roots = roots;
      this.changeEmitter.fire();
    }
  }

  dispose(): void {
    vscode.Disposable.from(...this.apiDisposables, ...this.disposables).dispose();
  }
}
