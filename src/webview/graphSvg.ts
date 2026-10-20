import { RowShape, rowGeometry } from '../shared/graphGeometry';

const SVG = 'http://www.w3.org/2000/svg';

/** Lane spacing and row metrics; must match --row-height in main.css. */
export const GRAPH_METRICS = { laneWidth: 12, rowHeight: 40, nodeY: 11 };

/** Number of lane colors in main.css (.c0 … .c4). */
const PALETTE_SIZE = 5;

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
 * (a dot, a ring for merges, a larger ring for HEAD).
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
  const nodeClass = kind.head ? 'node head' : kind.merge ? 'node merge' : 'node';
  svg.append(svgElement('circle', { cx, cy, r: kind.head ? 5 : 4, class: `${nodeClass} ${colorClass(color)}` }));
  return svg;
}
