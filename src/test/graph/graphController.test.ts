import * as assert from 'assert';
import { GitRunner } from '../../core/gitRunner';
import { GraphController } from '../../graph/graphController';
import { GitRepository } from '../../git/repository';
import { RecordingSink } from '../helpers/sink';
import { TempRepo } from '../helpers/tempRepo';

suite('GraphController', () => {
  let repo: TempRepo;
  let git: GitRepository;
  const settings = { pageSize: () => 3, commitOrder: () => 'date' as const };

  suiteSetup(async () => {
    repo = await TempRepo.create();
    for (let i = 1; i <= 7; i++) {
      await repo.commitFiles(`commit ${i}`, { 'a.txt': `${i}\n` });
    }
    await repo.git('tag', 'v1', 'HEAD~2');
    git = new GitRepository(repo.root, new GitRunner({ env: repo.env }));
  });

  suiteTeardown(async () => {
    await repo.dispose();
  });

  test('loads the first page with badges, HEAD and the total', async () => {
    const controller = new GraphController(settings);
    const sink = new RecordingSink();
    controller.attach(sink);
    await controller.setRepository(git);
    const reset = sink.lastReset();
    assert.strictEqual(reset?.status.kind, 'ready');
    assert.deepStrictEqual(
      reset?.rows.map((r) => r.subject),
      ['commit 7', 'commit 6', 'commit 5'],
    );
    assert.strictEqual(reset?.hasMore, true);
    assert.strictEqual(reset?.rows[0].head, true);
    assert.deepStrictEqual(reset?.rows[0].refs, [{ name: 'main', kind: 'head', current: true }]);
    assert.deepStrictEqual(reset?.rows[2].refs, [{ name: 'v1', kind: 'tag', current: false }]);
    const total = await sink.waitFor((m) => m.type === 'total');
    assert.strictEqual(total.type === 'total' && total.total, 7);
    controller.dispose();
  });

  test('appends pages until the history ends', async () => {
    const controller = new GraphController(settings);
    const sink = new RecordingSink();
    controller.attach(sink);
    await controller.setRepository(git);
    const generation = controller.currentGeneration;
    await controller.loadMore(generation);
    await controller.loadMore(generation);
    const appends = sink.messages.filter((m) => m.type === 'append');
    assert.strictEqual(appends.length, 2);
    assert.strictEqual(appends[1].type === 'append' && appends[1].hasMore, false);
    assert.deepStrictEqual(
      controller.loadedRows.map((r) => r.subject),
      ['commit 7', 'commit 6', 'commit 5', 'commit 4', 'commit 3', 'commit 2', 'commit 1'],
    );
    controller.dispose();
  });

  test('replays everything loaded to a new webview', async () => {
    const controller = new GraphController(settings);
    await controller.setRepository(git);
    await controller.loadMore(controller.currentGeneration);
    const sink = new RecordingSink();
    controller.attach(sink);
    assert.strictEqual(sink.messages.length, 1);
    assert.strictEqual(sink.lastReset()?.rows.length, 6);
    controller.dispose();
  });

  test('drops results and page requests from stale loads', async () => {
    const controller = new GraphController(settings);
    const sink = new RecordingSink();
    controller.attach(sink);
    await controller.setRepository(git);
    const stale = controller.currentGeneration;
    const first = controller.reload();
    const second = controller.reload();
    await Promise.all([first, second]);
    const current = controller.currentGeneration;
    assert.strictEqual(current, stale + 2);

    await controller.loadMore(stale);
    assert.ok(!sink.messages.some((m) => m.type === 'append'), 'stale page requests are ignored');

    const lastReady = sink.messages.filter((m) => m.type === 'reset' && m.status.kind === 'ready').pop();
    assert.strictEqual(lastReady?.generation, current);
    const afterIndex = sink.messages.indexOf(lastReady);
    assert.ok(
      sink.messages.slice(afterIndex).every((m) => m.generation === current),
      'nothing from an older load arrives after the newest one',
    );
    assert.ok(
      !sink.messages.some((m) => m.type === 'reset' && m.status.kind === 'ready' && m.generation === stale + 1),
      'the superseded load never reports results',
    );
    controller.dispose();
  });

  test('sends the same lanes whether history arrives in pages or at once', async () => {
    const branchy = await TempRepo.create();
    try {
      await branchy.commitFiles('base', { 'a.txt': '0\n' });
      for (const name of ['one', 'two']) {
        await branchy.git('switch', '--quiet', '-c', name, 'main');
        await branchy.commitFiles(`${name} work`, { [`${name}.txt`]: '1\n' });
      }
      await branchy.git('switch', '--quiet', 'main');
      await branchy.commitFiles('main work', { 'a.txt': '1\n' });
      branchy.tick();
      await branchy.git('merge', '--quiet', '--no-ff', '-m', 'merge one', 'one');
      const repository = new GitRepository(branchy.root, new GitRunner({ env: branchy.env }));

      const whole = new GraphController({ pageSize: () => 100, commitOrder: () => 'date' });
      await whole.setRepository(repository);
      const paged = new GraphController({ pageSize: () => 2, commitOrder: () => 'date' });
      await paged.setRepository(repository);
      while (paged.loadedRows.length < whole.loadedRows.length) {
        const before = paged.loadedRows.length;
        await paged.loadMore(paged.currentGeneration);
        assert.ok(paged.loadedRows.length > before, 'each page adds rows');
      }
      assert.deepStrictEqual(
        paged.loadedRows.map((r) => r.graph),
        whole.loadedRows.map((r) => r.graph),
      );
      const merge = whole.loadedRows.find((r) => r.subject === 'merge one');
      assert.strictEqual(merge?.graph.edges.filter((e) => e.kind === 'out').length, 2);
      whole.dispose();
      paged.dispose();
    } finally {
      await branchy.dispose();
    }
  });

  test('reports searching, missing and empty repositories', async () => {
    const controller = new GraphController(settings);
    const sink = new RecordingSink();
    controller.attach(sink);
    await controller.setRepository(undefined, true);
    assert.strictEqual(sink.lastReset()?.status.kind, 'searching');
    await controller.setRepository(undefined, false);
    assert.strictEqual(sink.lastReset()?.status.kind, 'noRepository');

    const empty = await TempRepo.create();
    try {
      await controller.setRepository(new GitRepository(empty.root, new GitRunner({ env: empty.env })));
      assert.strictEqual(sink.lastReset()?.status.kind, 'empty');
    } finally {
      controller.dispose();
      await empty.dispose();
    }
  });

  test('reports git errors', async () => {
    const controller = new GraphController(settings);
    const sink = new RecordingSink();
    controller.attach(sink);
    await controller.setRepository(new GitRepository(`${repo.root}-missing`, new GitRunner()));
    const reset = sink.lastReset();
    assert.strictEqual(reset?.status.kind, 'error');
    controller.dispose();
  });
});
