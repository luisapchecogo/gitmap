import { relativeDate } from '../shared/format';
import { CommitRow } from '../shared/protocol';
import { RefLabel, refLines } from '../shared/refLabels';
import { h, icon } from './dom';
import { GRAPH_METRICS, colorClass, renderGraphRow } from './graphSvg';

/** Labels shown per line before the rest collapse into a "+N" chip. */
const MAX_LABELS = 2;

const LABEL_ICONS: Record<RefLabel['kind'], string> = { branch: 'git-branch', remote: 'cloud', tag: 'tag' };

/** A line's ref labels, in the commit's lane color. */
function renderLabels(labels: readonly RefLabel[], color: number): HTMLElement {
  const container = h('span', `refs ${colorClass(color)}`);
  for (const label of labels.slice(0, MAX_LABELS)) {
    const pill = h('span', `ref ${label.kind}${label.current ? ' current' : ''}`);
    pill.title = label.current ? `${label.title} (checked out)` : label.title;
    pill.append(icon(label.current ? 'check' : LABEL_ICONS[label.kind]));
    if (label.prefix) {
      pill.append(h('span', 'prefix', label.prefix));
    }
    pill.append(h('span', 'name', label.text));
    container.append(pill);
  }
  const hidden = labels.slice(MAX_LABELS);
  if (hidden.length > 0) {
    const more = h('span', 'ref more', `+${hidden.length}`);
    more.title = hidden.map((label) => label.title).join('\n');
    container.append(more);
  }
  return container;
}

