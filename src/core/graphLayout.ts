/**
 * Longest edge drawn as a line, in rows: about one screen of the side
 * bar. Longer edges are cut to stubs (see LaneLayout).
 */
export const MAX_LINE_ROWS = 12;

/**
 * A line segment within one graph row.
 *
 * - `through`: a lane passing the row, from column `from` at the top edge
 *   to column `to` at the bottom edge (they differ when lanes shift left).
 * - `in`: a lane ending at this row's commit, from column `from` at the
 *   top edge to the node (`to` is the node's column).
 * - `out`: a lane leaving the node (`from`) toward a parent, reaching
 *   column `to` at the bottom edge.
 * - `stubOut`: the start of an edge cut for being too long: a short stub
 *   leaving the node (`from`) toward its parent, straight down when `to`
 *   is the node's column, or down to the right when it is the next one.
 * - `stubIn`: the end of cut edges: a short stub into the node (`to`)
 *   from straight above when `from` is the node's column, or from the
 *   upper right when it is the next one.
 */
export interface LaneEdge {
  kind: 'through' | 'in' | 'out' | 'stubIn' | 'stubOut';
  from: number;
  to: number;
  /** Color index; renderers cycle it through their palette. */
  color: number;
  /** Stubs only: the commit at the other end of the cut edge. */
  target?: string;
}

export interface LaneRow {
  /** Column of the commit's node. */
  column: number;
  /** Color index of the commit's lane. */
  color: number;
  edges: LaneEdge[];
  /** Columns the row spans (for sizing its drawing). */
  width: number;
  /** Hashes the lanes are waiting for at the top edge, by column. */
  top: string[];
  /** Hashes the lanes are waiting for at the bottom edge, by column. */
  bottom: string[];
}

export interface LayoutCommit {
  hash: string;
  parents: readonly string[];
}

export interface LayoutOptions {
  /**
   * Commit whose first-parent chain is never cut (HEAD, or the filtered
   * branch), so the line the user is on stays continuous.
   */
  spine?: string;
  /** Overrides MAX_LINE_ROWS (for tests). */
  maxLineRows?: number;
}

interface Lane {
  /** The commit this lane continues to. */
  hash: string;
  color: number;
}

/** An edge cut at its child, waiting to draw its stub at the parent. */
interface CutEdge {
  child: string;
  color: number;
  firstParent: boolean;
}

/**
 * Assigns commits to lanes ("columns") for drawing a branch graph, one row
 * at a time, in the order git log returns them (children before parents).
 *
 * Each lane waits for one commit hash. A commit takes the leftmost lane
 * waiting for it (or opens a new one on the right if no lane waits for
 * it). Its first parent continues in its lane (absorbing any lane to its
 * right that waits for the same parent); other parents (merges) join a
 * lane already waiting for them or open a new one. Empty columns are
 * removed at the end of every row so the graph stays as narrow as
 * possible in the side bar.
 *
 * An edge to a parent more than `maxLineRows` rows below (or not in the
 * history at all) gets no lane: it is drawn as a stub leaving the child
 * and a stub entering the parent, like gitk's "hyperspace" lines and
 * partial edge drawings in graph visualization. Long edges are few, but
 * each would hold a column for hundreds of rows; on busy repositories
 * they are what makes the graph dozens of lanes wide, while their ends
 * are rarely on screen together. The first-parent chain of the `spine`
 * commit is never cut.
 *
 * The layout is stateful, so feeding history page by page gives exactly
 * the same rows as feeding it all at once, as long as every page comes
 * with the `maxLineRows` commits that follow it.
 */
export class LaneLayout {
  private lanes: Lane[] = [];
  private nextColor = 0;
  /** Parent hash → the cut edges waiting for it, nearest child last. */
  private readonly cut = new Map<string, CutEdge[]>();
  /** The next commit of the spine's first-parent chain. */
  private spine: string | undefined;
  private readonly maxLineRows: number;

  constructor(options: LayoutOptions = {}) {
    this.spine = options.spine;
    this.maxLineRows = options.maxLineRows ?? MAX_LINE_ROWS;
  }

  /**
   * Lays out the next commits, in log order. `following` are the commits
   * right after them (at least `maxLineRows` of them, unless the history
   * ends): they only tell how far each parent is, and get their rows in a
   * later call.
   */
  rows(commits: readonly LayoutCommit[], following: readonly LayoutCommit[] = []): LaneRow[] {
    const position = new Map<string, number>();
    [...commits, ...following].forEach((commit, index) => position.set(commit.hash, index));
    return commits.map((commit, row) =>
      this.next(commit, (hash) => {
        const at = position.get(hash);
        return at !== undefined && at - row <= this.maxLineRows;
      }),
    );
  }

