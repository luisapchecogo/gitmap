import * as assert from 'assert';
import { GitRunner } from '../../core/gitRunner';
import { GraphController, GraphSettings } from '../../graph/graphController';
import { GraphFilter } from '../../core/refsParser';
import { GitRepository } from '../../git/repository';
import { HostMessage } from '../../shared/protocol';
import { RecordingSink } from '../helpers/sink';
import { TempRepo } from '../helpers/tempRepo';

suite('GraphController', () => {
  let repo: TempRepo;
  let git: GitRepository;
  const settings = makeSettings(3);

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
    assert.deepStrictEqual(
      sink.messages.map((m) => m.type),
      ['toolbar', 'reset'],
    );
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

    const lastReady = sink.messages
      .filter((m): m is Extract<HostMessage, { type: 'reset' }> => m.type === 'reset' && m.status.kind === 'ready')
      .pop();
    assert.strictEqual(lastReady?.generation, current);
    const afterIndex = lastReady ? sink.messages.indexOf(lastReady) : -1;
    assert.ok(
      sink.messages.slice(afterIndex).every((m) => !('generation' in m) || m.generation === current),
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

      const whole = new GraphController(makeSettings(100));
      await whole.setRepository(repository);
      const paged = new GraphController(makeSettings(2));
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

  test('applies the saved branch and remote filters', async () => {
    const filtered = await TempRepo.create();
    try {
      await filtered.commitFiles('base', { 'a.txt': '0\n' });
      await filtered.git('switch', '--quiet', '-c', 'topic');
      await filtered.commitFiles('topic work', { 't.txt': '1\n' });
      await filtered.git('switch', '--quiet', 'main');
      await filtered.commitFiles('main work', { 'a.txt': '1\n' });
      await filtered.git('update-ref', 'refs/remotes/origin/topic', 'topic~1');
      await filtered.git('switch', '--quiet', '-c', 'remote-only');
      await filtered.commitFiles('remote work', { 'r.txt': '1\n' });
      await filtered.git('switch', '--quiet', 'main');
      await filtered.git('update-ref', 'refs/remotes/origin/feature', 'remote-only');
      await filtered.git('branch', '-D', 'remote-only');
      const repository = new GitRepository(filtered.root, new GitRunner({ env: filtered.env }));
      const subjects = (controller: GraphController) => controller.loadedRows.map((r) => r.subject).sort();

      const all = new GraphController(makeSettings(50));
      await all.setRepository(repository);
      assert.deepStrictEqual(subjects(all), ['base', 'main work', 'remote work', 'topic work']);
      assert.deepStrictEqual(all.loadedRows.find((r) => r.subject === 'base')?.refs, [
        { name: 'origin/topic', kind: 'remote', current: false, remote: 'origin' },
      ]);

      const noRemotes = new GraphController(makeSettings(50, { showRemotes: false }));
      await noRemotes.setRepository(repository);
      assert.deepStrictEqual(subjects(noRemotes), ['base', 'main work', 'topic work']);

      const sink = new RecordingSink();
      const topic = new GraphController(makeSettings(50, { branch: 'refs/heads/topic', showRemotes: true }));
      topic.attach(sink);
      await topic.setRepository(repository);
      assert.deepStrictEqual(subjects(topic), ['base', 'topic work']);
      const toolbar = sink.messages.filter((m) => m.type === 'toolbar').pop();
      assert.deepStrictEqual(toolbar?.type === 'toolbar' && [toolbar.toolbar.branchLabel, toolbar.toolbar.branchFiltered], [
        'topic',
        true,
      ]);

      const deleted = new GraphController(makeSettings(50, { branch: 'refs/heads/gone', showRemotes: true }));
      await deleted.setRepository(repository);
      assert.deepStrictEqual(subjects(deleted), subjects(all), 'a deleted branch falls back to all branches');
      assert.strictEqual(deleted.currentFilter.branch, undefined);

      for (const controller of [all, noRemotes, topic, deleted]) {
        controller.dispose();
      }
    } finally {
      await filtered.dispose();
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

  test('reloads only when refs or HEAD changed', async () => {
    const moving = await TempRepo.create();
    try {
      await moving.commitFiles('one', { 'a.txt': '1\n' });
      const controller = new GraphController(settings);
      await controller.setRepository(new GitRepository(moving.root, new GitRunner({ env: moving.env })));
      const generation = controller.currentGeneration;
      assert.strictEqual(await controller.reloadIfChanged(), false);
      assert.strictEqual(controller.currentGeneration, generation);

      await moving.commitFiles('two', { 'a.txt': '2\n' });
      assert.strictEqual(await controller.reloadIfChanged(), true);
      assert.strictEqual(controller.loadedRows[0].subject, 'two');

      await moving.git('switch', '--quiet', '-c', 'other');
      assert.strictEqual(await controller.reloadIfChanged(), true, 'switching branches changes HEAD');
      controller.dispose();
    } finally {
      await moving.dispose();
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

function makeSettings(pageSize: number, filter: GraphFilter = { showRemotes: true }): GraphSettings {
  return {
    pageSize: () => pageSize,
    commitOrder: () => 'date',
    filter: () => filter,
    repositoryCount: () => 1,
  };
}
