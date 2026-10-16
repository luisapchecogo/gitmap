// Entry point of the graph webview. The extension host owns all state;
// this script only renders what it is sent and reports user input.

import { formatCount } from '../shared/format';
import { GraphStatus, HostMessage, WebviewMessage } from '../shared/protocol';
import { CommitList } from './commitList';
import { h, icon } from './dom';
import { Footer } from './footer';
import { SearchBox } from './search';
import { Toolbar } from './toolbar';

const vscode = acquireVsCodeApi();
const post = (message: WebviewMessage): void => vscode.postMessage(message);

let generation = 0;
let loaded = 0;
let hasMore = false;
let total: number | undefined;
let status: GraphStatus = { kind: 'searching' };

const app = document.getElementById('app') as HTMLElement;
const toolbar = new Toolbar((command) => post({ type: 'command', command }));
const search = new SearchBox({
  search: (query) => post({ type: 'search', query }),
  reveal: (hash) => post({ type: 'reveal', hash }),
});
const statusLine = h('div', 'status');
statusLine.setAttribute('aria-live', 'polite');
const placeholder = h('div', 'placeholder');
const list = new CommitList(
  () => post({ type: 'loadMore', generation }),
  (hash) => post({ type: 'openCommit', hash }),
);
const footer = new Footer((action) => post({ type: 'footer', action }));
app.append(toolbar.element, search.element, statusLine, placeholder, list.element, footer.element);

// Ctrl/Cmd+F in the graph focuses the search box.
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    search.focus();
  }
});

function renderStatus(): void {
  placeholder.replaceChildren();
  placeholder.hidden = true;
  statusLine.replaceChildren();
  list.element.hidden = status.kind !== 'ready';

  const showPlaceholder = (iconName: string, text: string, spin = false): void => {
    placeholder.hidden = false;
    placeholder.append(icon(iconName, spin ? 'codicon-modifier-spin' : ''), h('span', undefined, ` ${text}`));
  };

  switch (status.kind) {
    case 'searching':
      showPlaceholder('loading', 'Looking for git repositories…', true);
      break;
    case 'noRepository':
      showPlaceholder('info', 'No git repository found in this workspace.');
      break;
    case 'loading':
      showPlaceholder('loading', 'Loading history…', true);
      break;
    case 'empty':
      showPlaceholder('info', 'No commits yet.');
      break;
    case 'error':
      showPlaceholder('error', status.message);
      break;
    case 'ready': {
      const noun = (count: number): string => (count === 1 ? 'commit' : 'commits');
      if (total !== undefined) {
        statusLine.textContent =
          loaded < total ? `Showing ${formatCount(loaded)} of ${formatCount(total)} commits` : `${formatCount(total)} ${noun(total)}`;
      } else {
        statusLine.textContent = hasMore ? `Showing ${formatCount(loaded)} commits…` : `${formatCount(loaded)} ${noun(loaded)}`;
      }
      break;
    }
  }
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'toolbar':
      toolbar.update(message.toolbar);
      break;
    case 'compare':
      footer.update(message.compare);
      list.setMarkers(message.compare.baseHash, message.compare.targetHash);
      break;
    case 'reset':
      generation = message.generation;
      status = message.status;
      loaded = message.rows.length;
      hasMore = message.hasMore;
      total = message.total;
      list.reset(message.rows, message.hasMore);
      renderStatus();
      break;
    case 'append':
      if (message.generation === generation) {
        loaded += message.rows.length;
        hasMore = message.hasMore;
        list.append(message.rows, message.hasMore);
        renderStatus();
      }
      break;
    case 'searchResults':
      search.showResults(message.query, message.matches, message.truncated, message.error);
      list.setMatches(search.matchSet);
      break;
    case 'reveal':
      if (!message.found || !list.reveal(message.hash)) {
        search.showMessage(message.message ?? 'This commit is not in the list.');
      }
      break;
    case 'total':
      if (message.generation === generation) {
        total = message.total;
        renderStatus();
      }
      break;
  }
});

setInterval(() => list.refreshDates(), 60_000);
renderStatus();
post({ type: 'ready' });
