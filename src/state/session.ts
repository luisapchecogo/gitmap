import * as path from 'path';
import * as vscode from 'vscode';
import { GitRunner } from '../core/gitRunner';
import type { GitExtension } from '../git/git';
import { getGitApi, getGitExtension } from '../git/gitExtension';
import { RepoDiscovery } from '../git/repoDiscovery';
import { GitRepository } from '../git/repository';

const ACTIVE_REPOSITORY_KEY = 'gitmap.activeRepository';

/**
 * Process-wide state shared by every GitMap view: the git runner, the
 * repositories in the workspace and the one the views currently show.
 */
export class Session implements vscode.Disposable {
  private readonly repositoriesEmitter = new vscode.EventEmitter<void>();
  /** Fires when repositories are added or removed. */
  readonly onDidChangeRepositories = this.repositoriesEmitter.event;

  private readonly activeEmitter = new vscode.EventEmitter<GitRepository | undefined>();
  /** Fires when the repository shown in the views changes. */
  readonly onDidChangeActiveRepository = this.activeEmitter.event;

  private readonly disposables: vscode.Disposable[] = [this.repositoriesEmitter, this.activeEmitter];
  private gitRunner = new GitRunner();
  private discovery: RepoDiscovery | undefined;
  private repos = new Map<string, GitRepository>();
  private active: GitRepository | undefined;
  private readonly initialized: Promise<void>;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.initialized = this.initialize();
  }

  /**
   * The runner for git calls. It is usable immediately (with `git` from the
   * PATH) and switches to the Git extension's configured executable once
   * that is known.
   */
  get runner(): GitRunner {
    return this.gitRunner;
  }

  get repositories(): readonly GitRepository[] {
    return [...this.repos.values()];
  }

  get activeRepository(): GitRepository | undefined {
    return this.active;
  }

  /** Resolves once the first repository scan has finished. */
  async ready(): Promise<void> {
    await this.initialized;
    await this.discovery?.ready();
  }

  /** The Git extension's API, if available (used for change events). */
  get gitApi() {
    return this.discovery?.gitApi;
  }

  getRepository(root: string): GitRepository | undefined {
    return this.repos.get(root);
  }

  setActiveRepository(repository: GitRepository | undefined): void {
    if (repository === this.active) {
      return;
    }
    this.active = repository;
    void this.context.workspaceState.update(ACTIVE_REPOSITORY_KEY, repository?.root);
    void vscode.commands.executeCommand('setContext', 'gitmap.hasRepository', !!repository);
    this.activeEmitter.fire(repository);
  }

  private async initialize(): Promise<void> {
    const extension: GitExtension | undefined = await getGitExtension();
    const gitPath = getGitApi(extension)?.git.path;
    if (gitPath) {
      this.gitRunner = new GitRunner({ gitPath });
    }
    this.discovery = new RepoDiscovery(() => this.gitRunner, extension);
    this.disposables.push(this.discovery, this.discovery.onDidChange(() => this.syncRepositories()));
    await this.discovery.ready();
    this.syncRepositories();
  }

  private syncRepositories(): void {
    const roots = this.discovery?.repositories ?? [];
    const next = new Map<string, GitRepository>();
    for (const root of roots) {
      next.set(root, this.repos.get(root) ?? new GitRepository(root, this.gitRunner));
    }
    const changed = roots.length !== this.repos.size || roots.some((root) => !this.repos.has(root));
    this.repos = next;
    if (changed) {
      this.repositoriesEmitter.fire();
    }

    if (this.active && next.has(this.active.root)) {
      return;
    }
    const remembered = this.context.workspaceState.get<string>(ACTIVE_REPOSITORY_KEY);
    this.setActiveRepository(
      (remembered && next.get(remembered)) || this.repositoryForActiveEditor() || next.values().next().value,
    );
  }

  private repositoryForActiveEditor(): GitRepository | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (uri?.scheme !== 'file') {
      return undefined;
    }
    const file = uri.fsPath;
    // Deepest root wins, so a nested repository beats its parent.
    return this.repositories
      .filter((repo) => file === repo.root || file.startsWith(repo.root + path.sep))
      .sort((a, b) => b.root.length - a.root.length)[0];
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
