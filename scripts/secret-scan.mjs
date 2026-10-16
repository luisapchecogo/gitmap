// Scans the repository for credentials (API keys, tokens, private keys, ...) with secretlint.
//
//   node scripts/secret-scan.mjs           every file git can see: tracked + untracked, minus .gitignore
//   node scripts/secret-scan.mjs --staged  only files staged for commit (used by .githooks/pre-commit)
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const staged = process.argv.includes('--staged');
const gitArgs = staged
  ? ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']
  : ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];

const files = execFileSync('git', gitArgs, { encoding: 'utf8' })
  .split('\0')
  .filter((file) => file && existsSync(file));

if (files.length === 0) {
  process.exit(0);
}

const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve('secretlint/package.json');
const secretlint = join(dirname(packageJsonPath), require(packageJsonPath).bin);

const { status } = spawnSync(process.execPath, [secretlint, '--maskSecrets', ...files], {
  stdio: 'inherit',
});

if (status !== 0) {
  console.error(
    '\nSecret scan failed. Remove the credential from the file (read it at runtime from VS Code ' +
      'SecretStorage or an environment variable instead) and try again. If it was ever pushed, revoke it.',
  );
}
process.exit(status ?? 1);
