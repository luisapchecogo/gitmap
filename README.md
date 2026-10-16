# GitMap

A VS Code extension (also targeting VS Code–based editors such as Cursor, Windsurf and VSCodium) for comparing any two commits — or the working tree against any past commit — and reviewing every changed file, folder by folder, in an explorer-style tree. Selecting a file opens VS Code's diff editor so you can step through added and removed lines file by file.

> Status: project scaffolding only. The comparison features are not implemented yet.

## Development

Requirements: Node 24 (see `.nvmrc`) and git.

```sh
nvm use          # switch to the Node version in .nvmrc
npm install      # also enables the repo's git hooks (.githooks/)
```

| Task | Command |
| --- | --- |
| Run the extension | Press **F5** in VS Code ("Run Extension", or "Run Extension (open this repo)" to open this repository in the development host) |
| Build once | `npm run compile` (type-check + lint + esbuild bundle to `dist/`) |
| Watch | `npm run watch` (also the default build task used by F5) |
| Lint | `npm run lint` |
| Tests | `npm test` (runs `src/test/**/*.test.ts` inside a downloaded VS Code instance) |
| Package `.vsix` | `npm run vsix` |
| Secret scan | `npm run secrets` |

Install a packaged build with `code --install-extension gitmap-<version>.vsix` (or the equivalent CLI of your editor).

## Project layout

```
src/extension.ts      Extension entry point (activate/deactivate)
src/test/             Integration tests (Mocha, TDD UI)
media/                Activity bar icon and other static assets
esbuild.mjs           Bundler config — produces dist/extension.js
.vscode-test.mjs      Test runner config (@vscode/test-cli)
.githooks/            Versioned git hooks (pre-commit secret scan)
scripts/              Repo tooling (secret scan, hook installer)
AGENTS.md, CLAUDE.md  Instructions for AI coding agents (Codex, Claude Code)
```

## Contributing

Contributions are welcome. Before opening a pull request, run `npm run compile` and `npm test`.

This is a public repository, so never commit credentials. A pre-commit hook scans staged files with [secretlint](https://github.com/secretlint/secretlint) and blocks commits that contain API keys, tokens or private keys. If the extension needs a credential, read it at runtime from VS Code's `SecretStorage` or an environment variable.

## License

[MIT](LICENSE)
