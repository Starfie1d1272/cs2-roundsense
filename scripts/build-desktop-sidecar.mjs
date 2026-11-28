import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktopRequire = createRequire(resolve(rootDir, 'apps/desktop/package.json'));
const esbuild = desktopRequire('esbuild');

const sidecarDir = resolve(rootDir, 'apps/desktop/dist/sidecar');
const uiSource = resolve(rootDir, 'apps/roundsense/ui');
const uiDest = resolve(sidecarDir, 'ui');
const entry = resolve(rootDir, 'apps/roundsense/src/hud/index.ts');
const outfile = resolve(sidecarDir, 'roundsense-server.mjs');

await rm(sidecarDir, { recursive: true, force: true });
await mkdir(sidecarDir, { recursive: true });

await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: false,
  minify: false,
  banner: {
    js: "import { createRequire as __rsCreateRequire } from 'node:module'; const require = __rsCreateRequire(import.meta.url);",
  },
});

await cp(uiSource, uiDest, { recursive: true });
console.log(`Built sidecar bundle: ${outfile}`);
console.log(`Copied UI assets: ${uiDest}`);
