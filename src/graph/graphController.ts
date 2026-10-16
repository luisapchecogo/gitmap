import { LaneLayout } from '../core/graphLayout';
import { CommitInfo } from '../core/logParser';
import { GitRef, GraphFilter, refsByCommit, selectTips } from '../core/refsParser';
import { isCancellation } from '../core/gitRunner';
import { shortHash } from '../core/revision';
import { CommitOrder, GitRepository } from '../git/repository';
import { CommitRow, GraphStatus, HostMessage, ToolbarState } from '../shared/protocol';

/** Where the controller sends its output (the webview, or a test). */
export interface GraphSink {
  post(message: HostMessage): void;
}

/** Most search results reported. */
export const SEARCH_LIMIT = 200;

/** How far reveal() pages forward looking for a commit. */
export const REVEAL_LIMIT = 10_000;

export interface GraphSettings {
  pageSize(): number;
  commitOrder(): CommitOrder;
  /** The branch filter saved for a repository. */
  filter(repository: GitRepository): GraphFilter;
  /** Number of repositories in the workspace (for the toolbar). */
  repositoryCount(): number;
}

/** `refs/heads/main` → `main`, `refs/remotes/origin/x` → `origin/x`. */
export function shortRefName(fullName: string): string {
  return fullName.replace(/^refs\/(heads|remotes|tags)\//, '');
}

/**
 * Owns the commit graph's state for one repository: the loaded rows, the
 * paging position and the total. The webview is a renderer that can be
 * destroyed at any time (side bar views are disposed when hidden), so on
 * every attach the controller replays everything it has loaded.
 *
 * Each (re)load gets a new generation number. Results of older loads are
 * dropped, and so are page requests the webview sent for them.
 */
export class GraphController {
  private repository: GitRepository | undefined;
  private discovering = true;
  private sink: GraphSink | undefined;

  private generation = 0;
  private status: GraphStatus = { kind: 'searching' };
  private rows: CommitRow[] = [];
  private hasMore = false;
  private total: number | undefined;
  private tips: string[] = [];
  private badges = new Map<string, GitRef[]>();
  private headCommit: string | undefined;
  private filter: GraphFilter = { showRemotes: true };
  /** Lane state carried from page to page; recreated on every reload. */
  private layout = new LaneLayout();
  private load: AbortController | undefined;
  private pageLoad: Promise<void> | undefined;
  private searchLoad: AbortController | undefined;

  constructor(private readonly settings: GraphSettings) {}

  get currentGeneration(): number {
    return this.generation;
  }

  get loadedRows(): readonly CommitRow[] {
    return this.rows;
  }

  get currentRepository(): GitRepository | undefined {
    return this.repository;
  }

  /** The filter of the current load (after falling back from a deleted branch). */
  get currentFilter(): GraphFilter {
    return this.filter;
  }

  /** Connects a renderer and replays the current state to it. */
  attach(sink: GraphSink): void {
    this.sink = sink;
    this.postToolbar();
    this.postReset();
  }

  /** Re-sends the toolbar (e.g. when the number of repositories changes). */
  postToolbar(): void {
    const toolbar: ToolbarState = {
      repositoryName: this.repository?.name,
      repositoryCount: this.settings.repositoryCount(),
      branchLabel: this.filter.branch ? shortRefName(this.filter.branch) : 'All branches',
      branchFiltered: !!this.filter.branch,
      showRemotes: this.filter.showRemotes,
    };
    this.sink?.post({ type: 'toolbar', toolbar });
  }

  detach(sink: GraphSink): void {
    if (this.sink === sink) {
      this.sink = undefined;
    }
  }

  /**
   * Shows `repository` (or the "no repository" state). `discovering`
   * says whether repositories may still turn up.
   */
  async setRepository(repository: GitRepository | undefined, discovering = false): Promise<void> {
    this.discovering = discovering;
    if (repository === this.repository && repository) {
      return;
    }
    this.repository = repository;
    await this.reload();
  }

  /** Reloads from the first page. Supersedes any load in progress. */
  async reload(): Promise<void> {
    this.load?.abort();
    const controller = new AbortController();
    this.load = controller;
    const generation = ++this.generation;
    this.rows = [];
    this.hasMore = false;
    this.total = undefined;
    this.pageLoad = undefined;
    this.layout = new LaneLayout();

    const repository = this.repository;
    this.filter = repository ? this.settings.filter(repository) : { showRemotes: true };
    this.postToolbar();
    if (!repository) {
      this.status = this.discovering ? { kind: 'searching' } : { kind: 'noRepository' };
      this.postReset();
      return;
    }

    this.status = { kind: 'loading' };
    this.postReset();
    try {
      const signal = controller.signal;
      const [refs, head] = await Promise.all([repository.getRefs({ signal }), repository.getHead({ signal })]);
      if (generation !== this.generation) {
        return;
      }
      const branch = this.filter.branch;
      if (branch && !refs.some((ref) => ref.fullName === branch)) {
        // The filtered branch was deleted or renamed: show everything.
        this.filter = { showRemotes: this.filter.showRemotes };
        this.postToolbar();
      }
      this.tips = selectTips(refs, head.commit, this.filter);
      this.badges = refsByCommit(refs);
      this.headCommit = head.commit;
      const page = await this.fetchPage(repository, 0, signal);
      if (generation !== this.generation) {
        return;
      }
      this.rows = page.commits.map((commit) => this.toRow(commit));
      this.hasMore = page.hasMore;
      this.status = this.rows.length === 0 ? { kind: 'empty' } : { kind: 'ready' };
      this.postReset();
      void this.countCommits(repository, generation, signal);
    } catch (error) {
      if (generation !== this.generation || isCancellation(error)) {
        return;
      }
      this.status = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
      this.postReset();
    }
  }

  /** Appends the next page, if the request is for the current load. */
  loadMore(generation: number): Promise<void> {
    if (generation !== this.generation || !this.hasMore || !this.repository || !this.load) {
      return Promise.resolve();
    }
    this.pageLoad ??= this.appendPage(this.repository, generation, this.load.signal).finally(() => {
      this.pageLoad = undefined;
    });
    return this.pageLoad;
  }

  /**
   * Finds commits by hash/revision, message or author within the current
   * filter, and sends the matches. A newer search cancels an older one.
   */
  async search(query: string): Promise<void> {
    this.searchLoad?.abort();
    const repository = this.repository;
    if (!repository || !query.trim()) {
      this.sink?.post({ type: 'searchResults', query, matches: [], truncated: false });
      return;
    }
    const controller = new AbortController();
    this.searchLoad = controller;
    try {
      const { hashes, truncated } = await repository.searchCommits(query, this.tips, SEARCH_LIMIT, { signal: controller.signal });
      if (this.searchLoad === controller) {
        this.sink?.post({ type: 'searchResults', query, matches: hashes, truncated });
      }
    } catch (error) {
      if (this.searchLoad === controller && !isCancellation(error)) {
        const message = error instanceof Error ? error.message : String(error);
        this.sink?.post({ type: 'searchResults', query, matches: [], truncated: false, error: message });
      }
    }
  }

  /**
   * Makes sure a commit is in the loaded rows, paging forward up to
   * REVEAL_LIMIT rows, then tells the webview whether it can scroll to it.
   */
  async reveal(hash: string): Promise<void> {
    const generation = this.generation;
    const loaded = (): boolean => this.rows.some((row) => row.hash === hash);
    while (!loaded() && this.hasMore && this.rows.length < REVEAL_LIMIT && generation === this.generation) {
      const before = this.rows.length;
      await this.loadMore(generation);
      if (this.rows.length === before) {
        break;
      }
    }
    if (generation !== this.generation) {
      return;
    }
    if (loaded()) {
      this.sink?.post({ type: 'reveal', hash, found: true });
    } else {
      const message = this.hasMore
        ? `${shortHash(hash)} is more than ${REVEAL_LIMIT.toLocaleString('en-US')} commits down; narrow the graph to a branch to reach it.`
        : `${shortHash(hash)} is not in the commits shown. Try "All branches" or turning on remote branches.`;
      this.sink?.post({ type: 'reveal', hash, found: false, message });
    }
  }

  dispose(): void {
    this.load?.abort();
    this.searchLoad?.abort();
    this.sink = undefined;
  }

  private async appendPage(repository: GitRepository, generation: number, signal: AbortSignal): Promise<void> {
    try {
      const page = await this.fetchPage(repository, this.rows.length, signal);
      if (generation !== this.generation) {
        return;
      }
      // Rows are built only for the current load: building them advances
      // the lane layout, which a stale page must not touch.
      const rows = page.commits.map((commit) => this.toRow(commit));
      this.rows.push(...rows);
      this.hasMore = page.hasMore;
      this.sink?.post({ type: 'append', generation, rows, hasMore: page.hasMore });
    } catch (error) {
      if (generation === this.generation && !isCancellation(error)) {
        this.hasMore = false;
        this.sink?.post({ type: 'append', generation, rows: [], hasMore: false });
      }
    }
  }

  private async fetchPage(
    repository: GitRepository,
    skip: number,
    signal: AbortSignal,
  ): Promise<{ commits: CommitInfo[]; hasMore: boolean }> {
    const pageSize = Math.max(1, this.settings.pageSize());
    const commits = await repository.getLog(
      { tips: this.tips, order: this.settings.commitOrder(), skip, maxCount: pageSize + 1 },
      { signal },
    );
    const hasMore = commits.length > pageSize;
    return { commits: commits.slice(0, pageSize), hasMore };
  }

  private async countCommits(repository: GitRepository, generation: number, signal: AbortSignal): Promise<void> {
    try {
      const total = await repository.countCommits(this.tips, { signal });
      if (generation === this.generation) {
        this.total = total;
        this.sink?.post({ type: 'total', generation, total });
      }
    } catch {
      // The total is optional: the list works without it.
    }
  }

  private toRow(commit: CommitInfo): CommitRow {
    const lane = this.layout.next(commit);
    return {
      hash: commit.hash,
      shortHash: shortHash(commit.hash),
      subject: commit.subject,
      body: commit.body,
      authorName: commit.authorName,
      authorEmail: commit.authorEmail,
      authorDate: commit.authorDate,
      parents: commit.parents,
      refs: (this.badges.get(commit.hash) ?? []).map((ref) => ({ name: ref.name, kind: ref.kind, current: ref.isHead })),
      head: commit.hash === this.headCommit,
      graph: { column: lane.column, color: lane.color, width: lane.width, edges: lane.edges },
    };
  }

  private postReset(): void {
    this.sink?.post({
      type: 'reset',
      generation: this.generation,
      status: this.status,
      rows: this.rows,
      hasMore: this.hasMore,
      total: this.total,
    });
  }
}
