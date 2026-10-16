# GitMap — agent instructions

Shared guide for AI coding agents working in this repo. Codex reads this file directly; Claude Code loads it through `CLAUDE.md`. Keep agent-agnostic guidance here rather than in tool-specific files.

GitMap is an open-source (MIT) VS Code extension written in TypeScript. It must also work in VS Code–based IDEs (Cursor, Windsurf, VSCodium).

## Product goal

An activity-bar view (like Git Graph, but focused on comparison) where the user picks two commits — or the working tree vs. any past commit — and sees every changed file grouped in a folder tree. Clicking a file opens VS Code's native diff editor so changes can be reviewed line by line, file by file. Currently only scaffolding exists: `src/extension.ts` registers an empty `gitmap.compare` tree that shows welcome text.

## Secrets — never commit credentials

This repository is public. Anything committed is published permanently, even if a later commit deletes it.

- Never write API keys, tokens, passwords, private keys, or `.env` contents into any file, commit, test fixture, log, or commit message. If the extension ever needs a credential, read it at runtime from VS Code `SecretStorage` (`context.secrets`) or an environment variable.
- The git pre-commit hook (`.githooks/pre-commit`, enabled automatically by `npm install`) scans staged files with secretlint and blocks the commit on a finding. Never bypass it (`git commit --no-verify`), and never weaken `.secretlintrc.json` to silence a finding — remove the secret instead.
- Run `npm run secrets` (scans every file git can see) before pushing.
- If a secret was ever committed or pushed, stop and tell the user right away: it must be revoked and rotated; rewriting history alone is not enough.
- GitHub secret scanning with push protection is enabled on the remote as a second line of defense.

## Commands

Node 24 is required (`.nvmrc`). Agent shells may start on an older default Node; if `node -v` is below 24, run `source ~/.nvm/nvm.sh && nvm use` first.

- `npm run compile` — type-check, lint, bundle (`dist/extension.js`)
- `npm run lint` / `npm run check-types`
- `npm test` — compiles tests to `out/`, then runs them in a downloaded VS Code (`.vscode-test/`)
- `npm run secrets` — secret scan
- `npm run vsix` — package a `.vsix`

## Toolchain constraints (non-obvious)

- `engines.vscode` is `^1.90.0` to stay compatible with VS Code forks that lag upstream. `@types/vscode` is pinned **exactly** to that same minimum; bump both together, never `@types/vscode` alone (vsce rejects types newer than the engine). Don't use APIs newer than the engine.
- TypeScript is pinned to `~6.0` because typescript-eslint supports `<6.1`; TypeScript 7 (native) is not supported by it yet.
- `@types/node` stays on 20.x — the Node version VS Code 1.90's extension host runs.
- The extension is bundled with esbuild (`esbuild.mjs`); tests are compiled separately with `tsc` into `out/`. Only `dist/`, `media/`, `package.json`, `README.md`, `CHANGELOG.md` and `LICENSE` ship in the `.vsix` (see `.vscodeignore`) — keep new tooling files out of it.
- npm 11 install-script approvals live in `package.json` → `allowScripts` (esbuild, @vscode/vsce-sign).
- `npm audit` reports issues in mocha's deps via `@vscode/test-cli`; they are dev-only test tooling and not shipped.
- Lint enforces `no-floating-promises` / `no-misused-promises` (type-aware): await, `.catch`, or explicitly `void` every promise.

## Personal agent files

Shared guidance is committed (`AGENTS.md`, `CLAUDE.md`). Personal overrides are gitignored: `CLAUDE.local.md`, `.claude/settings.local.json`, `AGENTS.override.md`.
