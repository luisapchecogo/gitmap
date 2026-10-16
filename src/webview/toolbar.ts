import { ToolbarCommand, ToolbarState } from '../shared/protocol';
import { h, icon } from './dom';

/**
 * The row of controls above the commit list. Pickers open as native,
 * filterable QuickPicks in the extension host (which copes with
 * repositories that have hundreds of branches); the toolbar only shows
 * the current choice and asks the host to run the command.
 */
export class Toolbar {
  readonly element: HTMLElement;
  private readonly repoLabel: HTMLElement;
  private readonly repoButton: HTMLButtonElement;
  private readonly branchLabel: HTMLElement;
  private readonly remotes: HTMLInputElement;
  private readonly remotesLabel: HTMLLabelElement;

  constructor(run: (command: ToolbarCommand) => void) {
    this.element = h('div', 'toolbar');

    this.repoLabel = h('span', 'label');
    this.repoButton = this.button('repo', this.repoLabel, 'Select repository', () => run('selectRepository'));

    this.branchLabel = h('span', 'label');
    const branchButton = this.button('git-branch', this.branchLabel, 'Show all branches or one branch', () => run('selectBranch'));

    this.remotes = h('input');
    this.remotes.type = 'checkbox';
    this.remotes.addEventListener('change', () => run('toggleRemoteBranches'));
    this.remotesLabel = h('label', 'toggle');
    this.remotesLabel.title = 'Show remote branches';
    this.remotesLabel.append(this.remotes, h('span', undefined, 'Remotes'));

    const refresh = h('button', 'icon-button');
    refresh.title = 'Refresh';
    refresh.setAttribute('aria-label', 'Refresh');
    refresh.append(icon('refresh'));
    refresh.addEventListener('click', () => run('refresh'));

    this.element.append(this.repoButton, branchButton, this.remotesLabel, refresh);
  }

  update(state: ToolbarState): void {
    this.repoLabel.textContent = state.repositoryName ?? 'No repository';
    this.repoButton.title =
      state.repositoryCount > 1 ? `Repository: ${state.repositoryName ?? ''} (click to switch)` : `Repository: ${state.repositoryName ?? 'none'}`;
    this.branchLabel.textContent = state.branchLabel;
    this.remotes.checked = state.showRemotes;
    this.remotes.disabled = state.branchFiltered;
    this.remotesLabel.classList.toggle('disabled', state.branchFiltered);
  }

  private button(iconName: string, label: HTMLElement, title: string, onClick: () => void): HTMLButtonElement {
    const button = h('button', 'picker');
    button.title = title;
    button.append(icon(iconName), label, icon('chevron-down', 'chevron'));
    button.addEventListener('click', onClick);
    return button;
  }
}
