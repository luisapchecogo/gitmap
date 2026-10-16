// Messages between the extension host and the graph webview. Shared by both
// sides: no Node or vscode imports.

import { RowShape } from './graphGeometry';

export interface RefBadge {
  name: string;
  kind: 'head' | 'remote' | 'tag';
  /** The checked-out branch. */
  current: boolean;
}

export interface CommitRow {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  authorName: string;
  authorEmail: string;
  /** Seconds since the epoch. */
  authorDate: number;
  parents: string[];
  refs: RefBadge[];
  /** HEAD points at this commit. */
  head: boolean;
  /** This row's part of the branch graph. */
  graph: RowShape;
}

/** What the graph is showing, for the status line and empty states. */
export type GraphStatus =
  | { kind: 'searching' }
  | { kind: 'noRepository' }
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

/** Host → webview. */
export type HostMessage =
  | {
      type: 'reset';
      /** Increments on every (re)load; replies about older loads are ignored. */
      generation: number;
      status: GraphStatus;
      rows: CommitRow[];
      hasMore: boolean;
      /** Total commits in the current filter, once counted. */
      total?: number;
    }
  | { type: 'append'; generation: number; rows: CommitRow[]; hasMore: boolean }
  | { type: 'total'; generation: number; total: number };

/** Webview → host. */
export type WebviewMessage = { type: 'ready' } | { type: 'loadMore'; generation: number };
