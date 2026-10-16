import * as vscode from 'vscode';
import type { Repository } from '../git/git';
import { Session } from '../state/session';
import { GraphController } from './graphController';

/** Waits for a burst of git activity (rebase, fetch) to settle. */
const DEBOUNCE_MS = 750;

/**
 * Keeps the graph current without polling: the built-in Git extension's
 * change events (when available) and the window regaining focus are
 * hints, and the graph reloads only if the refs/HEAD fingerprint actually
 * changed. While the view is hidden, hints just mark it stale, and the
 * check runs when it becomes visible again.
 */
export class GraphAutoRefresh implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private repositoryListener: vscode.Disposable | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stale = false;

  constructor(
    private readonly session: Session,
    private readonly graph: GraphController,
    private readonly isVisible: () => boolean,
    onDidBecomeVisible: vscode.Event<void>,
  ) {
    this.disposables.push(
      onDidBecomeVisible(() => {
        if (this.stale) {
          this.schedule();
        }
      }),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.hint();
        }
      }),
      session.onDidChangeActiveRepository(() => this.listen()),
      session.onDidChangeRepositories(() => this.listen()),
    );
    this.listen();
  }

  /** Something may have changed in the repository. */
  hint(): void {
    this.stale = true;
    if (this.isVisible()) {
      this.schedule();
    }
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.stale = false;
      void this.graph.reloadIfChanged();
    }, DEBOUNCE_MS);
  }

  /** Subscribes to the Git extension's change events for the shown repository. */
  private listen(): void {
    this.repositoryListener?.dispose();
    this.repositoryListener = undefined;
    const api = this.session.gitApi;
    const root = this.session.activeRepository?.root;
    if (!api || !root) {
      return;
    }
    let repository: Repository | null;
    try {
      repository = api.getRepository(vscode.Uri.file(root));
    } catch {
      repository = null;
    }
    if (repository) {
      this.repositoryListener = repository.state.onDidChange(() => this.hint());
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.repositoryListener?.dispose();
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
