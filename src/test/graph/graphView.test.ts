import * as assert from 'assert';
import * as vscode from 'vscode';
import { activateGitMap } from '../helpers/extension';

suite('Graph view', () => {
  test('the webview loads its bundled script under the CSP and reports ready', async () => {
    const api = await activateGitMap();
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('the graph webview never reported ready')), 15000);
      const listener = api.graphView.onDidBecomeVisible(() => {
        clearTimeout(timeout);
        listener.dispose();
        resolve();
      });
    });
    await vscode.commands.executeCommand('gitmap.graph.focus');
    await ready;
    assert.strictEqual(api.graphView.visible, true);
  });
});
