import { relativeDate } from '../shared/format';
import { CommitRow } from '../shared/protocol';
import { h } from './dom';
import { GRAPH_METRICS, renderGraphRow } from './graphSvg';

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

  constructor(private readonly onLoadMore: () => void) {
    this.element = h('div', 'list');
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

  private renderRow(row: CommitRow): HTMLElement {
    const element = h('div', row.head ? 'row head' : 'row');
    element.setAttribute('role', 'listitem');
    element.dataset.hash = row.hash;
    element.title = tooltip(row);

    const graph = h('div', 'graph');
    graph.append(renderGraphRow(row.graph, { merge: row.parents.length > 1, head: row.head }));
    const text = h('div', 'text');

    const line1 = h('div', 'line1');
    line1.append(h('span', 'subject', row.subject));
    if (row.refs.length > 0) {
      const refs = h('span', 'refs');
      for (const ref of row.refs) {
        refs.append(h('span', `badge ${ref.kind}${ref.current ? ' current' : ''}`, ref.name));
      }
      line1.append(refs);
    }

    const line2 = h('div', 'line2');
    const date = h('span', 'date', relativeDate(row.authorDate));
    date.dataset.time = String(row.authorDate);
    line2.append(h('span', 'author', row.authorName), h('span', 'sep', ' · '), date, h('span', 'sep', ' · '), h('span', 'hash', row.shortHash));

    text.append(line1, line2);
    element.append(graph, text);
    return element;
  }
}
