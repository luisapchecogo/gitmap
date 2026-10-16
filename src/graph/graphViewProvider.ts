import * as vscode from 'vscode';
import { HostMessage, WebviewMessage } from '../shared/protocol';
import { GraphController, GraphSink } from './graphController';
import { renderGraphHtml } from './html';

export const GRAPH_VIEW_ID = 'gitmap.graph';

/**
 * Hosts the graph webview in the GitMap side bar. All state lives in the
 * GraphController; this class only connects a webview to it.
 */
export class GraphViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: GraphController,
  ) {}

  get visible(): boolean {
    return this.view?.visible ?? false;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const webview = view.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    webview.html = renderGraphHtml(webview, this.extensionUri);

    const sink: GraphSink = {
      post: (message: HostMessage) => {
        void webview.postMessage(message);
      },
    };
    const subscriptions = [
      webview.onDidReceiveMessage((message: WebviewMessage) => this.handle(message, sink)),
      view.onDidDispose(() => {
        this.controller.detach(sink);
        if (this.view === view) {
          this.view = undefined;
        }
        vscode.Disposable.from(...subscriptions).dispose();
      }),
    ];
  }

  private handle(message: WebviewMessage, sink: GraphSink): void {
    switch (message.type) {
      case 'ready':
        // A new or reloaded webview: replay everything loaded so far.
        this.controller.attach(sink);
        break;
      case 'loadMore':
        void this.controller.loadMore(message.generation);
        break;
    }
  }
}
