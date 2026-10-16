# Changelog

## [Unreleased]

## [0.1.0] - 2026-10-16

First usable version.

### Added

- **Graph view**: commit list with branch lanes, ref badges, author, relative date and short hash, two lines per commit; paged loading while scrolling with a "Showing N of M commits" counter; full-message tooltips.
- Graph toolbar: repository picker, all-branches/single-branch filter, remote branches toggle, refresh. Filters are remembered per repository.
- Commit search by message, author or hash, with match navigation that loads deeper history when needed.
- Automatic graph refresh when branches or HEAD change (only while visible).
- **Compare bar**: pick Base and Target (any branch, tag, commit or revision; the Working Tree as target), swap them, and toggle a PR-style comparison from the merge base.
- Commit context menu: Show Commit Changes, Compare with Working Tree, Set as Base, Set as Target, Copy Commit Hash. Double-click shows a commit's changes.
- **Changes view**: changed files in an explorer-style folder tree with compact folders, file icons, status letters and colors, and `+/−` line counts. Clicking a file opens VS Code's diff editor. The working-tree side is editable, and binary files are served byte for byte.
- Open All Changes (multi-file diff editor), Swap, Toggle PR-Style, Clear, Copy Path and Open File actions.
- Large comparisons are shown 1,000 files at a time (`gitmap.compare.maxFiles`) with "Show more…".
- Settings: `gitmap.graph.pageSize`, `gitmap.graph.commitOrder`, `gitmap.compare.maxFiles`.
- Command: **GitMap: Compare Revisions…**.

### Earlier

- Project scaffolding: TypeScript + esbuild extension, ESLint, extension tests.
