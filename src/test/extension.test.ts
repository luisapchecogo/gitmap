import * as assert from 'assert';
import * as vscode from 'vscode';

suite('GitMap extension', () => {
  test('activates', async () => {
    const extension = vscode.extensions.getExtension('luispacheco.gitmap');
    assert.ok(extension, 'extension should be loaded in the test instance');

    await extension.activate();
    assert.strictEqual(extension.isActive, true);
  });
});
