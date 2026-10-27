import { RowShape, rowGeometry } from '../shared/graphGeometry';

const SVG = 'http://www.w3.org/2000/svg';

/** Lane spacing and row metrics; must match --row-height in main.css. */
export const GRAPH_METRICS = { laneWidth: 10, rowHeight: 40, nodeY: 11, stubLength: 24 };

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

const fadeId = (stub: 'in' | 'out', color: number): string => `gitmap-fade-${stub}-${color % PALETTE_SIZE}`;

/**
 * The gradients that fade stubs out toward their far end, one per lane
 * color and direction. Rows reference them by id, so this must be in the
 * document once. They use row coordinates, which every row shares.
 */
export function renderGraphDefs(): SVGSVGElement {
  const { nodeY, stubLength } = GRAPH_METRICS;
  const svg = svgElement('svg', { class: 'graph-defs', 'aria-hidden': 'true' });
  const defs = svgElement('defs', {});
  for (let color = 0; color < PALETTE_SIZE; color++) {
    for (const [stub, y1, y2] of [
      ['out', nodeY, nodeY + stubLength],
      ['in', nodeY, 0],
    ] as const) {
      const gradient = svgElement('linearGradient', {
        id: fadeId(stub, color),
        class: colorClass(color),
        gradientUnits: 'userSpaceOnUse',
        x1: 0,
        y1,
        x2: 0,
        y2,
      });
      // Solid for the first half, so even short stubs are easy to see.
      gradient.append(
        svgElement('stop', { offset: 0.5 }),
        svgElement('stop', { offset: 1, 'stop-opacity': 0 }),
      );
      defs.append(gradient);
    }
  }
  svg.append(defs);
  return svg;
}

/**
 * Draws one row of the branch graph: lane segments, stubs of cut edges
 * (fading out), and the commit's node (a dot, a ring for merges, a larger,
 * thicker ring for HEAD). Each stub has a wider, invisible twin that is
 * easy to click, carrying the commit at its far end (`data-target`).
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
    if (!path.stub) {
      svg.append(svgElement('path', { d: path.d, class: `lane ${colorClass(path.color)}` }));
      continue;
    }
    if (path.target) {
      const hit = svgElement('path', { d: path.d, class: 'stub-hit', 'data-target': path.target });
      const title = svgElement('title', {});
      title.textContent =
        path.stub === 'out'
          ? `Continues down to ${path.target.slice(0, 7)}. Click to go there.`
          : `Continues up to ${path.target.slice(0, 7)}. Click to go there.`;
      hit.append(title);
      svg.append(hit);
    }
    svg.append(svgElement('path', { d: path.d, class: `stub ${colorClass(path.color)}`, stroke: `url(#${fadeId(path.stub, path.color)})` }));
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
