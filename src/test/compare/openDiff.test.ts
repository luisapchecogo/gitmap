import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { CompareResult } from '../../compare/compareState';
import { fromGitUri, GIT_SCHEME } from '../../compare/gitUri';
import { changeUris, diffTitle } from '../../compare/openDiff';
import { FileChange } from '../../core/diffParser';
import { GitRunner } from '../../core/gitRunner';
import { commitRevision, WORKING_TREE } from '../../core/revision';
import { GitRepository } from '../../git/repository';
import { TempRepo } from '../helpers/tempRepo';

suite('Diff URIs', () => {
  let repo: TempRepo;
  let git: GitRepository;
  let first: string;
  let second: string;

  suiteSetup(async () => {
    repo = await TempRepo.create();
    first = await repo.commitFiles('first', {
      'a.txt': 'one\n',
      'gone.txt': 'bye\n',
      'old.txt': 'a line long enough to keep the rename similar\n'.repeat(4),
    });
    await repo.remove('gone.txt');
    await repo.remove('old.txt');
    second = await repo.commitFiles('second', {
      'a.txt': 'two\n',
      'new.txt': 'a line long enough to keep the rename similar\n'.repeat(4),
      'added.txt': 'hi\n',
    });
    git = new GitRepository(repo.root, new GitRunner({ env: repo.env }));
  });

  suiteTeardown(async () => {
    await repo.dispose();
  });

  async function compare(target = commitRevision(second, 'second')): Promise<CompareResult> {
    const selection = { base: commitRevision(first, 'first'), target, mode: 'direct' as const };
    const outcome = await git.getChanges(selection);
    return { repository: git, selection, ...outcome, leftLabel: 'first', rightLabel: target.kind === 'commit' ? 'second' : 'Working Tree' };
  }

  function byPath(result: CompareResult, file: string): FileChange {
    const change = result.changes.find((c) => c.path === file);
    assert.ok(change, `${file} should be in the comparison`);
    return change;
  }

  test('both sides of a commit comparison read blobs by id', async () => {
    const result = await compare();
    const uris = changeUris(result, byPath(result, 'a.txt'));
    assert.strictEqual(uris.left?.scheme, GIT_SCHEME);
    assert.strictEqual(uris.right?.scheme, GIT_SCHEME);
    const right = uris.right ? fromGitUri(uris.right) : undefined;
    assert.strictEqual(right?.oid, await repo.git('rev-parse', `${second}:a.txt`));
    assert.strictEqual(new TextDecoder().decode(await vscode.workspace.fs.readFile(uris.right!)), 'two\n');
    assert.strictEqual(new TextDecoder().decode(await vscode.workspace.fs.readFile(uris.left!)), 'one\n');
  });

  test('renames read the old path on the left', async () => {
    const result = await compare();
    const change = byPath(result, 'new.txt');
    const uris = changeUris(result, change);
    assert.strictEqual(uris.left?.path, '/old.txt');
    assert.strictEqual(uris.right?.path, '/new.txt');
    assert.strictEqual(diffTitle(result, change), 'old.txt (first) ↔ new.txt (second)');
  });

  test('added and deleted files have one side', async () => {
    const result = await compare();
    const added = changeUris(result, byPath(result, 'added.txt'));
    assert.strictEqual(added.left, undefined);
    assert.ok(added.right);
    const deleted = changeUris(result, byPath(result, 'gone.txt'));
    assert.ok(deleted.left);
    assert.strictEqual(deleted.right, undefined);
  });

  test('the working tree side is the editable file on disk', async () => {
    const result = await compare(WORKING_TREE);
    const uris = changeUris(result, byPath(result, 'a.txt'));
    assert.strictEqual(uris.right?.scheme, 'file');
    assert.strictEqual(uris.right?.fsPath, path.join(repo.root, 'a.txt'));
  });
});
