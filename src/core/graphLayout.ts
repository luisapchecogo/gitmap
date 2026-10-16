/**
 * A line segment within one graph row.
 *
 * - `through`: a lane passing the row, from column `from` at the top edge
 *   to column `to` at the bottom edge (they differ when lanes shift left).
 * - `in`: a lane ending at this row's commit, from column `from` at the
 *   top edge to the node (`to` is the node's column).
 * - `out`: a lane leaving the node (`from`) toward a parent, reaching
 *   column `to` at the bottom edge.
 */
export interface LaneEdge {
  kind: 'through' | 'in' | 'out';
  from: number;
  to: number;
  /** Color index; renderers cycle it through their palette. */
  color: number;
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

interface Lane {
  /** The commit this lane continues to. */
  hash: string;
  color: number;
}

/**
 * Assigns commits to lanes ("columns") for drawing a branch graph, one row
 * at a time, in the order git log returns them (children before parents).
 *
 * Each lane waits for one commit hash. A commit takes the leftmost lane
 * waiting for it (or opens a new one on the right if it is a branch tip);
 * other lanes waiting for it end at its node. Its first parent continues
 * in its lane (absorbing any lane to its right that waits for the same
 * parent); other parents (merges) join a lane already waiting for them or
 * open a new one. Empty columns are removed at the end of every row so
 * the graph stays as narrow as possible in the side bar.
 *
 * The layout is stateful, so feeding history page by page gives exactly
 * the same rows as feeding it all at once.
 */
export class LaneLayout {
  private lanes: Lane[] = [];
  private nextColor = 0;

  next(commit: LayoutCommit): LaneRow {
    const top = this.lanes;
    const matches: number[] = [];
    top.forEach((lane, index) => {
      if (lane.hash === commit.hash) {
        matches.push(index);
      }
    });

    const slots: (Lane | null)[] = [...top];
    let column: number;
    let color: number;
    if (matches.length === 0) {
      column = slots.length;
      color = this.nextColor++;
      slots.push(null);
    } else {
      column = matches[0];
      color = top[column].color;
    }
    for (const index of matches) {
      slots[index] = null;
    }

    const outs: { slot: number; color: number }[] = [];
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

    this.lanes = bottom;
    return {
      column,
      color,
      edges,
      width: Math.max(top.length, bottom.length, column + 1),
      top: top.map((lane) => lane.hash),
      bottom: bottom.map((lane) => lane.hash),
    };
  }
}
