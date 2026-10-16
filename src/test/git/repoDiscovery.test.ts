import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import { GitRunner } from '../../core/gitRunner';
import { findRepositoryRoot } from '../../git/repoDiscovery';
import { GitRepository } from '../../git/repository';
import { TempRepo } from '../helpers/tempRepo';

suite('Repository discovery', () => {
  let repo: TempRepo;
  let runner: GitRunner;

  suiteSetup(async () => {
    repo = await TempRepo.create();
    await repo.commitFiles('initial', { 'src/deep/file.txt': 'x\n' });
    runner = new GitRunner({ env: repo.env });
  });

  suiteTeardown(async () => {
    await repo.dispose();
  });

  test('finds the root from a nested folder', async () => {
    const root = await findRepositoryRoot(runner, path.join(repo.root, 'src', 'deep'));
    assert.strictEqual(root, repo.root);
  });

  test('returns undefined outside a repository', async () => {
    const outside = path.join(repo.dir, 'not-a-repo');
    await fs.mkdir(outside, { recursive: true });
    assert.strictEqual(await findRepositoryRoot(runner, outside), undefined);
  });

  test('returns undefined for a missing folder', async () => {
    assert.strictEqual(await findRepositoryRoot(runner, path.join(repo.dir, 'missing')), undefined);
  });
});

suite('GitRepository', () => {
  let repo: TempRepo;
  let git: GitRepository;
  let first: string;
  let second: string;

  suiteSetup(async () => {
    repo = await TempRepo.create();
    first = await repo.commitFiles('first', { 'a.txt': '1\n' });
    second = await repo.commitFiles('second', { 'a.txt': '2\n' });
    await repo.git('tag', '-a', 'v1', '-m', 'release', first);
    git = new GitRepository(repo.root, new GitRunner({ env: repo.env }));
  });

  suiteTeardown(async () => {
    await repo.dispose();
  });

  test('resolves branches, relative revisions and annotated tags to commits', async () => {
    assert.strictEqual(await git.resolveCommit('main'), second);
    assert.strictEqual(await git.resolveCommit('HEAD~1'), first);
    assert.strictEqual(await git.resolveCommit('v1'), first);
    assert.strictEqual(await git.resolveCommit(first.slice(0, 7)), first);
  });

  test('returns undefined for unknown or option-like revisions', async () => {
    assert.strictEqual(await git.resolveCommit('nope'), undefined);
    assert.strictEqual(await git.resolveCommit('--all'), undefined);
    assert.strictEqual(await git.resolveCommit(''), undefined);
  });
});
