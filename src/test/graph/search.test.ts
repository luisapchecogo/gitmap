import * as assert from 'assert';
import { GitRunner } from '../../core/gitRunner';
import { selectTips } from '../../core/refsParser';
import { GraphController } from '../../graph/graphController';
import { GitRepository } from '../../git/repository';
import { RecordingSink } from '../helpers/sink';
import { TempRepo } from '../helpers/tempRepo';

suite('Commit search', () => {
  let repo: TempRepo;
  let git: GitRepository;
  let tips: string[];
  const hashes: string[] = [];

  suiteSetup(async () => {
    repo = await TempRepo.create();
    for (let i = 1; i <= 12; i++) {
      hashes.push(await repo.commitFiles(i === 3 ? 'Fix(parser): handle [brackets]' : `chore: step ${i}`, { 'a.txt': `${i}\n` }));
    }
    await repo.git('-c', 'user.name=Ada Lovelace', '-c', 'user.email=ada@example.com', 'commit', '--quiet', '--allow-empty', '-m', 'by ada');
    hashes.push(await repo.git('rev-parse', 'HEAD'));
    git = new GitRepository(repo.root, new GitRunner({ env: repo.env }));
    const [refs, head] = await Promise.all([git.getRefs(), git.getHead()]);
    tips = selectTips(refs, head.commit, { showRemotes: true });
  });

  suiteTeardown(async () => {
    await repo.dispose();
  });

  test('finds commits by full and short hash', async () => {
    assert.deepStrictEqual((await git.searchCommits(hashes[4], tips, 200)).hashes, [hashes[4]]);
    assert.deepStrictEqual((await git.searchCommits(hashes[4].slice(0, 8), tips, 200)).hashes, [hashes[4]]);
  });

  test('finds words in messages, ignoring case and treating the query literally', async () => {
    assert.deepStrictEqual((await git.searchCommits('fix(PARSER', tips, 200)).hashes, [hashes[2]]);
    assert.deepStrictEqual((await git.searchCommits('[brackets]', tips, 200)).hashes, [hashes[2]]);
  });

  test('finds commits by author', async () => {
    assert.deepStrictEqual((await git.searchCommits('lovelace', tips, 200)).hashes, [hashes[12]]);
  });

  test('returns matches newest first and reports truncation', async () => {
    const result = await git.searchCommits('step', tips, 5);
    assert.strictEqual(result.hashes.length, 5);
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.hashes[0], hashes[11]);
  });

  test('returns nothing for no match or an empty query', async () => {
    assert.deepStrictEqual(await git.searchCommits('zebra', tips, 200), { hashes: [], truncated: false });
    assert.deepStrictEqual(await git.searchCommits('   ', tips, 200), { hashes: [], truncated: false });
  });

  test('reveal pages forward to a match beyond the first page', async () => {
    const controller = new GraphController({
      pageSize: () => 3,
      commitOrder: () => 'date',
      filter: () => ({ showRemotes: true }),
      repositoryCount: () => 1,
    });
    const sink = new RecordingSink();
    controller.attach(sink);
    await controller.setRepository(git);
    await controller.search('brackets');
    const results = sink.messages.find((m) => m.type === 'searchResults');
    assert.deepStrictEqual(results?.type === 'searchResults' && results.matches, [hashes[2]]);

    assert.strictEqual(controller.loadedRows.length, 3);
    await controller.reveal(hashes[2]);
    assert.ok(controller.loadedRows.some((row) => row.hash === hashes[2]));
    const reveal = sink.messages.find((m) => m.type === 'reveal');
    assert.deepStrictEqual(reveal, { type: 'reveal', hash: hashes[2], found: true });

    await controller.reveal('f'.repeat(40));
    const missing = sink.messages.filter((m) => m.type === 'reveal').pop();
    assert.strictEqual(missing?.type === 'reveal' && missing.found, false);
    controller.dispose();
  });
});
