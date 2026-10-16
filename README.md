# GitMap

A VS Code extension (also for VS Code–based editors such as Cursor, Windsurf and VSCodium) for comparing any two commits, or the working tree against any past commit, and reviewing every changed file folder by folder in an explorer-style tree. Selecting a file opens VS Code's own diff editor, so you step through added and removed lines file by file.

> Status: 0.1, the first usable version. Feedback and issues are welcome.

## Install

GitMap is not on the Visual Studio Marketplace yet, so you install it from a `.vsix` file. You need VS Code 1.90 or newer (or Cursor, Windsurf or VSCodium) and git.

### Option 1: download a release (no build needed)

1. Download the `gitmap-<version>.vsix` file from the [latest release](https://github.com/luisapchecogo/gitmap/releases/latest).
2. In VS Code, open the Extensions view (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>, or <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> on macOS), click the **…** menu at the top of the view, choose **Install from VSIX…** and pick the downloaded file.
3. Click the new GitMap icon in the activity bar.

Or install it from a terminal (use `cursor`, `windsurf` or `codium` instead of `code` for those editors):

```sh
code --install-extension ~/Downloads/gitmap-0.1.0.vsix
```

On macOS, if `code` is not found, run **Shell Command: Install 'code' command in PATH** from the Command Palette once.

### Option 2: build it from source

You need Node 24 or newer and git.

```sh
git clone https://github.com/luisapchecogo/gitmap.git
cd gitmap
npm install
npm run vsix -- --out gitmap.vsix
code --install-extension gitmap.vsix
```

To update, install a newer `.vsix` the same way. To remove GitMap, uninstall it from the Extensions view.

## Features

- **Commit graph in the side bar.** Click the GitMap icon in the activity bar. The **Graph** view lists commits with branch lanes, the subject, branch/remote/tag badges, the author, a relative date and the short hash. Hover a row for the full message. History loads page by page as you scroll, and a counter shows "Showing 300 of 4,321 commits".
- **Filters.** Pick the repository (in multi-root workspaces), show all branches or a single branch, and show or hide remote branches. The graph refreshes by itself when branches or HEAD move.
- **Search.** Search by message, author or hash (full or short). <kbd>Enter</kbd> and <kbd>Shift</kbd>+<kbd>Enter</kbd> step through matches, and history loads further if a match is deeper down.
- **Base ⇄ Target comparison.** The bar under the graph picks a **Base** and a **Target**, which can be a branch, tag, commit, any revision, or the **Working Tree** (target only). Choose either direction, swap the sides, and press **Compare**.
  - **Direct** (default): exactly what differs between the two snapshots.
  - **PR-style**: only what the target changed since it diverged from the base (a diff from their merge base), as a pull request shows it.
- **Right-click a commit** for Show Commit Changes, Compare with Working Tree, Set as Base, Set as Target and Copy Commit Hash. Double-click (or <kbd>Enter</kbd>) shows that commit's own changes.
- **Changes view.** Changed files appear grouped in a folder tree with compact folders, file icons, colored A/M/D/R/U letters and `+added −removed` line counts. Clicking a file opens the native diff editor with the base on the left and the target on the right. With the Working Tree as target, the right side is the real file and you can edit it in place. Binary files, images included, are served byte for byte, so VS Code handles them as it does any binary file instead of showing garbled text.
- **Open All Changes** shows every file in VS Code's multi-file diff editor. **Swap**, **Toggle PR-Style** and **Clear** are in the view's title bar and its **…** menu.
- **Big comparisons** show the first 1,000 files (`gitmap.compare.maxFiles`) with a **Show more…** item and a "Showing the first 1,000 of 4,321 changed files" message.

## Getting started

1. [Install GitMap](#install) and open a folder that contains a git repository.
2. Click the GitMap icon in the activity bar.
3. Press **Compare** right away to see your uncommitted work (Base = HEAD, Target = Working Tree), or pick other sides in the bar under the graph.
4. Click files in **Changes** to review them.

You can also run **GitMap: Compare Revisions…** from the Command Palette.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `gitmap.graph.pageSize` | `300` | Commits loaded per page in the Graph view. |
| `gitmap.graph.commitOrder` | `date` | `date` (newest first) or `topo` (keep each branch's commits together; slower on big repositories). |
| `gitmap.compare.maxFiles` | `1000` | Files shown at a time in the Changes view; also the limit above which line counts are skipped. |

## Requirements and limitations

- Requires git on the `PATH` (or the path configured for VS Code's Git extension) and a trusted workspace. GitMap runs git, which can execute commands from a repository's configuration, so it is disabled in Restricted Mode. It also does not run in virtual workspaces.
- Works with the built-in Git extension disabled (`git.enabled: false`). The Git extension, when enabled, only provides hints: repository discovery and change events.
- Paging uses `git log --skip`, so very deep scrolling is slower on huge repositories without a commit-graph file (`git commit-graph write` helps). Search reveals matches up to 10,000 commits down.
- Not in 0.1: the Working Tree as **Base**, an "uncommitted changes" row in the graph, custom hover cards, full keyboard/screen-reader grid navigation, DOM virtualization (rows are appended while scrolling), fetch/checkout/branch operations, and stashes.

## Development

Requirements: Node 24 (see `.nvmrc`) and git.

```sh
nvm use          # switch to the Node version in .nvmrc
npm install      # also enables the repo's git hooks (.githooks/)
```

| Task | Command |
| --- | --- |
| Run the extension | Press **F5** in VS Code ("Run Extension", or "Run Extension (open this repo)" to open this repository in the development host) |
| Build once | `npm run compile` (type-check + lint + esbuild bundles to `dist/`) |
| Watch | `npm run watch` (also the default build task used by F5) |
| Lint | `npm run lint` |
| Tests | `npm test` (runs `src/test/**/*.test.ts` inside a downloaded VS Code instance) |
| Package `.vsix` | `npm run vsix` |
| Secret scan | `npm run secrets` |

## Project layout

```
src/extension.ts      Entry point: wires the views, commands and providers together
src/core/             Pure logic (no vscode import): git runner, output parsers,
                      lane layout, change tree, revisions
src/git/              Repository access (GitRepository), discovery, vscode.git typings
src/state/            Session (repositories, active repo), per-repo settings, QuickPicks
src/compare/          Changes view, gitmap: file system, decorations, diff commands
src/graph/            Graph webview host: controller, view provider, commands, footer
src/webview/          Browser code and CSS for the graph webview (own tsconfig)
src/shared/           Code used by both the extension host and the webview
src/test/             Unit and integration tests (Mocha, TDD UI) and helpers
media/                Activity bar icon
esbuild.mjs           Bundler config: dist/extension.js and dist/webview/
.vscode-test.mjs      Test runner config (@vscode/test-cli)
.githooks/            Versioned git hooks (pre-commit secret scan)
scripts/              Repo tooling (secret scan, hook installer)
AGENTS.md, CLAUDE.md  Instructions for AI coding agents (Codex, Claude Code)
```

## Contributing

Contributions are welcome. Before opening a pull request, run `npm run compile` and `npm test`.

This is a public repository, so never commit credentials. A pre-commit hook scans staged files with [secretlint](https://github.com/secretlint/secretlint) and blocks commits that contain API keys, tokens or private keys. If the extension needs a credential, read it at runtime from VS Code's `SecretStorage` or an environment variable.

## License

[MIT](LICENSE). Third-party material shipped with GitMap is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
