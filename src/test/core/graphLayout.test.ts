import * as assert from 'assert';
import { LaneLayout, LaneRow, LayoutCommit } from '../../core/graphLayout';

function layout(commits: LayoutCommit[]): LaneRow[] {
  const lanes = new LaneLayout();
  return commits.map((commit) => lanes.next(commit));
}

/** Compact description of a row: node column, then edges as kind:from>to. */
function describe(row: LaneRow): string {
  const edges = row.edges.map((e) => `${e.kind}:${e.from}>${e.to}`).join(' ');
  return `${row.column} | ${edges}`;
}

/** Checks that a row's edges are consistent with its top and bottom lanes. */
function assertRowConsistent(row: LaneRow, label: string): void {
  // Every lane entering at the top starts exactly one edge.
  for (let column = 0; column < row.top.length; column++) {
    const starting = row.edges.filter((e) => e.kind !== 'out' && e.from === column);
    assert.strictEqual(starting.length, 1, `${label}: top column ${column} should start one edge`);
  }
  // Every lane leaving at the bottom is reached by at least one edge, and no
  // edge leaves through an empty column.
  for (let column = 0; column < row.bottom.length; column++) {
    assert.ok(
      row.edges.some((e) => e.kind !== 'in' && e.to === column),
      `${label}: bottom column ${column} should be reached`,
    );
  }
  for (const edge of row.edges) {
    if (edge.kind !== 'in') {
      assert.ok(edge.to < row.bottom.length, `${label}: edge ends in an empty column`);
    }
    assert.ok(Math.max(edge.from, edge.to) < row.width, `${label}: edge outside the row width`);
  }
  assert.ok(row.column < row.width);
}

function assertLayoutConsistent(rows: LaneRow[]): void {
  rows.forEach((row, i) => {
    assertRowConsistent(row, `row ${i}`);
    if (i + 1 < rows.length) {
      assert.deepStrictEqual(rows[i + 1].top, row.bottom, `row ${i} bottom should equal row ${i + 1} top`);
    }
  });
}

suite('LaneLayout', () => {
  test('a linear history stays in one column', () => {
    const rows = layout([
      { hash: 'c', parents: ['b'] },
      { hash: 'b', parents: ['a'] },
      { hash: 'a', parents: [] },
    ]);
    assert.deepStrictEqual(rows.map(describe), ['0 | out:0>0', '0 | in:0>0 out:0>0', '0 | in:0>0']);
    assert.ok(rows.every((row) => row.width === 1 && row.color === rows[0].color));
    assertLayoutConsistent(rows);
  });

  test('a fork opens a lane on the right and closes it at the fork point', () => {
    const rows = layout([
      { hash: 'main2', parents: ['main1'] },
      { hash: 'topic2', parents: ['topic1'] },
      { hash: 'main1', parents: ['base'] },
      { hash: 'topic1', parents: ['base'] },
      { hash: 'base', parents: [] },
    ]);
    assert.deepStrictEqual(rows.map(describe), [
      '0 | out:0>0',
      '1 | through:0>0 out:1>1',
      '0 | in:0>0 through:1>1 out:0>0',
      '1 | through:0>0 in:1>1 out:1>0',
      '0 | in:0>0',
    ]);
    assert.notStrictEqual(rows[1].color, rows[0].color);
    assert.strictEqual(rows[4].color, rows[0].color, 'the first-parent chain keeps its color');
    assertLayoutConsistent(rows);
  });

  test('a merge opens a lane for its second parent and the first-parent chain keeps its column', () => {
    const rows = layout([
      { hash: 'merge', parents: ['main1', 'feature'] },
      { hash: 'feature', parents: ['base'] },
      { hash: 'main1', parents: ['base'] },
      { hash: 'base', parents: [] },
    ]);
    assert.deepStrictEqual(rows.map(describe), [
      '0 | out:0>0 out:0>1',
      '1 | through:0>0 in:1>1 out:1>1',
      '0 | in:0>0 through:1>0 out:0>0',
      '0 | in:0>0',
    ]);
    assert.strictEqual(rows[3].color, rows[0].color);
    assertLayoutConsistent(rows);
  });

  test('octopus merges open one lane per extra parent', () => {
    const rows = layout([
      { hash: 'octopus', parents: ['a', 'b', 'c'] },
      { hash: 'c', parents: ['root'] },
      { hash: 'b', parents: ['root'] },
      { hash: 'a', parents: ['root'] },
      { hash: 'root', parents: [] },
    ]);
    assert.strictEqual(rows[0].edges.filter((e) => e.kind === 'out').length, 3);
    assert.strictEqual(rows[0].bottom.length, 3);
    assert.strictEqual(rows[4].width, 1);
    assertLayoutConsistent(rows);
  });

  test('unrelated histories sit side by side', () => {
    const rows = layout([
      { hash: 'x2', parents: ['x1'] },
      { hash: 'y1', parents: [] },
      { hash: 'x1', parents: [] },
    ]);
    assert.deepStrictEqual(rows.map((r) => r.column), [0, 1, 0]);
    assertLayoutConsistent(rows);
  });

  test('lanes to missing parents (shallow clones) continue to the end', () => {
    const rows = layout([
      { hash: 'b', parents: ['a'] },
      { hash: 'a', parents: ['grafted'] },
    ]);
    assert.deepStrictEqual(rows[1].bottom, ['grafted']);
    assertLayoutConsistent(rows);
  });

  test('paged layout equals whole-history layout', () => {
    const commits = randomDag(200, 7);
    const whole = layout(commits);
    const paged = new LaneLayout();
    const rows: LaneRow[] = [];
    for (let i = 0; i < commits.length; i += 37) {
      rows.push(...commits.slice(i, i + 37).map((c) => paged.next(c)));
    }
    assert.deepStrictEqual(rows, whole);
  });

  test('random histories always produce consistent rows', () => {
    for (let seed = 1; seed <= 25; seed++) {
      assertLayoutConsistent(layout(randomDag(150, seed)));
    }
  });
});

/**
 * A random history in git log order (children before parents): each commit
 * has one parent, or two/three for merges, chosen among older commits, with
 * an occasional extra root.
 */
function randomDag(size: number, seed: number): LayoutCommit[] {
  let state = seed;
  const random = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const commits: LayoutCommit[] = [];
  for (let i = 0; i < size; i++) {
    const older = size - 1 - i; // commits after this one in the list are older
    const parents = new Set<string>();
    if (older > 0 && random() > 0.03) {
      const pick = (): string => `c${i + 1 + Math.floor(random() * Math.min(older, 12))}`;
      parents.add(pick());
      const roll = random();
      if (roll > 0.8) {
        parents.add(pick());
      }
      if (roll > 0.97) {
        parents.add(pick());
      }
    }
    commits.push({ hash: `c${i}`, parents: [...parents] });
  }
  return commits;
}