  private next(commit: LayoutCommit, near: (hash: string) => boolean): LaneRow {
    const top = this.lanes;
    const matches: number[] = [];
    top.forEach((lane, index) => {
      if (lane.hash === commit.hash) {
        matches.push(index);
      }
    });
    const cutIn = this.cut.get(commit.hash);
    this.cut.delete(commit.hash);
    /** The cut edge whose stub this node draws: the nearest, preferring a first-parent chain. */
    const cutEdge = cutIn && ([...cutIn].reverse().find((edge) => edge.firstParent) ?? cutIn[cutIn.length - 1]);

    const slots: (Lane | null)[] = [...top];
    let column: number;
    let color: number;
    if (matches.length === 0) {
      column = slots.length;
      // A chain resuming after a cut edge keeps its color.
      color = cutEdge ? cutEdge.color : this.nextColor++;
      slots.push(null);
    } else {
      column = matches[0];
      color = top[column].color;
    }
    for (const index of matches) {
      slots[index] = null;
    }
    const onSpine = commit.hash === this.spine;
    if (onSpine) {
      this.spine = commit.parents[0];
    }

    const outs: { slot: number; color: number }[] = [];
    const stubs: { color: number; target: string }[] = [];
    /** Top lanes merged into another lane at the bottom edge: top column → slot. */
    const redirects = new Map<number, number>();
    commit.parents.forEach((parent, index) => {
      const existing = slots.findIndex((lane) => lane?.hash === parent);
      if (index === 0 && existing > column) {
        // A lane to the right also leads to our first parent. Keep the
        // parent in our (more central) lane, so a first-parent chain keeps
        // its column and color, and fold the other lane into it.
        slots[column] = { hash: parent, color };
        slots[existing] = null;
        redirects.set(existing, column);
        outs.push({ slot: column, color });
        return;
      }
      if (existing >= 0) {
        // Another lane already leads to this parent: join it.
        outs.push({ slot: existing, color: index === 0 ? color : (slots[existing] as Lane).color });
        return;
      }
      if (!near(parent) && !(index === 0 && onSpine)) {
        // Too far to draw (or not loaded at all): cut the edge.
        const edge = { child: commit.hash, color: index === 0 ? color : this.nextColor++, firstParent: index === 0 };
        stubs.push({ color: edge.color, target: parent });
        const waiting = this.cut.get(parent);
        if (waiting) {
          waiting.push(edge);
        } else {
          this.cut.set(parent, [edge]);
        }
        return;
      }
      if (index === 0) {
        slots[column] = { hash: parent, color };
        outs.push({ slot: column, color });
        return;
      }
      let slot = slots.findIndex((lane, i) => lane === null && i > column);
      if (slot < 0) {
        slot = slots.length;
        slots.push(null);
      }
      const lane = { hash: parent, color: this.nextColor++ };
      slots[slot] = lane;
      outs.push({ slot, color: lane.color });
    });

    // Compact: drop empty columns, shifting the lanes to their right.
    const position: number[] = [];
    let next = 0;
    for (const lane of slots) {
      position.push(lane ? next++ : -1);
    }
    const bottom = slots.filter((lane): lane is Lane => lane !== null);

    const edges: LaneEdge[] = [];
    top.forEach((lane, index) => {
      if (lane.hash === commit.hash) {
        edges.push({ kind: 'in', from: index, to: column, color: lane.color });
      } else {
        edges.push({ kind: 'through', from: index, to: position[redirects.get(index) ?? index], color: lane.color });
      }
    });
    for (const out of outs) {
      edges.push({ kind: 'out', from: column, to: position[out.slot], color: out.color });
    }
    // Stubs go straight down or up only where no lane does, so they never
    // hide one; otherwise they slant to the right.
    let straightDown = outs.some((out) => position[out.slot] === column);
    for (const stub of stubs) {
      edges.push({ kind: 'stubOut', from: column, to: straightDown ? column + 1 : column, color: stub.color, target: stub.target });
      straightDown = true;
    }
    if (cutEdge) {
      const from = matches.length > 0 ? column + 1 : column;
      edges.push({ kind: 'stubIn', from, to: column, color: cutEdge.color, target: cutEdge.child });
    }

    this.lanes = bottom;
    return {
      column,
      color,
      edges,
      // Slanted stubs end halfway to the next column, so they fit in the
      // renderer's margin without widening the graph.
      width: Math.max(top.length, bottom.length, column + 1),
      top: top.map((lane) => lane.hash),
      bottom: bottom.map((lane) => lane.hash),
    };
  }
}
