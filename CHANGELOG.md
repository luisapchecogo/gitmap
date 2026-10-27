# Changelog

## [Unreleased]

## [0.2.1] - 2026-10-27

A narrower Graph on busy repositories.

### Changed

- **Graph**: lines whose ends are more than 12 rows apart are cut into short stubs that fade out below the child and fade in above the parent, and at most four lanes stay open at once. On busy repositories the graph stays a few lanes wide instead of reaching dozens. The checked-out branch's line is never cut. This follows gitk's "hyperspace" lines and partial edge drawing from graph visualization research.

### Added

- **Graph**: click a stub to jump to the commit at the other end of its line, loading more history if needed.

## [0.2.0] - 2026-10-20

A visual refresh of the Graph view.

### Changed

- **Ref labels** are pills with icons, tinted with the commit's lane color. Local branches and tags sit next to the subject, with a check on the checked-out branch. Remote branches sit on the author line, and a pushed branch's remote shows as just `origin` under it. Crowded labels collapse to an icon or a "+N" chip, and every label's tooltip has its full name.
- **Graph**: narrower lanes (10px instead of 12), thinner lines and smaller commit dots, with HEAD as the larger ring. The graph column takes at most a third of the view.
- **Lane colors**: a new eight-color palette, with separate dark and light variants, replaces VS Code's five Source Control Graph colors. Themes and users can override it through `gitmap.graphLane1` to `gitmap.graphLane8`.

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
