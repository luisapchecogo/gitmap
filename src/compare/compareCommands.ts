import * as vscode from 'vscode';
import { ChangeTreeNode } from '../core/changeTree';
import { revisionLabel } from '../core/revision';
import { GitRepository } from '../git/repository';
import { pickRepository, pickRevision } from '../state/pickers';
import { Session } from '../state/session';
import { ChangesTreeProvider } from './changesTreeProvider';
import { CompareSelection, CompareState } from './compareState';
import { CompareService } from './compareService';
import { changeUris, openChange, openTargetFile } from './openDiff';

export interface CompareDeps {
  session: Session;
  state: CompareState;
  service: CompareService;
  changesTree: ChangesTreeProvider;
}

/**
 * Remembers the selection for the repository and shows the comparison in
 * the Changes view.
 */
export async function runComparison(deps: CompareDeps, repository: GitRepository, selection: CompareSelection): Promise<void> {
  await deps.state.update(repository, selection);
  await vscode.commands.executeCommand('gitmap.compare.focus');
  await deps.service.compare(repository, selection);
  if (deps.service.error) {
    void vscode.window.showErrorMessage(`GitMap: ${deps.service.error}`);
  }
}

/**
 * The comparison the Changes view's title actions act on: the one shown,
 * or else the selection for the active repository.
 */
function currentComparison(deps: CompareDeps): { repository: GitRepository; selection: CompareSelection } | undefined {
  const shown = deps.service.current;
  if (shown) {
    return { repository: shown.repository, selection: shown.selection };
  }
  const repository = deps.session.activeRepository;
  return repository ? { repository, selection: deps.state.selectionFor(repository) } : undefined;
}

export function registerCompareCommands(deps: CompareDeps): vscode.Disposable[] {
  const { session, state, service } = deps;

  /** Applies a change to the current comparison and re-runs it if one is shown. */
  const adjust = async (patch: (selection: CompareSelection) => CompareSelection | undefined): Promise<void> => {
    const comparison = currentComparison(deps);
    if (!comparison) {
      return;
    }
    const next = patch(comparison.selection);
    if (!next) {
      return;
    }
    if (service.current || service.error) {
      await runComparison(deps, comparison.repository, next);
    } else {
      await state.update(comparison.repository, next);
    }
  };

  const fileNode = (node: unknown): (ChangeTreeNode & { kind: 'file' }) | undefined => {
    const candidate = node as ChangeTreeNode | undefined;
    return candidate?.kind === 'file' ? candidate : undefined;
  };

  return [
    vscode.commands.registerCommand('gitmap.compareRevisions', async () => {
      const repository = await pickRepository(session, 'Select the repository to compare in');
      if (!repository) {
        return;
      }
      const current = state.selectionFor(repository);
      const base = await pickRevision(repository, {
        title: `Compare (1/2): Base — currently ${revisionLabel(current.base)}`,
        placeHolder: 'Pick the base (left side)',
      });
      if (!base) {
        return;
      }
      const target = await pickRevision(repository, {
        title: `Compare (2/2): ${revisionLabel(base)} ↔ Target`,
        placeHolder: 'Pick the target (right side)',
        allowWorkingTree: true,
      });
      if (!target) {
        return;
      }
      session.setActiveRepository(repository);
      await runComparison(deps, repository, { ...current, base, target });
    }),

    vscode.commands.registerCommand('gitmap.swapCompare', () =>
      adjust((selection) => {
        if (selection.target.kind === 'workingTree') {
          void vscode.window.showInformationMessage(
            'GitMap: the Working Tree can only be the target. Pick another target to swap the sides.',
          );
          return undefined;
        }
        return { ...selection, base: selection.target, target: selection.base };
      }),
    ),

    vscode.commands.registerCommand('gitmap.toggleCompareMode', () =>
      adjust((selection) => ({ ...selection, mode: selection.mode === 'mergeBase' ? 'direct' : 'mergeBase' })),
    ),

    vscode.commands.registerCommand('gitmap.clearCompare', () => service.clear()),

    vscode.commands.registerCommand('gitmap.showMoreFiles', () => deps.changesTree.showMore()),

    vscode.commands.registerCommand('gitmap.openAllChanges', async () => {
      const result = service.current;
      if (!result || result.changes.length === 0) {
        return;
      }
      const resources = result.changes.map((change) => {
        const uris = changeUris(result, change);
        return [uris.resource, uris.left, uris.right];
      });
      await vscode.commands.executeCommand('vscode.changes', `${result.leftLabel} ↔ ${result.rightLabel}`, resources);
    }),

    vscode.commands.registerCommand('gitmap.openChange', async (node: unknown) => {
      const file = fileNode(node);
      if (file && service.current) {
        await openChange(service.current, file.change);
      }
    }),

    vscode.commands.registerCommand('gitmap.openFile', async (node: unknown) => {
      const file = fileNode(node);
      if (file && service.current) {
        await openTargetFile(service.current, file.change);
      }
    }),

    vscode.commands.registerCommand('gitmap.copyPath', async (node: unknown) => {
      const candidate = node as ChangeTreeNode | undefined;
      if (candidate && candidate.kind !== 'more') {
        await vscode.env.clipboard.writeText(candidate.path);
      }
    }),
  ];
}
