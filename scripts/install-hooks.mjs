// Points git at the versioned hooks in .githooks/. Runs automatically on `npm install` (the "prepare" script).
import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
} catch {
  // Not a git checkout (e.g. installed from a tarball) — nothing to install.
}
