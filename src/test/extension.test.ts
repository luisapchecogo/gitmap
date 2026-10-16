import * as assert from 'assert';
import * as vscode from 'vscode';

suite('GitMap extension', () => {
  test('activates', async () => {
    const extension = vscode.extensions.getExtension('luispacheco.gitmap');
    assert.ok(extension, 'extension should be loaded in the test instance');

    await extension.activate();
    assert.strictEqual(extension.isActive, true);
  });

  test('registers every contributed command', async () => {
    const extension = vscode.extensions.getExtension('luispacheco.gitmap');
    await extension?.activate();
    const contributed = (extension?.packageJSON as { contributes: { commands: { command: string }[] } }).contributes.commands.map(
      (entry) => entry.command,
    );
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = contributed.filter((command) => !registered.has(command));
    assert.deepStrictEqual(missing, []);
  });
});
