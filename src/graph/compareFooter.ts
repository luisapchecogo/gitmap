import * as vscode from 'vscode';
import { CompareDeps, runComparison } from '../compare/compareCommands';
import { CompareSelection } from '../compare/compareState';
import { Revision, revisionLabel } from '../core/revision';
import { GitRepository } from '../git/repository';
import { CompareFooterState, FooterAction } from '../shared/protocol';
import { pickRevision } from '../state/pickers';
import { GraphController } from './graphController';

/**
 * The "Base ⇄ Target [Compare]" bar under the commit list: reports the
 * selection of the repository shown in the graph and carries out the
 * footer's actions.
 */
export class CompareFooter implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  /** Fires when the footer should be re-rendered. */
  readonly onDidChange = this.emitter.event;
  private readonly disposables: vscode.Disposable[] = [this.emitter];

  constructor(
    private readonly deps: CompareDeps,
    private readonly graph: GraphController,
  ) {
    this.disposables.push(
      deps.state.onDidChange(() => this.emitter.fire()),
      deps.session.onDidChangeActiveRepository(() => this.emitter.fire()),
    );
  }

  /** Repository the footer acts on: the one shown in the graph. */
  get repository(): GitRepository | undefined {
    return this.graph.currentRepository ?? this.deps.session.activeRepository;
  }

  async state(): Promise<CompareFooterState> {
    const repository = this.repository;
    if (!repository) {
      return { enabled: false, baseLabel: '—', targetLabel: '—', mergeBase: false, canSwap: false };
    }
    const selection = this.deps.state.selectionFor(repository);
    const resolve = async (revision: Revision): Promise<string | undefined> =>
      revision.kind === 'commit' ? repository.resolveCommit(revision.ref).catch(() => undefined) : undefined;
    const [baseHash, targetHash] = await Promise.all([resolve(selection.base), resolve(selection.target)]);
    return {
      enabled: true,
      baseLabel: revisionLabel(selection.base),
      targetLabel: revisionLabel(selection.target),
      baseHash,
      targetHash,
      mergeBase: selection.mode === 'mergeBase',
      canSwap: selection.target.kind !== 'workingTree' && selection.base.kind !== 'emptyTree',
    };
  }

  async run(action: FooterAction): Promise<void> {
    const repository = this.repository;
    if (!repository) {
      return;
    }
    const selection = this.deps.state.selectionFor(repository);
    const update = (patch: Partial<CompareSelection>): Promise<void> => this.deps.state.update(repository, patch);
    switch (action) {
      case 'pickBase': {
        const base = await pickRevision(repository, { title: 'Base (left side)', placeHolder: 'Pick the base to compare from' });
        if (base) {
          await update({ base });
        }
        break;
      }
      case 'pickTarget': {
        const target = await pickRevision(repository, {
          title: 'Target (right side)',
          placeHolder: 'Pick the target to compare to',
          allowWorkingTree: true,
        });
        if (target) {
          await update({ target });
        }
        break;
      }
      case 'swap':
        if (selection.target.kind === 'workingTree' || selection.base.kind === 'emptyTree') {
          void vscode.window.showInformationMessage('GitMap: the Working Tree can only be the target. Pick another target to swap the sides.');
        } else {
          await update({ base: selection.target, target: selection.base });
        }
        break;
      case 'toggleMode':
        await update({ mode: selection.mode === 'mergeBase' ? 'direct' : 'mergeBase' });
        break;
      case 'compare':
        await runComparison(this.deps, repository, selection);
        break;
    }
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
