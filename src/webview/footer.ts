import { CompareFooterState, FooterAction } from '../shared/protocol';
import { h, icon } from './dom';

/**
 * The bar under the commit list: "Base [x ▾] ⇄ Target [y ▾]", a PR-style
 * toggle and the Compare button. Pickers open as QuickPicks in the host.
 */
export class Footer {
  readonly element: HTMLElement;
  private readonly baseLabel: HTMLElement;
  private readonly targetLabel: HTMLElement;
  private readonly swap: HTMLButtonElement;
  private readonly mergeBase: HTMLInputElement;
  private readonly controls: (HTMLButtonElement | HTMLInputElement)[];

  constructor(run: (action: FooterAction) => void) {
    this.element = h('div', 'footer');

    this.baseLabel = h('span', 'label');
    const base = this.picker('Base', this.baseLabel, 'Base (left side): click to change', () => run('pickBase'));

    this.swap = h('button', 'icon-button swap');
    this.swap.title = 'Swap base and target';
    this.swap.setAttribute('aria-label', 'Swap base and target');
    this.swap.append(icon('arrow-swap'));
    this.swap.addEventListener('click', () => run('swap'));

    this.targetLabel = h('span', 'label');
    const target = this.picker('Target', this.targetLabel, 'Target (right side): click to change', () => run('pickTarget'));

    const sides = h('div', 'sides');
    sides.append(base, this.swap, target);

    this.mergeBase = h('input');
    this.mergeBase.type = 'checkbox';
    this.mergeBase.addEventListener('change', () => run('toggleMode'));
    const mode = h('label', 'toggle');
    mode.title = 'PR-style: show only what the target changed since it diverged from the base (compare from their merge base)';
    mode.append(this.mergeBase, h('span', undefined, 'PR-style'));

    const compare = h('button', 'primary', 'Compare');
    compare.title = 'Show the changes between base and target';
    compare.addEventListener('click', () => run('compare'));

    const actions = h('div', 'actions');
    actions.append(mode, compare);

    this.element.append(sides, actions);
    this.controls = [base, this.swap, target, this.mergeBase, compare];
  }

  update(state: CompareFooterState): void {
    this.baseLabel.textContent = state.baseLabel;
    this.targetLabel.textContent = state.targetLabel;
    this.mergeBase.checked = state.mergeBase;
    for (const control of this.controls) {
      control.disabled = !state.enabled;
    }
    this.swap.disabled = !state.enabled || !state.canSwap;
    this.swap.title = state.canSwap ? 'Swap base and target' : 'The Working Tree can only be the target';
  }

  private picker(side: string, label: HTMLElement, title: string, onClick: () => void): HTMLButtonElement {
    const button = h('button', `picker side-${side.toLowerCase()}`);
    button.title = title;
    button.append(h('span', 'side', side), label, icon('chevron-down', 'chevron'));
    button.addEventListener('click', onClick);
    return button;
  }
}
