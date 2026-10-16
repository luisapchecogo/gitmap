import * as path from 'path';
import * as vscode from 'vscode';
import { GITLINK_MODE, isNullOid } from '../core/diffParser';
import { GitError, GitRunner } from '../core/gitRunner';
import { LruCache } from '../core/lruCache';
import { fromGitUri, GitFileRef } from './gitUri';

/** Upper bound for cached blob contents. */
const CACHE_BYTES = 64 * 1024 * 1024;

/**
 * Read-only file system for `gitmap:` URIs: each URI names a blob by id,
 * so contents never change and can be cached freely.
 *
 * A FileSystemProvider (rather than a TextDocumentContentProvider) lets
 * the diff editor open images and other binary files. It is registered
 * first thing on activation and needs only the URI, so diff editors
 * restored after a reload work before repository discovery has finished.
 */
export class GitFileSystemProvider implements vscode.FileSystemProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changeEmitter.event;

  private readonly contents = new LruCache<string, Uint8Array>(CACHE_BYTES, (data) => data.byteLength);
  private readonly sizes = new LruCache<string, number>(10_000);

  constructor(private readonly runner: () => GitRunner) {}

  watch(): vscode.Disposable {
    // Blobs are immutable: there is nothing to watch.
    return new vscode.Disposable(() => undefined);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const ref = fromGitUri(uri);
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: await this.sizeOf(uri, ref),
      permissions: vscode.FilePermission.Readonly,
    };
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const ref = fromGitUri(uri);
    const special = specialContent(ref);
    if (special) {
      return special;
    }
    const key = cacheKey(ref);
    const cached = this.contents.get(key);
    if (cached) {
      return cached;
    }
    const result = await this.git(uri, ref, ['cat-file', 'blob', ref.oid]);
    const data = new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
    this.contents.set(key, data);
    this.sizes.set(key, data.byteLength);
    return data;
  }

  readDirectory(uri: vscode.Uri): never {
    throw vscode.FileSystemError.FileNotADirectory(uri);
  }

  createDirectory(uri: vscode.Uri): never {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  writeFile(uri: vscode.Uri): never {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  delete(uri: vscode.Uri): never {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  rename(uri: vscode.Uri): never {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  dispose(): void {
    this.changeEmitter.dispose();
    this.contents.clear();
  }

  private async sizeOf(uri: vscode.Uri, ref: GitFileRef): Promise<number> {
    const special = specialContent(ref);
    if (special) {
      return special.byteLength;
    }
    const key = cacheKey(ref);
    const known = this.sizes.get(key);
    if (known !== undefined) {
      return known;
    }
    const output = await this.git(uri, ref, ['cat-file', '-s', ref.oid]);
    const size = Number.parseInt(output.toString('utf8'), 10);
    this.sizes.set(key, size);
    return size;
  }

  private async git(uri: vscode.Uri, ref: GitFileRef, args: string[]): Promise<Buffer> {
    if (!path.isAbsolute(ref.repo)) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    try {
      const result = await this.runner().exec(args, { cwd: ref.repo });
      return result.stdout;
    } catch (error) {
      if (error instanceof GitError) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      throw error;
    }
  }
}

function cacheKey(ref: GitFileRef): string {
  return `${ref.repo}\0${ref.oid}`;
}

/**
 * Content that does not come from a blob: a missing side reads as an empty
 * file, and a submodule shows the commit it points to (as `git diff` does).
 */
function specialContent(ref: GitFileRef): Uint8Array | undefined {
  if (isNullOid(ref.oid)) {
    return new Uint8Array(0);
  }
  if (ref.mode === GITLINK_MODE) {
    return new TextEncoder().encode(`Subproject commit ${ref.oid}\n`);
  }
  return undefined;
}