/** Builds the multi-line native tooltip for a commit row. */
function tooltip(row: CommitRow): string {
  const lines = [row.subject];
  if (row.body) {
    const body = row.body.split('\n');
    lines.push('', ...body.slice(0, 20), ...(body.length > 20 ? ['…'] : []));
  }
  lines.push(
    '',
    `Author: ${row.authorName} <${row.authorEmail}>`,
    `Date: ${new Date(row.authorDate * 1000).toLocaleString()}`,
    `Commit: ${row.hash}`,
  );
  if (row.parents.length > 0) {
    lines.push(`${row.parents.length > 1 ? 'Parents' : 'Parent'}: ${row.parents.map((p) => p.slice(0, 7)).join(', ')}`);
  }
  if (row.refs.length > 0) {
    lines.push(`Refs: ${row.refs.map((ref) => ref.name).join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * The scrolling list of two-line commit rows. Rows have a fixed height and
 * are appended page by page: a sentinel element after the last row asks
 * for the next page when it scrolls into view.
 */
export class CommitList {
  readonly element: HTMLElement;
  private readonly rowsElement: HTMLElement;
  private readonly sentinel: HTMLElement;
  private readonly observer: IntersectionObserver;
  private hasMore = false;
  private requested = false;
  /** Widest graph so far, in lanes: every row reserves this much room. */
  private graphLanes = 1;
  private selected: string | undefined;
  private markers: { base?: string; target?: string } = {};
  private matches: ReadonlySet<string> = new Set();

  constructor(
    private readonly onLoadMore: () => void,
    private readonly onOpen: (hash: string) => void,
  ) {
    this.element = h('div', 'list');
    this.element.tabIndex = 0;
    this.element.setAttribute('aria-label', 'Commits');
    this.element.addEventListener('click', (event) => {
      const row = this.rowFrom(event.target);
      if (row) {
        this.select(row);
      }
    });
    this.element.addEventListener('dblclick', (event) => {
      const row = this.rowFrom(event.target);
      if (row?.dataset.hash) {
        this.onOpen(row.dataset.hash);
      }
    });
    this.element.addEventListener('contextmenu', (event) => {
      // Right-click selects the row the context menu is for.
      const row = this.rowFrom(event.target);
      if (row) {
        this.select(row);
      }
    });
    this.element.addEventListener('keydown', (event) => this.onKey(event));
    this.rowsElement = h('div', 'rows');
    this.rowsElement.setAttribute('role', 'list');
    this.sentinel = h('div', 'sentinel');
    this.element.append(this.rowsElement, this.sentinel);
    this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), {
      root: this.element,
      // Start loading well before the user reaches the end.
      rootMargin: '0px 0px 600px 0px',
    });
    this.observer.observe(this.sentinel);
  }

  /** Marks the rows of the current base and target commits. */
  setMarkers(base: string | undefined, target: string | undefined): void {
    this.markers = { base, target };
    for (const row of this.rowsElement.children) {
      this.applyMarkers(row as HTMLElement);
    }
  }

  /** Highlights search matches. */
  setMatches(matches: ReadonlySet<string>): void {
    this.matches = matches;
    for (const row of this.rowsElement.children) {
      const element = row as HTMLElement;
      element.classList.toggle('match', matches.has(element.dataset.hash ?? ''));
    }
  }

  /** Selects and scrolls to a loaded commit. Returns false if it is not loaded. */
  reveal(hash: string): boolean {
    const row = this.rowsElement.querySelector<HTMLElement>(`.row[data-hash="${CSS.escape(hash)}"]`);
    if (!row) {
      return false;
    }
    this.select(row);
    row.scrollIntoView({ block: 'center' });
    return true;
  }

  reset(rows: readonly CommitRow[], hasMore: boolean): void {
    this.graphLanes = 1;
    this.updateGraphWidth(rows);
    this.rowsElement.replaceChildren(...rows.map((row) => this.renderRow(row)));
    this.element.scrollTop = 0;
    this.setHasMore(hasMore);
  }

  append(rows: readonly CommitRow[], hasMore: boolean): void {
    this.updateGraphWidth(rows);
    this.rowsElement.append(...rows.map((row) => this.renderRow(row)));
    this.setHasMore(hasMore);
  }

  /** Re-renders relative dates ("5 minutes ago") as time passes. */
  refreshDates(): void {
    const now = Date.now();
    for (const element of this.rowsElement.querySelectorAll<HTMLElement>('.date[data-time]')) {
      element.textContent = relativeDate(Number(element.dataset.time), now);
    }
  }

  /**
   * Keeps the text column aligned: the graph column is as wide as the
   * widest row loaded (capped by CSS so narrow side bars clip lanes rather
   * than squeezing the text away).
   */
  private updateGraphWidth(rows: readonly CommitRow[]): void {
    for (const row of rows) {
      this.graphLanes = Math.max(this.graphLanes, row.graph.width);
    }
    // CSSOM is allowed by the webview's CSP (inline style attributes are not).
    this.element.style.setProperty('--graph-width', `${this.graphLanes * GRAPH_METRICS.laneWidth + 4}px`);
  }

  private setHasMore(hasMore: boolean): void {
    this.hasMore = hasMore;
    this.requested = false;
    // Re-observing reports the sentinel's current visibility, so a page
    // that does not fill the view immediately asks for the next one.
    this.observer.unobserve(this.sentinel);
    this.observer.observe(this.sentinel);
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    if (entries.some((entry) => entry.isIntersecting) && this.hasMore && !this.requested) {
      this.requested = true;
      this.onLoadMore();
    }
  }

  private rowFrom(target: EventTarget | null): HTMLElement | undefined {
    const row = target instanceof Element ? target.closest<HTMLElement>('.row') : null;
    return row ?? undefined;
  }

  private select(row: HTMLElement): void {
    this.rowsElement.querySelector('.row.selected')?.classList.remove('selected');
    row.classList.add('selected');
    this.selected = row.dataset.hash;
  }

  private onKey(event: KeyboardEvent): void {
    const current = this.selected
      ? this.rowsElement.querySelector<HTMLElement>(`.row[data-hash="${CSS.escape(this.selected)}"]`)
      : null;
    let next: Element | null;
    switch (event.key) {
      case 'ArrowDown':
        next = current ? current.nextElementSibling : this.rowsElement.firstElementChild;
        break;
      case 'ArrowUp':
        next = current ? current.previousElementSibling : this.rowsElement.firstElementChild;
        break;
      case 'Enter':
        if (current?.dataset.hash) {
          this.onOpen(current.dataset.hash);
        }
        event.preventDefault();
        return;
      default:
        return;
    }
    event.preventDefault();
    if (next instanceof HTMLElement) {
      this.select(next);
      next.scrollIntoView({ block: 'nearest' });
    }
  }

  private applyMarkers(element: HTMLElement): void {
    const hash = element.dataset.hash;
    const isBase = !!hash && hash === this.markers.base;
    const isTarget = !!hash && hash === this.markers.target;
    element.classList.toggle('is-base', isBase);
    element.classList.toggle('is-target', isTarget);
    const markers = element.querySelector('.markers');
    if (markers) {
      markers.replaceChildren(
        ...(isBase ? [h('span', 'marker base', 'BASE')] : []),
        ...(isTarget ? [h('span', 'marker target', 'TARGET')] : []),
      );
    }
  }

  private renderRow(row: CommitRow): HTMLElement {
    const element = h('div', row.head ? 'row head' : 'row');
    element.setAttribute('role', 'listitem');
    element.dataset.hash = row.hash;
    element.title = tooltip(row);
    // Read by VS Code for the webview/context menu (see package.json); the
    // hash reaches the gitmap.graph.* commands as their argument.
    element.dataset.vscodeContext = JSON.stringify({
      webviewSection: 'commit',
      hash: row.hash,
      preventDefaultContextMenuItems: true,
    });
    if (row.hash === this.selected) {
      element.classList.add('selected');
    }
    if (this.matches.has(row.hash)) {
      element.classList.add('match');
    }

    const graph = h('div', 'graph');
    graph.append(renderGraphRow(row.graph, { merge: row.parents.length > 1, head: row.head }));
    const text = h('div', 'text');

    // Local branches and tags next to the subject, remotes on the line below.
    const labels = refLines(row.refs);
    const line1 = h('div', 'line1');
    line1.append(h('span', 'markers'), h('span', 'subject', row.subject));
    if (labels.top.length > 0) {
      line1.append(renderLabels(labels.top, row.graph.color));
    }

    const line2 = h('div', 'line2');
    const meta = h('span', 'meta');
    const date = h('span', 'date', relativeDate(row.authorDate));
    date.dataset.time = String(row.authorDate);
    meta.append(h('span', 'author', row.authorName), h('span', 'sep', ' · '), date, h('span', 'sep', ' · '), h('span', 'hash', row.shortHash));
    line2.append(meta);
    if (labels.bottom.length > 0) {
      line2.append(renderLabels(labels.bottom, row.graph.color));
    }

    text.append(line1, line2);
    element.append(graph, text);
    this.applyMarkers(element);
    return element;
  }
}
