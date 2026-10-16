import * as assert from 'assert';
import { GitCancelledError, GitError, GitRunner } from '../../core/gitRunner';
import { TempRepo } from '../helpers/tempRepo';

suite('GitRunner', () => {
  let repo: TempRepo;
  let runner: GitRunner;

  suiteSetup(async () => {
    repo = await TempRepo.create();
    await repo.commitFiles('initial', { 'a.txt': 'hello\n' });
    runner = new GitRunner({ env: repo.env });
  });

  suiteTeardown(async () => {
    await repo.dispose();
  });

  test('passes stdin to git', async () => {
    const oid = await runner.text(['hash-object', '--stdin'], { cwd: repo.root, stdin: 'hello\n' });
    const expected = await repo.git('rev-parse', 'HEAD:a.txt');
    assert.strictEqual(oid.trim(), expected);
  });

  test('rejects with GitError and stderr on failure', async () => {
    await assert.rejects(
      runner.exec(['rev-parse', '--verify', 'no-such-ref'], { cwd: repo.root }),
      (error: unknown) =>
        error instanceof GitError && error.exitCode === 128 && /no-such-ref|Needed a single revision/.test(error.stderr),
    );
  });

  test('accepts extra success exit codes', async () => {
    const result = await runner.exec(['rev-parse', '--verify', '--quiet', 'no-such-ref'], {
      cwd: repo.root,
      okExitCodes: [0, 1],
    });
    assert.strictEqual(result.exitCode, 1);
  });

  test('reports a missing git executable', async () => {
    const missing = new GitRunner({ gitPath: '/nonexistent/git' });
    await assert.rejects(
      missing.exec(['version'], { cwd: repo.root }),
      (error: unknown) => error instanceof GitError && /not found/.test(error.message),
    );
  });

  test('reports a missing working directory', async () => {
    await assert.rejects(
      runner.exec(['version'], { cwd: `${repo.root}-missing` }),
      (error: unknown) => error instanceof GitError && /does not exist/.test(error.message),
    );
  });

  test('aborting kills the process', async () => {
    const controller = new AbortController();
    // Abort right after spawning, before git can finish on its own.
    const pending = runner.exec(['log'], { cwd: repo.root, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, GitCancelledError);
  });

  test('rejects immediately when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      runner.exec(['version'], { cwd: repo.root, signal: controller.signal }),
      GitCancelledError,
    );
  });
});
