import * as vscode from 'vscode';
import { ChangeTreeNode } from '../core/changeTree';
import { revisionLabel } from '../core/revision';
import { GitRepository } from '../git/repository';
import { pickRepository, pickRevision } from '../state/pickers';
import { Session } from '../state/session';
import { CompareSelection, CompareState } from './compareState';
import { CompareService } from './compareService';
import { openChange, openTargetFile } from './openDiff';

export interface CompareDeps {
  session: Session;
  state: CompareState;
  service: CompareService;
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

export function registerCompareCommands(deps: CompareDeps): vscode.Disposable[] {
  const { session, state, service } = deps;

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
