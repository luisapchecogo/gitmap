import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Prints build start/finish markers and errors in the format the
 * background problem matcher in .vscode/tasks.json expects.
 * @type {import('esbuild').Plugin}
 */
const problemMatcherPlugin = {
  name: 'problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      }
      console.log('[watch] build finished');
    });
  },
};

/**
 * Copies the codicon font and stylesheet next to the webview bundle: the
 * webview may only load files from the extension's own folder, and
 * node_modules is not shipped in the .vsix.
 */
async function copyCodicons() {
  const require = createRequire(import.meta.url);
  const source = join(dirname(require.resolve('@vscode/codicons/package.json')), 'dist');
  await mkdir('dist/webview', { recursive: true });
  await Promise.all(
    ['codicon.css', 'codicon.ttf'].map((file) => copyFile(join(source, file), join('dist/webview', file))),
  );
}

const extensionContext = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  // VS Code 1.90 (our minimum engine) runs extensions on Node 20.
  target: 'node20',
  platform: 'node',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  logLevel: 'silent',
  plugins: [problemMatcherPlugin],
});

// The graph view's browser code and styles (see src/webview/).
const webviewContext = await esbuild.context({
  entryPoints: ['src/webview/main.ts', 'src/webview/main.css'],
  bundle: true,
  format: 'iife',
  // VS Code 1.90 ships Electron 29 (Chromium 122).
  target: 'chrome120',
  platform: 'browser',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  outdir: 'dist/webview',
  logLevel: 'silent',
  plugins: [problemMatcherPlugin],
});

await copyCodicons();

if (watch) {
  await Promise.all([extensionContext.watch(), webviewContext.watch()]);
} else {
  await Promise.all([extensionContext.rebuild(), webviewContext.rebuild()]);
  await Promise.all([extensionContext.dispose(), webviewContext.dispose()]);
}
