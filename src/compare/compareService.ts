import * as vscode from 'vscode';
import { isCancellation } from '../core/gitRunner';
import { revisionLabel, shortHash } from '../core/revision';
import { GitRepository } from '../git/repository';
import { CompareResult, CompareSelection } from './compareState';

/**
 * Runs comparisons and holds the one the Changes view shows. Starting a new
 * comparison cancels the one in flight.
 */
export class CompareService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  /** Fires when the result, loading state or error changes. */
  readonly onDidChange = this.emitter.event;

  private result: CompareResult | undefined;
  private failure: string | undefined;
  private inFlight: AbortController | undefined;

  get current(): CompareResult | undefined {
    return this.result;
  }

  get error(): string | undefined {
    return this.failure;
  }

  get loading(): boolean {
    return this.inFlight !== undefined;
  }

  /**
   * Compares `selection` in `repository`. Resolves to the result, or
   * `undefined` if it failed (see {@link error}) or was superseded.
   */
  async compare(repository: GitRepository, selection: CompareSelection): Promise<CompareResult | undefined> {
    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;
    this.emitter.fire();

    try {
      const outcome = await vscode.window.withProgress(
        { location: { viewId: 'gitmap.compare' } },
        () =>
          repository.getChanges(
            { base: selection.base, target: selection.target, mergeBase: selection.mode === 'mergeBase' },
            { signal: controller.signal },
          ),
      );
      if (this.inFlight !== controller) {
        return undefined;
      }
      this.result = {
        repository,
        selection,
        left: outcome.left,
        right: outcome.right,
        mergeBase: outcome.mergeBase,
        changes: outcome.changes,
        leftLabel: outcome.mergeBase
          ? `merge-base(${revisionLabel(selection.base)}) ${shortHash(outcome.mergeBase)}`
          : revisionLabel(selection.base),
        rightLabel: revisionLabel(selection.target),
      };
      this.failure = undefined;
      return this.result;
    } catch (error) {
      if (isCancellation(error) || this.inFlight !== controller) {
        return undefined;
      }
      this.result = undefined;
      this.failure = error instanceof Error ? error.message : String(error);
      return undefined;
    } finally {
      if (this.inFlight === controller) {
        this.inFlight = undefined;
        this.emitter.fire();
      }
    }
  }

  clear(): void {
    this.inFlight?.abort();
    this.inFlight = undefined;
    this.result = undefined;
    this.failure = undefined;
    this.emitter.fire();
  }

  dispose(): void {
    this.inFlight?.abort();
    this.emitter.dispose();
  }
}
