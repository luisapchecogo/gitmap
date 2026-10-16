import { h, icon } from './dom';

export interface SearchCallbacks {
  /** The query changed (debounced); an empty query clears the search. */
  search(query: string): void;
  /** Move to a match. */
  reveal(hash: string): void;
}

/**
 * The search box: "Search message, author, hash…" with a match counter and
 * previous/next buttons. Matches come from the host; moving between them
 * asks the host to make sure the commit is loaded before scrolling to it.
 */
export class SearchBox {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly counter: HTMLElement;
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private matches: string[] = [];
  private index = -1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = false;

  constructor(private readonly callbacks: SearchCallbacks) {
    this.element = h('div', 'search');
    const field = h('div', 'search-field');
    this.input = h('input');
    this.input.type = 'search';
    this.input.placeholder = 'Search message, author, hash…';
    this.input.setAttribute('aria-label', 'Search commits');
    this.input.spellcheck = false;
    this.counter = h('span', 'counter');
    this.counter.setAttribute('aria-live', 'polite');
    field.append(icon('search', 'search-icon'), this.input, this.counter);

    this.previous = this.navButton('arrow-up', 'Previous match (Shift+Enter)', () => this.move(-1));
    this.next = this.navButton('arrow-down', 'Next match (Enter)', () => this.move(1));
    this.element.append(field, this.previous, this.next);

    this.input.addEventListener('input', () => this.schedule());
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (this.pending) {
          this.runNow();
        } else {
          this.move(event.shiftKey ? -1 : 1);
        }
      } else if (event.key === 'Escape') {
        this.input.value = '';
        this.runNow();
      }
    });
    this.render();
  }

  get query(): string {
    return this.input.value.trim();
  }

  /** Hashes of the current matches, for highlighting rows. */
  get matchSet(): ReadonlySet<string> {
    return new Set(this.matches);
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }

  /** Results from the host; stale results (for an older query) are ignored. */
  showResults(query: string, matches: string[], truncated: boolean, error?: string): void {
    if (query.trim() !== this.query) {
      return;
    }
    this.pending = false;
    this.matches = matches;
    this.index = -1;
    this.render(error ?? (truncated ? `first ${matches.length}` : undefined));
    if (matches.length > 0) {
      this.move(1);
    }
  }

  /** The host could not reveal a match (e.g. too far down). */
  showMessage(message: string): void {
    this.counter.title = message;
    this.counter.classList.add('warning');
  }

  private schedule(): void {
    this.pending = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.runNow(), 300);
  }

  private runNow(): void {
    clearTimeout(this.timer);
    this.pending = !!this.query;
    if (!this.query) {
      this.matches = [];
      this.index = -1;
      this.render();
    }
    this.callbacks.search(this.query);
  }

  private move(step: number): void {
    if (this.matches.length === 0) {
      return;
    }
    this.index = (this.index + step + this.matches.length) % this.matches.length;
    this.render();
    this.callbacks.reveal(this.matches[this.index]);
  }

  private render(note?: string): void {
    const has = this.matches.length > 0;
    this.previous.disabled = !has;
    this.next.disabled = !has;
    this.counter.classList.remove('warning');
    this.counter.title = '';
    if (!this.query) {
      this.counter.textContent = '';
    } else if (!has) {
      this.counter.textContent = this.pending ? '' : 'No results';
      if (note) {
        this.counter.title = note;
      }
    } else {
      this.counter.textContent = `${this.index + 1}/${this.matches.length}${note ? '+' : ''}`;
      this.counter.title = note ? `Showing the ${note} matches` : '';
    }
  }

  private navButton(iconName: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = h('button', 'icon-button nav');
    button.title = title;
    button.setAttribute('aria-label', title);
    button.append(icon(iconName));
    button.addEventListener('click', onClick);
    return button;
  }
}
