import * as assert from 'assert';
import { GitRunner } from '../../core/gitRunner';
import { selectTips } from '../../core/refsParser';
import { GitRepository } from '../../git/repository';
import { TempRepo } from '../helpers/tempRepo';

suite('GitRepository.getLog', () => {
  let repo: TempRepo;
  let git: GitRepository;
  const subjects = (commits: { subject: string }[]) => commits.map((c) => c.subject);

  async function allTips(showRemotes = true): Promise<string[]> {
    const [refs, head] = await Promise.all([git.getRefs(), git.getHead()]);
    return selectTips(refs, head.commit, { showRemotes });
  }

  suiteSetup(async () => {
    repo = await TempRepo.create();
    await repo.commitFiles('m1', { 'a.txt': '1\n' });
    await repo.git('switch', '--quiet', '-c', 'topic');
    await repo.commitFiles('t1', { 'b.txt': '1\n' });
    await repo.git('switch', '--quiet', 'main');
    await repo.commitFiles('m2', { 'a.txt': '2\n' });
    await repo.git('switch', '--quiet', 'topic');
    await repo.commitFiles('t2', { 'b.txt': '2\n' });
    await repo.git('switch', '--quiet', 'main');
    repo.tick();
    await repo.git('merge', '--quiet', '--no-ff', '-m', 'merge topic', 'topic');
    await repo.commitFiles('m3 ünïcødé 🎉', { 'a.txt': '3\n' });
    // A remote-only commit.
    await repo.git('switch', '--quiet', '-c', 'tmp');
    const remoteOnly = await repo.commitFiles('r1', { 'r.txt': 'r\n' });
    await repo.git('switch', '--quiet', 'main');
    await repo.git('branch', '-D', 'tmp');
    await repo.git('update-ref', 'refs/remotes/origin/feature', remoteOnly);
    git = new GitRepository(repo.root, new GitRunner({ env: repo.env }));
  });

  suiteTeardown(async () => {
    await repo.dispose();
  });

  test('lists every branch newest first in date order', async () => {
    const commits = await git.getLog({ tips: await allTips(), order: 'date', skip: 0, maxCount: 100 });
    assert.deepStrictEqual(subjects(commits), ['r1', 'm3 ünïcødé 🎉', 'merge topic', 't2', 'm2', 't1', 'm1']);
    const merge = commits[2];
    assert.strictEqual(merge.parents.length, 2);
    assert.strictEqual(merge.authorName, 'GitMap Test');
  });

  test('topo order keeps branch commits together', async () => {
    const commits = await git.getLog({ tips: await allTips(false), order: 'topo', skip: 0, maxCount: 100 });
    const order = subjects(commits);
    // Date order puts m2 between t2 and t1; topo order must not.
    assert.strictEqual(order.indexOf('t1'), order.indexOf('t2') + 1, `topic commits interleaved: ${order.join(', ')}`);
  });

  test('pages concatenate to the whole history', async () => {
    const tips = await allTips();
    const whole = await git.getLog({ tips, order: 'date', skip: 0, maxCount: 100 });
    const pages = [];
    for (let skip = 0; skip < whole.length; skip += 3) {
      pages.push(...(await git.getLog({ tips, order: 'date', skip, maxCount: 3 })));
    }
    assert.deepStrictEqual(
      pages.map((c) => c.hash),
      whole.map((c) => c.hash),
    );
    assert.strictEqual(await git.countCommits(tips), whole.length);
  });

  test('shows commits only reachable from a detached HEAD', async () => {
    await repo.git('switch', '--quiet', '--detach', 'main');
    try {
      await repo.commitFiles('detached work', { 'd.txt': 'd\n' });
      const commits = await git.getLog({ tips: await allTips(), order: 'date', skip: 0, maxCount: 1 });
      assert.deepStrictEqual(subjects(commits), ['detached work']);
    } finally {
      await repo.git('switch', '--quiet', 'main');
    }
  });
});
