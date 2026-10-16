import * as vscode from 'vscode';
import { FooterAction, HostMessage, ToolbarCommand, WebviewMessage } from '../shared/protocol';
import { CompareFooter } from './compareFooter';
import { GraphController, GraphSink } from './graphController';
import { renderGraphHtml } from './html';

export const GRAPH_VIEW_ID = 'gitmap.graph';

/** Commands the webview may run; anything else it sends is ignored. */
const TOOLBAR_COMMANDS: ReadonlySet<ToolbarCommand> = new Set<ToolbarCommand>([
  'selectRepository',
  'selectBranch',
  'toggleRemoteBranches',
  'refresh',
]);

const FOOTER_ACTIONS: ReadonlySet<FooterAction> = new Set<FooterAction>(['pickBase', 'pickTarget', 'swap', 'toggleMode', 'compare']);

/**
 * Hosts the graph webview in the GitMap side bar. All state lives in the
 * GraphController; this class only connects a webview to it.
 */
export class GraphViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: GraphController,
    private readonly footer: CompareFooter,
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
    const postFooter = (): void => {
      void this.footer.state().then((compare) => sink.post({ type: 'compare', compare }));
    };
    const subscriptions = [
      webview.onDidReceiveMessage((message: WebviewMessage) => {
        if (message.type === 'ready') {
          postFooter();
        }
        this.handle(message, sink);
      }),
      this.footer.onDidChange(postFooter),
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
      case 'command':
        if (TOOLBAR_COMMANDS.has(message.command)) {
          void vscode.commands.executeCommand(`gitmap.${message.command}`);
        }
        break;
      case 'footer':
        if (FOOTER_ACTIONS.has(message.action)) {
          void this.footer.run(message.action);
        }
        break;
      case 'openCommit':
        void vscode.commands.executeCommand('gitmap.graph.showCommitChanges', { hash: message.hash });
        break;
      case 'search':
        void this.controller.search(String(message.query));
        break;
      case 'reveal':
        void this.controller.reveal(String(message.hash));
        break;
    }
  }
}
