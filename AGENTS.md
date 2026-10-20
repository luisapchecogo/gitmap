# GitMap — agent instructions

Shared guide for AI coding agents working in this repo. Codex reads this file directly; Claude Code loads it through `CLAUDE.md`. Keep agent-agnostic guidance here rather than in tool-specific files.

GitMap is an open-source (MIT) VS Code extension written in TypeScript. It must also work in VS Code–based IDEs (Cursor, Windsurf, VSCodium).

## Product goal

An activity-bar view (like Git Graph, but focused on comparison) where the user picks two commits — or the working tree vs. any past commit — and sees every changed file grouped in a folder tree. Clicking a file opens VS Code's native diff editor so changes can be reviewed line by line, file by file. Version 0.1 implements this: a Graph webview (commit list with lanes, filters, search, and a Base ⇄ Target compare bar) above a Changes tree view. The README lists the features and the out-of-scope items.

## Architecture

The extension host owns all state; the graph webview only renders it.

| Folder | Role |
| --- | --- |
| `src/core/` | Pure logic with **no `vscode` import**, so it is unit-testable: `GitRunner` (the only way to run git), parsers for `log -z`, `for-each-ref`, `diff --raw -z` and `--numstat -z`, `LaneLayout` (graph lanes), `buildChangeTree`, `Revision`. |
| `src/git/` | `GitRepository` (all git operations, also vscode-free), repository discovery, vendored `vscode.git` typings (`import type` only). |
| `src/state/` | `Session` (repositories, active repo, runner), `WorkspaceStore` (per-repo settings in workspace state), QuickPicks. |
| `src/compare/` | Changes tree, `CompareState`/`CompareService`, the read-only `gitmap:` file system, decorations, diff commands. |
| `src/graph/` | `GraphController` (rows, paging, generations, search, reveal; no webview dependency), the webview view provider, HTML/CSP, the compare footer, auto refresh, row commands. |
| `src/webview/` | Browser code for the graph (own `tsconfig.json`, DOM lib), bundled to `dist/webview/`. |
| `src/shared/` | Code for both sides (message protocol, SVG geometry, ref label layout, formatting): no Node or `vscode` imports. |

Invariants to keep:

