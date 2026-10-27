import * as assert from 'assert';
import { LaneLayout, LaneRow, LayoutCommit, LayoutOptions } from '../../core/graphLayout';

function layout(commits: LayoutCommit[], options?: LayoutOptions): LaneRow[] {
  return new LaneLayout(options).rows(commits);
}

const isStub = (edge: LaneRow['edges'][number]): boolean => edge.kind === 'stubIn' || edge.kind === 'stubOut';

/** Compact description of a row: node column, then edges as kind:from>to. */
function describe(row: LaneRow): string {
  const edges = row.edges.map((e) => `${e.kind}:${e.from}>${e.to}`).join(' ');
  return `${row.column} | ${edges}`;
}

/** Checks that a row's edges are consistent with its top and bottom lanes. */
function assertRowConsistent(row: LaneRow, label: string): void {
  const lanes = row.edges.filter((e) => !isStub(e));
  // Every lane entering at the top starts exactly one edge.
  for (let column = 0; column < row.top.length; column++) {
    const starting = lanes.filter((e) => e.kind !== 'out' && e.from === column);
    assert.strictEqual(starting.length, 1, `${label}: top column ${column} should start one edge`);
  }
  // Every lane leaving at the bottom is reached by at least one edge, and no
  // edge leaves through an empty column.
  for (let column = 0; column < row.bottom.length; column++) {
    assert.ok(
      lanes.some((e) => e.kind !== 'in' && e.to === column),
      `${label}: bottom column ${column} should be reached`,
    );
  }
  for (const edge of lanes) {
    if (edge.kind !== 'in') {
      assert.ok(edge.to < row.bottom.length, `${label}: edge ends in an empty column`);
    }
  }
  for (const edge of lanes) {
    assert.ok(Math.max(edge.from, edge.to) < row.width, `${label}: edge outside the row width`);
  }
  for (const stub of row.edges.filter(isStub)) {
    // A slanted stub reaches halfway to the next column, at most.
    assert.ok(Math.min(stub.from, stub.to) === row.column && Math.abs(stub.from - stub.to) <= 1, `${label}: stub off its node`);
  }
  assert.ok(row.column < row.width);
}

/**
 * Checks that every parent edge is drawn, either as a lane or as a pair of
 * stubs pointing at each other, and that no lane outside the spine's
 * first-parent chain spans more than `maxLineRows` rows.
 */
