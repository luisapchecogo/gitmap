import * as vscode from 'vscode';
import { FileChange } from '../core/diffParser';
import { commitRevision, Revision, WORKING_TREE } from '../core/revision';
import { GitRepository } from '../git/repository';
import { Session } from '../state/session';
import { CompareMode, WorkspaceStore } from '../state/workspaceStore';

export type { CompareMode };

/** The two sides of a comparison and how to diff them. */
export interface CompareSelection {
  base: Revision;
  target: Revision;
  mode: CompareMode;
}

/** A finished comparison, as shown in the Changes view. */
export interface CompareResult {
  repository: GitRepository;
  selection: CompareSelection;
  /** Resolved left tree-ish (a commit, merge base or the empty tree). */
  left: string;
  /** Resolved right commit; `undefined` for the working tree. */
  right: string | undefined;
  mergeBase?: string;
  changes: FileChange[];
  leftLabel: string;
  rightLabel: string;
}

/** Base = HEAD, Target = Working Tree: comparing right away shows uncommitted work. */
export const DEFAULT_SELECTION: CompareSelection = {
  base: commitRevision('HEAD'),
  target: WORKING_TREE,
  mode: 'direct',
};

/**
 * The base/target/mode the user has picked for the active repository.
 * Each repository remembers its own selection.
 */
export class CompareState implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<CompareSelection>();
  readonly onDidChange = this.emitter.event;
  private readonly disposables: vscode.Disposable[] = [this.emitter];

  constructor(
    private readonly session: Session,
    private readonly store: WorkspaceStore,
  ) {
    this.disposables.push(session.onDidChangeActiveRepository(() => this.emitter.fire(this.selection)));
  }

  get selection(): CompareSelection {
    const repository = this.session.activeRepository;
    return repository ? this.selectionFor(repository) : DEFAULT_SELECTION;
  }

  selectionFor(repository: GitRepository): CompareSelection {
    const saved = this.store.get(repository.root);
    return {
      base: saved.base ?? DEFAULT_SELECTION.base,
      target: saved.target ?? DEFAULT_SELECTION.target,
      mode: saved.mode ?? DEFAULT_SELECTION.mode,
    };
  }

  async update(repository: GitRepository, patch: Partial<CompareSelection>): Promise<void> {
    await this.store.update(repository.root, patch);
    if (repository === this.session.activeRepository) {
      this.emitter.fire(this.selection);
    }
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
