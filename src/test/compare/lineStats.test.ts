import * as assert from 'assert';
import { lineStatsText } from '../../compare/changesTreeProvider';
import { GitRunner } from '../../core/gitRunner';
import { commitRevision, WORKING_TREE } from '../../core/revision';
import type { GitMapTestApi } from '../../extension';
import { GitRepository } from '../../git/repository';
import { activateGitMap } from '../helpers/extension';
import { TempRepo } from '../helpers/tempRepo';

suite('Line counts', () => {
  let repo: TempRepo;
  let git: GitRepository;
  let api: GitMapTestApi;
  let first: string;
  let second: string;

  suiteSetup(async () => {
    api = await activateGitMap();
    repo = await TempRepo.create();
    first = await repo.commitFiles('first', {
      'a.txt': 'one\ntwo\nthree\n',
      'image.bin': Uint8Array.from([0, 1, 2, 0, 3]),
      'old.txt': 'a line long enough to keep the rename similar\n'.repeat(4),
    });
    await repo.remove('old.txt');
    second = await repo.commitFiles('second', {
      'a.txt': 'one\n2\nthree\nfour\n',
      'image.bin': Uint8Array.from([0, 9, 9, 0]),
      'new.txt': 'a line long enough to keep the rename similar\n'.repeat(4) + 'extra\n',
    });
    git = new GitRepository(repo.root, new GitRunner());
  });

  suiteTeardown(async () => {
    api.compareService.clear();
    await repo.dispose();
  });

  test('are loaded after the file list, including renames and binaries', async () => {
    await api.compareService.compare(git, { base: commitRevision(first), target: commitRevision(second), mode: 'direct' });
    await api.compareService.lineStatsLoaded;
    const byPath = new Map(api.compareService.current?.changes.map((c) => [c.path, lineStatsText(c)]));
    assert.strictEqual(byPath.get('a.txt'), '+2 −1');
    assert.strictEqual(byPath.get('new.txt'), '+1 −0');
    assert.strictEqual(byPath.get('image.bin'), 'binary');
  });

  test('cover working tree changes', async () => {
    await repo.write('a.txt', 'one\n');
    try {
      await api.compareService.compare(git, { base: commitRevision(second), target: WORKING_TREE, mode: 'direct' });
      await api.compareService.lineStatsLoaded;
      const change = api.compareService.current?.changes.find((c) => c.path === 'a.txt');
      assert.strictEqual(change && lineStatsText(change), '+0 −3');
    } finally {
      await repo.git('checkout', '--', 'a.txt');
    }
  });
});
