import * as assert from 'assert';
import { GitRunner } from '../../core/gitRunner';
import { GitRepository } from '../../git/repository';
import { TempRepo } from '../helpers/tempRepo';

suite('GitRepository refs', () => {
  let repo: TempRepo;
  let git: GitRepository;
  let first: string;
  let second: string;

  suiteSetup(async () => {
    repo = await TempRepo.create();
    first = await repo.commitFiles('first', { 'a.txt': '1\n' });
    second = await repo.commitFiles('second', { 'a.txt': '2\n' });
    await repo.git('branch', 'topic', first);
    // A fake remote: remote-tracking refs plus the origin/HEAD symref.
    await repo.git('update-ref', 'refs/remotes/origin/main', first);
    await repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    await repo.git('remote', 'add', 'origin', 'https://example.invalid/repo.git');
    await repo.git('config', 'branch.main.remote', 'origin');
    await repo.git('config', 'branch.main.merge', 'refs/heads/main');
    await repo.git('tag', 'light', second);
    await repo.git('tag', '-a', 'v1.0', '-m', 'release', first);
    git = new GitRepository(repo.root, new GitRunner({ env: repo.env }));
  });

  suiteTeardown(async () => {
    await repo.dispose();
  });

  test('lists branches, remote branches and peeled tags', async () => {
    const refs = await git.getRefs();
    assert.deepStrictEqual(
      refs.map((r) => [r.kind, r.name, r.commit === first ? 'first' : 'second']),
      [
        ['head', 'main', 'second'],
        ['head', 'topic', 'first'],
        ['remote', 'origin/main', 'first'],
        ['tag', 'light', 'second'],
        ['tag', 'v1.0', 'first'],
      ],
    );
    const main = refs.find((r) => r.name === 'main');
    assert.strictEqual(main?.isHead, true);
    assert.strictEqual(main?.upstream, 'origin/main');
  });

  test('reports the current branch and a detached HEAD', async () => {
    assert.deepStrictEqual(await git.getHead(), { commit: second, branch: 'main' });
    await repo.git('switch', '--quiet', '--detach', first);
    try {
      assert.deepStrictEqual(await git.getHead(), { commit: first, branch: undefined });
      assert.ok((await git.getRefs()).every((r) => !r.isHead));
    } finally {
      await repo.git('switch', '--quiet', 'main');
    }
  });

  test('handles a repository with no commits', async () => {
    const empty = await TempRepo.create();
    try {
      const emptyGit = new GitRepository(empty.root, new GitRunner({ env: empty.env }));
      assert.deepStrictEqual(await emptyGit.getRefs(), []);
      assert.deepStrictEqual(await emptyGit.getHead(), { commit: undefined, branch: 'main' });
    } finally {
      await empty.dispose();
    }
  });
});
