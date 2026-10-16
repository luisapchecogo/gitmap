import * as assert from 'assert';
import * as vscode from 'vscode';
import { fromGitUri, toGitUri } from '../../compare/gitUri';
import { TempRepo } from '../helpers/tempRepo';

const NULL_OID = '0'.repeat(40);

suite('gitmap: URIs', () => {
  test('round-trip through a string, including unusual paths', () => {
    for (const path of ['src/a.ts', 'dir with space/#hash%percent?.md', 'ünï/文件 🎉.txt']) {
      const ref = { repo: '/tmp/some repo#1', path, oid: 'ab'.repeat(20), mode: '100644', ref: 'feature/x' };
      const parsed = fromGitUri(vscode.Uri.parse(toGitUri(ref).toString()));
      assert.deepStrictEqual(parsed, ref);
    }
  });
});

suite('gitmap: file system', () => {
  let repo: TempRepo;
  const binary = Uint8Array.from({ length: 512 }, (_, i) => (i * 7) % 256);

  suiteSetup(async () => {
    repo = await TempRepo.create();
    await repo.commitFiles('files', { 'bin/data.bin': binary, 'text.txt': 'héllo\n' });
  });

  suiteTeardown(async () => {
    await repo.dispose();
  });

  function uriFor(path: string, oid: string, mode = '100644'): vscode.Uri {
    return toGitUri({ repo: repo.root, path, oid, mode, ref: 'HEAD' });
  }

  test('reads binary blobs byte for byte, with an exact size', async () => {
    const oid = await repo.git('rev-parse', 'HEAD:bin/data.bin');
    const uri = uriFor('bin/data.bin', oid);
    const stat = await vscode.workspace.fs.stat(uri);
    assert.strictEqual(stat.size, binary.byteLength);
    assert.strictEqual(stat.type, vscode.FileType.File);
    const data = await vscode.workspace.fs.readFile(uri);
    assert.deepStrictEqual(Array.from(data), Array.from(binary));
  });

  test('reads a missing side as an empty file', async () => {
    const uri = uriFor('gone.txt', NULL_OID);
    assert.strictEqual((await vscode.workspace.fs.readFile(uri)).byteLength, 0);
    assert.strictEqual((await vscode.workspace.fs.stat(uri)).size, 0);
  });

  test('shows a submodule as the commit it points to', async () => {
    const commit = await repo.git('rev-parse', 'HEAD');
    const data = await vscode.workspace.fs.readFile(uriFor('vendor/lib', commit, '160000'));
    assert.strictEqual(new TextDecoder().decode(data), `Subproject commit ${commit}\n`);
  });

  test('reports unknown objects as not found', async () => {
    await assert.rejects(
      Promise.resolve(vscode.workspace.fs.readFile(uriFor('x.txt', 'f'.repeat(40)))),
      (error: unknown) => error instanceof vscode.FileSystemError && error.code === 'FileNotFound',
    );
  });

  test('is read-only', async () => {
    const oid = await repo.git('rev-parse', 'HEAD:text.txt');
    await assert.rejects(Promise.resolve(vscode.workspace.fs.writeFile(uriFor('text.txt', oid), new Uint8Array([1]))));
  });
});
