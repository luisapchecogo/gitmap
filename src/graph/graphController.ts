import { CommitInfo } from '../core/logParser';
import { GitRef, refsByCommit, selectTips } from '../core/refsParser';
import { isCancellation } from '../core/gitRunner';
import { shortHash } from '../core/revision';
import { CommitOrder, GitRepository } from '../git/repository';
import { CommitRow, GraphStatus, HostMessage } from '../shared/protocol';

/** Where the controller sends its output (the webview, or a test). */
export interface GraphSink {
  post(message: HostMessage): void;
}

export interface GraphSettings {
  pageSize(): number;
  commitOrder(): CommitOrder;
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
  private load: AbortController | undefined;
  private pageLoad: Promise<void> | undefined;

  constructor(private readonly settings: GraphSettings) {}

  get currentGeneration(): number {
    return this.generation;
  }

  get loadedRows(): readonly CommitRow[] {
    return this.rows;
  }

  /** Connects a renderer and replays the current state to it. */
  attach(sink: GraphSink): void {
    this.sink = sink;
    this.postReset();
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

    const repository = this.repository;
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
      this.tips = selectTips(refs, head.commit, { showRemotes: true });
      this.badges = refsByCommit(refs);
      this.headCommit = head.commit;
      const page = await this.fetchPage(repository, 0, signal);
      if (generation !== this.generation) {
        return;
      }
      this.rows = page.rows;
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

  dispose(): void {
    this.load?.abort();
    this.sink = undefined;
  }

  private async appendPage(repository: GitRepository, generation: number, signal: AbortSignal): Promise<void> {
    try {
      const page = await this.fetchPage(repository, this.rows.length, signal);
      if (generation !== this.generation) {
        return;
      }
      this.rows.push(...page.rows);
      this.hasMore = page.hasMore;
      this.sink?.post({ type: 'append', generation, rows: page.rows, hasMore: page.hasMore });
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
  ): Promise<{ rows: CommitRow[]; hasMore: boolean }> {
    const pageSize = Math.max(1, this.settings.pageSize());
    const commits = await repository.getLog(
      { tips: this.tips, order: this.settings.commitOrder(), skip, maxCount: pageSize + 1 },
      { signal },
    );
    const hasMore = commits.length > pageSize;
    return { rows: commits.slice(0, pageSize).map((commit) => this.toRow(commit)), hasMore };
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