- **git only through `GitRunner`**: `spawn` with no shell, hardened env (`GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, …) and config overrides. Put `--end-of-options` before user-supplied revisions, or reject values that start with `-` where git lacks it (`rev-parse`). Pass many revisions through `--stdin`.
- **Machine-readable git output only**: NUL-separated formats (`-z`, `%x00`); never parse decorated or human output (`%D`, porcelain status).
- **`vscode.git` is a soft dependency**: never add it to `extensionDependencies`; everything must work with `git.enabled: false`.
- **Webview security**: commit messages and ref names are attacker-controlled. Build DOM with `textContent`/`createElement(NS)`, never `innerHTML`; keep the nonce CSP without `unsafe-inline` (set styles through CSSOM only); validate every message and command argument coming from the webview.
- **Webviews are disposable**: side bar webviews are destroyed when hidden, so the host replays its state when the webview posts `ready`. Reloads bump a generation number, and stale results are dropped.
- **Graph loads pin their tips** (hashes resolved once per load); never use `git log --all`.
- **`gitmap:` URIs are self-contained** (repo path + blob id), because diff editors are restored after a reload before discovery finishes. The file system provider is registered synchronously in `activate()`.
- Tests: pure modules get unit tests; git behavior is tested against throwaway repositories (`src/test/helpers/tempRepo.ts`, isolated config, fixed dates); extension behavior goes through the internals returned by `activate()` (`GitMapTestApi`, which is not a public API). What a test must do to belong in the suite is in **Tests** below.

## Tests — only tests that can catch real bugs

A passing suite is evidence only for what its tests actually check. Tests exist to find bugs, not to raise the pass count or to reassure the agent that wrote the code. Every test must be able to fail because of a plausible bug in GitMap's own code.

- Check GitMap against something it does not control: real git output in a throwaway repository, VS Code's real state (open editors, the `gitmap:` file system), results worked out by hand from the expected behavior, or invariants (paged history equals the whole history; layout rows connect).
- Don't write circular or redundant tests:
  - **Tautologies**: asserting what the framework or the test's own setup already guarantees (`isActive` right after `activate()`, reading back a value the test just set, empty input through code that returns early).
  - **Restated implementation**: expected values copied from the code's own formulas, constants or helpers (exact SVG path strings, the runner's env table, comparing a result with the function that produced it), or tests of one-line pass-through handlers.
  - **Platform behavior**: testing `toLocaleString`, `URLSearchParams` or git itself instead of how GitMap uses them.
  - **Implementation details**: internal counters or private state (such as the load generation number) instead of behavior a user or caller can observe.
  - **Duplicates**: a test assembled only from behavior other tests already cover, with no new scenario or edge case.
  - **Assertions that can't fail**: checks that still pass when the behavior under test is removed, like a "topo order" test that date order also satisfies.
  - **Mocks checking mocks**: asserting that a stub the test set up was called. Use a throwaway repository instead of mocking git.
- Prove every new test can fail: break the behavior on purpose (or revert the fix), watch the test fail, then restore the code. Say so in the commit's **Verified** section. When practical, a bug fix comes with a test that fails without the fix.
- Prefer one realistic scenario with a few meaningful assertions over many shallow tests. Never add tests to grow the count.
- When reporting results, say what the tests cover and what they don't (visual rendering, the manual checks), instead of presenting the pass count as proof of more.
- An existing test that breaks these rules is removed or fixed in its own `test:` commit.

## Secrets — never commit credentials

This repository is public. Anything committed is published permanently, even if a later commit deletes it.

- Never write API keys, tokens, passwords, private keys, or `.env` contents into any file, commit, test fixture, log, or commit message. If the extension ever needs a credential, read it at runtime from VS Code `SecretStorage` (`context.secrets`) or an environment variable.
- The git pre-commit hook (`.githooks/pre-commit`, enabled automatically by `npm install`) scans staged files with secretlint and blocks the commit on a finding. Never bypass it (`git commit --no-verify`), and never weaken `.secretlintrc.json` to silence a finding — remove the secret instead.
- Run `npm run secrets` (scans every file git can see) before pushing.
- If a secret was ever committed or pushed, stop and tell the user right away: it must be revoked and rotated; rewriting history alone is not enough.
- GitHub secret scanning with push protection is enabled on the remote as a second line of defense.

## Commits — small, incremental, well described

The git history is the project's log of what was done, how, and why. Keep it traceable.

- Commit after every logical, self-contained step (one concern per commit: a new module, a command, a bug fix, its tests, a docs change). Don't batch a whole feature into one commit, and don't end a task with uncommitted work.
- Every commit must build: run `npm run compile` (and `npm test` when behavior or tests change) before committing.
- Stage files explicitly and review `git diff --cached` before committing. Never use `--no-verify`.
- Subject: [Conventional Commits](https://www.conventionalcommits.org/) style, `<type>(<scope>): <summary>` — imperative mood, ≤ 72 characters. Types: `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`.
- Body (required for anything beyond a trivial change), wrapped at 72 columns:
  - **What** changed, and **why** it was needed.
  - **How** it works — the approach and key decisions, including alternatives rejected.
  - **Verified** — the commands or manual checks that confirm it works.
  - **Refs** — related issues, PRs, docs, or earlier commits, when relevant.
- End with a `Co-Authored-By:` trailer naming the AI agent that wrote the change, so the history shows which agent did what.
- Never amend, rebase, or force-push commits that are already on `origin`. Push to `origin` only when the user asks — the repository is public.

Example:

```
feat(compare): list changed files between two commits

What: add a git wrapper that returns the files changed between two
refs, with their status (added/modified/deleted/renamed).
Why: the Compare tree needs per-file status before diffs can open.
How: run `git diff --name-status -z` via execFile (no shell) and parse
the NUL-separated output, so paths with spaces or newlines are safe.
Verified: npm run compile; npm test (new parser tests).

Co-Authored-By: <agent name> <agent email>
```

## Commands

Node 24 is required (`.nvmrc`). Agent shells may start on an older default Node; if `node -v` is below 24, run `source ~/.nvm/nvm.sh && nvm use` first.

- `npm run compile` — type-check, lint, bundle (`dist/extension.js`)
- `npm run lint` / `npm run check-types`
- `npm test` — compiles tests to `out/`, then runs them in a downloaded VS Code (`.vscode-test/`)
- `npm run compile-tests && npx vscode-test --grep "<test name>"` — run only matching tests (for example, to watch a new test fail)
- `npm run secrets` — secret scan
- `npm run vsix` — package a `.vsix`

## Toolchain constraints (non-obvious)

- `engines.vscode` is `^1.90.0` to stay compatible with VS Code forks that lag upstream. `@types/vscode` is pinned **exactly** to that same minimum; bump both together, never `@types/vscode` alone (vsce rejects types newer than the engine). Don't use APIs newer than the engine.
- TypeScript is pinned to `~6.0` because typescript-eslint supports `<6.1`; TypeScript 7 (native) is not supported by it yet.
- `@types/node` stays on 20.x — the Node version VS Code 1.90's extension host runs.
- The extension is bundled with esbuild (`esbuild.mjs`) into `dist/extension.js`, and the graph webview (`src/webview/`, browser code with its own `tsconfig.json`) into `dist/webview/` together with the codicon font copied from `@vscode/codicons`; tests are compiled separately with `tsc` into `out/`. Only `dist/`, `media/`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE` and `THIRD_PARTY_NOTICES.md` ship in the `.vsix` (see `.vscodeignore`) — keep new tooling files out of it, and record any bundled third-party asset in `THIRD_PARTY_NOTICES.md`.
- npm 11 install-script approvals live in `package.json` → `allowScripts` (esbuild, @vscode/vsce-sign).
- `npm audit` reports issues in mocha's deps via `@vscode/test-cli`; they are dev-only test tooling and not shipped.
- Lint enforces `no-floating-promises` / `no-misused-promises` (type-aware): await, `.catch`, or explicitly `void` every promise.

## Personal agent files

Shared guidance is committed (`AGENTS.md`, `CLAUDE.md`). Personal overrides are gitignored: `CLAUDE.local.md`, `.claude/settings.local.json`, `AGENTS.override.md`.
