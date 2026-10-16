import * as vscode from 'vscode';
import { GitRef } from '../core/refsParser';
import { commitRevision, Revision, shortHash, WORKING_TREE } from '../core/revision';
import { GitRepository } from '../git/repository';
import { Session } from './session';

interface RevisionItem extends vscode.QuickPickItem {
  revision?: Revision;
  /** Free text the user typed, resolved when picked. */
  typed?: string;
}

/**
 * Asks which repository to use. Returns the only one without asking, and
 * `undefined` if there are none or the user cancels.
 */
export async function pickRepository(session: Session, placeHolder = 'Select a repository'): Promise<GitRepository | undefined> {
  await session.ready();
  const repositories = session.repositories;
  if (repositories.length <= 1) {
    if (repositories.length === 0) {
      void vscode.window.showInformationMessage('GitMap: no git repository was found in this workspace.');
    }
    return repositories[0];
  }
  const active = session.activeRepository;
  const picked = await vscode.window.showQuickPick(
    repositories.map((repository) => ({
      label: `$(repo) ${repository.name}`,
      description: repository === active ? `${repository.root} · current` : repository.root,
      repository,
    })),
    { placeHolder, matchOnDescription: true },
  );
  return picked?.repository;
}

export interface PickRevisionOptions {
  title: string;
  placeHolder?: string;
  /** Offer "Working Tree" (only valid as a comparison target). */
  allowWorkingTree?: boolean;
}

function refItem(ref: GitRef): RevisionItem {
  const icon = ref.kind === 'tag' ? '$(tag)' : ref.kind === 'remote' ? '$(cloud)' : '$(git-branch)';
  return {
    label: `${icon} ${ref.name}`,
    description: shortHash(ref.commit) + (ref.isHead ? ' · current branch' : ''),
    revision: commitRevision(ref.fullName, ref.name),
  };
}

/**
 * A filterable QuickPick of revisions: Working Tree (optionally), HEAD,
 * branches, remote branches and tags. Typing anything git understands
 * (a hash, `HEAD~3`, `v1.0^`) offers it as a revision too.
 */
export function pickRevision(repository: GitRepository, options: PickRevisionOptions): Promise<Revision | undefined> {
  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick<RevisionItem>();
    quickPick.title = options.title;
    quickPick.placeholder = options.placeHolder ?? 'Pick a branch or tag, or type a commit hash or revision';
    quickPick.matchOnDescription = true;
    quickPick.busy = true;

    let fixed: RevisionItem[] = [];
    /** Typed values git could not resolve; shown as errors instead of options. */
    const invalid = new Set<string>();
    const disposables: vscode.Disposable[] = [quickPick];
    let settled = false;
    const finish = (revision: Revision | undefined): void => {
      if (!settled) {
        settled = true;
        resolve(revision);
        vscode.Disposable.from(...disposables).dispose();
      }
    };

    const render = (): void => {
      const value = quickPick.value.trim();
      const exact = fixed.some((item) => item.revision?.kind === 'commit' && item.revision.label === value);
      const typedItem: RevisionItem[] = [];
      if (value && !exact) {
        typedItem.push(
          invalid.has(value)
            ? { label: `$(error) ${value}`, description: `Not a commit in ${repository.name}`, alwaysShow: true }
            : { label: `$(search) ${value}`, description: 'Use this revision', typed: value, alwaysShow: true },
        );
      }
      quickPick.items = [...typedItem, ...fixed];
    };

    void Promise.all([repository.getRefs(), repository.getHead()])
      .then(([refs, head]) => {
        const items: RevisionItem[] = [];
        if (options.allowWorkingTree) {
          items.push({ label: '$(edit) Working Tree', description: 'Files on disk, including uncommitted changes', revision: WORKING_TREE });
        }
        if (head.commit) {
          items.push({
            label: '$(target) HEAD',
            description: `${head.branch ?? 'detached'} · ${shortHash(head.commit)}`,
            revision: commitRevision('HEAD'),
          });
        }
        const groups: [string, GitRef['kind']][] = [
          ['Branches', 'head'],
          ['Remote Branches', 'remote'],
          ['Tags', 'tag'],
        ];
        for (const [label, kind] of groups) {
          const matching = refs.filter((ref) => ref.kind === kind);
          if (matching.length > 0) {
            items.push({ label, kind: vscode.QuickPickItemKind.Separator }, ...matching.map(refItem));
          }
        }
        fixed = items;
      })
      .catch((error: unknown) => {
        quickPick.placeholder = `Could not list branches: ${error instanceof Error ? error.message : String(error)}`;
      })
      .finally(() => {
        quickPick.busy = false;
        render();
      });

    disposables.push(
      quickPick.onDidChangeValue(render),
      quickPick.onDidAccept(() => {
        const [item] = quickPick.selectedItems;
        if (!item) {
          return;
        }
        if (item.revision) {
          finish(item.revision);
          return;
        }
        if (item.typed) {
          const typed = item.typed;
          quickPick.busy = true;
          void repository.resolveCommit(typed).then((hash) => {
            quickPick.busy = false;
            if (hash) {
              finish(commitRevision(hash, /^[0-9a-f]{7,}$/i.test(typed) ? shortHash(hash) : typed));
            } else {
              invalid.add(typed);
              render();
            }
          });
        }
      }),
      quickPick.onDidHide(() => finish(undefined)),
    );
    quickPick.show();
  });
}
