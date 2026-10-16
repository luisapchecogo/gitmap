/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See THIRD_PARTY_NOTICES.md in the project root.
 *--------------------------------------------------------------------------------------------*/

// Subset of the built-in Git extension's public API (vscode.git, version 1),
// from microsoft/vscode extensions/git/src/api/git.d.ts, trimmed to the
// members GitMap uses. Import it with `import type` only: the extension may
// be missing or disabled at runtime.

import type { Event, Uri } from 'vscode';

export interface Git {
  readonly path: string;
}

export interface Ref {
  readonly name?: string;
  readonly commit?: string;
  readonly remote?: string;
}

export interface Branch extends Ref {
  readonly upstream?: { readonly remote: string; readonly name: string };
  readonly ahead?: number;
  readonly behind?: number;
}

export interface RepositoryState {
  readonly HEAD: Branch | undefined;
  readonly onDidChange: Event<void>;
}

export interface Repository {
  readonly rootUri: Uri;
  readonly state: RepositoryState;
}

export type APIState = 'uninitialized' | 'initialized';

export interface API {
  readonly state: APIState;
  readonly onDidChangeState: Event<APIState>;
  readonly git: Git;
  readonly repositories: Repository[];
  readonly onDidOpenRepository: Event<Repository>;
  readonly onDidCloseRepository: Event<Repository>;
  getRepository(uri: Uri): Repository | null;
}

export interface GitExtension {
  readonly enabled: boolean;
  readonly onDidChangeEnablement: Event<boolean>;
  getAPI(version: 1): API;
}
