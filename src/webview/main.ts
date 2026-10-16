// Entry point of the graph webview. The extension host owns all state;
// this script only renders what it is sent and reports user input.

const vscode = acquireVsCodeApi();

vscode.postMessage({ type: 'ready' });
