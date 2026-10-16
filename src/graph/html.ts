import { randomBytes } from 'crypto';
import * as vscode from 'vscode';

/**
 * The graph webview's HTML shell. The Content Security Policy allows only
 * our own bundled script (by nonce), stylesheets and font: no inline
 * scripts or style attributes, no remote content. Commit messages are
 * attacker-controlled text, so this is a second line of defense behind
 * the webview building its DOM with textContent only.
 */
export function renderGraphHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(16).toString('base64');
  const asset = (file: string): string =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', file)).toString();
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${asset('codicon.css')}" id="vscode-codicon-stylesheet">
  <link rel="stylesheet" href="${asset('main.css')}">
  <title>GitMap Graph</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${asset('main.js')}"></script>
</body>
</html>`;
}
