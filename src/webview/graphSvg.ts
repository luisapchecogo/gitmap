import { RowShape, rowGeometry } from '../shared/graphGeometry';

const SVG = 'http://www.w3.org/2000/svg';

/** Lane spacing and row metrics; must match --row-height in main.css. */
export const GRAPH_METRICS = { laneWidth: 10, rowHeight: 40, nodeY: 11 };

/**
 * Node radii, in px. Lanes are 1.5px wide (main.css), so a 6px dot is
 * easy to spot without dwarfing the lines around it.
 */
const NODE_RADIUS = { commit: 3, merge: 2.75, head: 3.5 };

/** Number of lane colors (gitmap.graphLane1-8 in package.json, .c0 … .c7 in main.css). */
const PALETTE_SIZE = 8;

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
}

/** The CSS class that sets `--lane` to a lane color. */
export const colorClass = (color: number): string => `c${color % PALETTE_SIZE}`;

/**
 * Draws one row of the branch graph: lane segments plus the commit's node
 * (a dot, a ring for merges, a larger, thicker ring for HEAD).
 */
export function renderGraphRow(shape: RowShape, kind: { merge: boolean; head: boolean }): SVGSVGElement {
  const drawing = rowGeometry(shape, GRAPH_METRICS);
  const svg = svgElement('svg', {
    width: drawing.width,
    height: GRAPH_METRICS.rowHeight,
    viewBox: `0 0 ${drawing.width} ${GRAPH_METRICS.rowHeight}`,
    'aria-hidden': 'true',
  });
  for (const path of drawing.paths) {
    svg.append(svgElement('path', { d: path.d, class: `lane ${colorClass(path.color)}` }));
  }
  const { cx, cy, color } = drawing.node;
  const lane = colorClass(color);
  if (kind.head) {
    svg.append(svgElement('circle', { cx, cy, r: NODE_RADIUS.head, class: `node ring head ${lane}` }));
  } else if (kind.merge) {
    svg.append(svgElement('circle', { cx, cy, r: NODE_RADIUS.merge, class: `node ring ${lane}` }));
  } else {
    svg.append(svgElement('circle', { cx, cy, r: NODE_RADIUS.commit, class: `node ${lane}` }));
  }
  return svg;
}
