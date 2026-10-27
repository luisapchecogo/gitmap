// Shared by the extension host (tests) and the webview: no Node or vscode imports.

/** The parts of a graph row the drawing needs (a subset of LaneRow). */
export interface RowShape {
  column: number;
  color: number;
  width: number;
  edges: readonly { kind: 'through' | 'in' | 'out' | 'stubIn' | 'stubOut'; from: number; to: number; color: number; target?: string }[];
}

export interface GeometryOptions {
  /** Horizontal distance between lanes, in px. */
  laneWidth: number;
  /** Full row height, in px. */
  rowHeight: number;
  /** Vertical position of the commit's node within the row, in px. */
  nodeY: number;
  /** Height of the stub leaving a node for a cut edge, in px. */
  stubLength: number;
}

export interface RowPath {
  /** SVG path data. */
  d: string;
  color: number;
  /** Set for the stubs of cut edges, which fade toward the far end. */
  stub?: 'in' | 'out';
  /** Stubs only: the commit at the other end. */
  target?: string;
}

export interface RowDrawing {
  /** Total drawing width, in px. */
  width: number;
  paths: RowPath[];
  node: { cx: number; cy: number; color: number };
}

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * SVG paths for one row. Every lane is vertical where it crosses the top
 * and bottom edges, so rows drawn separately join up seamlessly:
 * - a lane passing straight through is a vertical line;
 * - a lane shifting columns is an S-curve across the row;
 * - a lane ending at the node curves in from the top;
 * - a lane leaving the node toward another column leaves horizontally
 *   and bends down to the bottom edge;
 * - a stub leaving the node goes `stubLength` down, or leaves to the right
 *   and bends down halfway to the next column (where no lane runs);
 * - a stub entering the node comes down from the top edge, or from halfway
 *   to the next column and bends into the node.
 */
export function rowGeometry(row: RowShape, options: GeometryOptions): RowDrawing {
  const { laneWidth, rowHeight: h, nodeY, stubLength } = options;
  const x = (column: number): number => round(column * laneWidth + laneWidth / 2);
  const paths: RowPath[] = [];

  for (const edge of row.edges) {
    const x1 = x(edge.from);
    const x2 = x(edge.to);
    // The far end of a slanted stub: halfway between its two columns.
    const xm = round((x1 + x2) / 2);
    let d: string;
    switch (edge.kind) {
      case 'through':
        d = x1 === x2 ? `M${x1} 0V${h}` : `M${x1} 0C${x1} ${round(h / 2)} ${x2} ${round(h / 2)} ${x2} ${h}`;
        break;
      case 'in':
        d = x1 === x2 ? `M${x1} 0V${nodeY}` : `M${x1} 0Q${x1} ${nodeY} ${x2} ${nodeY}`;
        break;
      case 'out':
        d = x1 === x2 ? `M${x1} ${nodeY}V${h}` : `M${x1} ${nodeY}Q${x2} ${nodeY} ${x2} ${h}`;
        break;
      case 'stubOut':
        d = x1 === x2 ? `M${x1} ${nodeY}V${nodeY + stubLength}` : `M${x1} ${nodeY}Q${xm} ${nodeY} ${xm} ${nodeY + stubLength}`;
        paths.push({ d, color: edge.color, stub: 'out', target: edge.target });
        continue;
      case 'stubIn':
        d = x1 === x2 ? `M${x2} 0V${nodeY}` : `M${xm} 0Q${xm} ${nodeY} ${x2} ${nodeY}`;
        paths.push({ d, color: edge.color, stub: 'in', target: edge.target });
        continue;
    }
    paths.push({ d, color: edge.color });
  }

  return {
    width: row.width * laneWidth,
    paths,
    node: { cx: x(row.column), cy: nodeY, color: row.color },
  };
}
