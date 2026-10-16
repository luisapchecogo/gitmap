import * as vscode from 'vscode';
import { Revision } from '../core/revision';

export type CompareMode = 'direct' | 'mergeBase';

/** What GitMap remembers per repository, across window reloads. */
export interface RepoSettings {
  base?: Revision;
  target?: Revision;
  mode?: CompareMode;
}

const KEY = 'gitmap.repositories';

/** Per-repository settings stored in the workspace state. */
export class WorkspaceStore {
  constructor(private readonly memento: vscode.Memento) {}

  get(root: string): RepoSettings {
    return this.all()[root] ?? {};
  }

  async update(root: string, patch: RepoSettings): Promise<void> {
    const all = this.all();
    all[root] = { ...all[root], ...patch };
    await this.memento.update(KEY, all);
  }

  private all(): Record<string, RepoSettings> {
    return { ...this.memento.get<Record<string, RepoSettings>>(KEY, {}) };
  }
}