function assertEdgesDrawn(commits: LayoutCommit[], rows: LaneRow[], maxLineRows: number, spine?: string): void {
  const position = new Map(commits.map((commit, index) => [commit.hash, index]));
  const chain = new Set<string>();
  for (let hash = spine; hash !== undefined && !chain.has(hash); hash = commits[position.get(hash) ?? -1]?.parents[0]) {
    chain.add(hash);
  }
  commits.forEach((commit, index) => {
    const row = rows[index];
    for (const parent of commit.parents) {
      const lane = row.edges.some((e) => e.kind === 'out' && row.bottom[e.to] === parent);
      const stub = row.edges.some((e) => e.kind === 'stubOut' && e.target === parent);
      assert.ok(lane !== stub, `row ${index}: the edge to ${parent} should be a lane or a stub`);
      const at = position.get(parent);
      if (stub && at !== undefined) {
        assert.ok(
          rows[at].edges.some((e) => e.kind === 'stubIn'),
          `row ${at}: ${parent} should show the stub of the edge from ${commit.hash}`,
        );
      }
    }
    for (const edge of row.edges.filter((e) => e.kind === 'stubIn')) {
      const child = commits[position.get(edge.target ?? '') ?? -1];
      assert.ok(child?.parents.includes(commit.hash), `row ${index}: a stub in should point at a child`);
      assert.ok(
        rows[position.get(child.hash) as number].edges.some((e) => e.kind === 'stubOut' && e.target === commit.hash),
        `row ${index}: the child's stub should point back`,
      );
    }
    for (const hash of row.bottom) {
      const at = position.get(hash);
      assert.ok(
        chain.has(hash) || (at !== undefined && at - index <= maxLineRows),
        `row ${index}: lane to ${hash} is longer than ${maxLineRows} rows`,
      );
    }
  });
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

  test('edges to missing parents (shallow clones) end in a stub', () => {
    const rows = layout([
      { hash: 'b', parents: ['a'] },
      { hash: 'a', parents: ['grafted'] },
    ]);
    assert.deepStrictEqual(rows.map(describe), ['0 | out:0>0', '0 | in:0>0 stubOut:0>0']);
    assert.deepStrictEqual(rows[1].bottom, []);
    assert.strictEqual(rows[1].edges[1].target, 'grafted');
    assertLayoutConsistent(rows);
  });

  test('an edge longer than the limit becomes two stubs and frees its column', () => {
    const commits = [
      { hash: 'main3', parents: ['main2'] },
      { hash: 'topic', parents: ['base'] },
      { hash: 'main2', parents: ['main1'] },
      { hash: 'main1', parents: ['base'] },
      { hash: 'base', parents: [] },
    ];
    const rows = layout(commits, { maxLineRows: 2 });
    assert.deepStrictEqual(rows.map(describe), [
      '0 | out:0>0',
      // topic → base spans 3 rows: a stub straight down, no lane.
      '1 | through:0>0 stubOut:1>1',
      '0 | in:0>0 out:0>0',
      '0 | in:0>0 out:0>0',
      // base already has a lane from above, so the stub comes from the right.
      '0 | in:0>0 stubIn:1>0',
    ]);
    assert.deepStrictEqual([rows[1].edges[1].target, rows[4].edges[1].target], ['base', 'topic']);
    assert.strictEqual(rows[4].edges[1].color, rows[1].color, 'both stubs have the color of the cut lane');
    assert.ok(rows.slice(2).every((row) => row.width <= 2));
    assertLayoutConsistent(rows);
    assertEdgesDrawn(commits, rows, 2);

    // Within the limit, the same history keeps its lane.
    const drawn = layout(commits, { maxLineRows: 3 });
    assert.deepStrictEqual(drawn[1].bottom, ['main2', 'base']);
    assert.ok(!drawn.some((row) => row.edges.some(isStub)));
  });

  test('the spine is never cut, and a cut chain resumes in its own color', () => {
    const commits = [
      { hash: 'head', parents: ['base'] },
      { hash: 'other2', parents: ['other1'] },
      { hash: 'root', parents: [] },
      { hash: 'base', parents: [] },
      { hash: 'other1', parents: [] },
    ];
    const rows = layout(commits, { maxLineRows: 1, spine: 'head' });
    assert.deepStrictEqual(rows.map(describe), [
      '0 | out:0>0',
      '1 | through:0>0 stubOut:1>1',
      '1 | through:0>0',
      '0 | in:0>0',
      // other1 opens a fresh column, so its stub comes from straight above.
      '0 | stubIn:0>0',
    ]);
    assert.strictEqual(rows[4].color, rows[1].color);
    assertLayoutConsistent(rows);
    assertEdgesDrawn(commits, rows, 1, 'head');
  });

  test('a merge with a cut parent slants the stub away from the lane below it', () => {
    const commits = [
      { hash: 'merge', parents: ['main1', 'feature'] },
      { hash: 'main1', parents: ['base'] },
      { hash: 'x', parents: [] },
      { hash: 'feature', parents: ['base'] },
      { hash: 'base', parents: [] },
    ];
    const rows = layout(commits, { maxLineRows: 2 });
    assert.deepStrictEqual(rows.map(describe).slice(0, 2), [
      // main1 continues straight down, so feature's stub leaves to the right.
      '0 | out:0>0 stubOut:0>1',
      '0 | in:0>0 stubOut:0>0',
    ]);
    assertLayoutConsistent(rows);
    assertEdgesDrawn(commits, rows, 2);
  });

  test('paged layout equals whole-history layout when pages bring the rows that follow', () => {
    const commits = randomDag(200, 7);
    const options = { maxLineRows: 4, spine: 'c0' };
    const whole = layout(commits, options);
    assert.ok(whole.some((row) => row.edges.some(isStub)), 'the history has cut edges');
    const paged = new LaneLayout(options);
    const rows: LaneRow[] = [];
    for (let i = 0; i < commits.length; i += 37) {
      rows.push(...paged.rows(commits.slice(i, i + 37), commits.slice(i + 37, i + 37 + options.maxLineRows)));
    }
    assert.deepStrictEqual(rows, whole);
  });

  test('random histories always produce consistent rows', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const commits = randomDag(150, seed);
      for (const maxLineRows of [3, 100]) {
        const rows = layout(commits, { maxLineRows, spine: 'c0' });
        assertLayoutConsistent(rows);
        assertEdgesDrawn(commits, rows, maxLineRows, 'c0');
      }
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
