import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(rootDir, 'apps/desktop/dist');
const sidecarSrc = resolve(distDir, 'sidecar');
const hostExeSrc = resolve(rootDir, 'apps/desktop/src-tauri/target/release/roundsense-desktop.exe');
const nodeExeSrc = process.env.ROUNDSENSE_NODE_EXE || process.execPath;

const stageDir = resolve(distDir, 'RoundSense-win64');
const zipOut = resolve(distDir, 'RoundSense-win64-portable.zip');

async function assertFile(path, label) {
  try {
    const s = await stat(path);
    if (!s.isFile()) throw new Error('not a file');
  } catch {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

const projectLicenseSrc = resolve(rootDir, 'LICENSE');

await assertFile(hostExeSrc, 'Tauri release executable');
await assertFile(resolve(sidecarSrc, 'roundsense-server.mjs'), 'sidecar bundle');
await assertFile(nodeExeSrc, 'Node executable');
await assertFile(projectLicenseSrc, 'project LICENSE');

await rm(stageDir, { recursive: true, force: true });
await mkdir(resolve(stageDir, 'sidecar'), { recursive: true });

await cp(hostExeSrc, resolve(stageDir, 'RoundSense.exe'));
await cp(projectLicenseSrc, resolve(stageDir, 'LICENSE.txt'));
await cp(sidecarSrc, resolve(stageDir, 'sidecar'), { recursive: true });
await cp(nodeExeSrc, resolve(stageDir, 'sidecar/node.exe'));

const nodeLicenseCandidates = [
  resolve(dirname(nodeExeSrc), 'LICENSE'),
  resolve(dirname(nodeExeSrc), '../LICENSE'),
  resolve(dirname(nodeExeSrc), '../share/doc/node/LICENSE'),
];
let copiedNodeLicense = false;
for (const candidate of nodeLicenseCandidates) {
  try {
    const s = await stat(candidate);
    if (s.isFile()) {
      await cp(candidate, resolve(stageDir, 'sidecar/NODE-LICENSE.txt'));
      copiedNodeLicense = true;
      break;
    }
  } catch {
    // try next candidate
  }
}
if (!copiedNodeLicense) {
  throw new Error(`Missing Node.js LICENSE near ${nodeExeSrc}`);
}

await writeFile(
  resolve(stageDir, 'THIRD-PARTY-NOTICES.txt'),
  [
    'RoundSense — Third-Party Notices',
    '================================',
    '',
    '1. Node.js Runtime (sidecar/node.exe)',
    '   License: MIT (https://github.com/nodejs/node/blob/main/LICENSE)',
    '   See sidecar/NODE-LICENSE.txt when bundled alongside node.exe.',
    '',
    '2. Tauri & Rust Crates (RoundSense.exe)',
    '   Built with Tauri v2 (Apache-2.0 / MIT) and windows-sys (Apache-2.0 / MIT).',
    '',
    '3. CS2 Weapon & Equipment Silhouettes (sidecar/ui/assets/cs2/*.svg)',
    '   Derived from Valve Counter-Strike 2 game HUD icon silhouettes for read-only',
    '   companion display. Counter-Strike 2 is a trademark of Valve Corporation.',
    '',
  ].join('\r\n'),
  'utf8',
);

const zip = new JSZip();
async function addDirToZip(dir, prefix) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(stageDir, full).replace(/\\/g, '/');
    const zipPath = `${prefix}/${rel}`;
    if (entry.isDirectory()) {
      await addDirToZip(full, prefix);
    } else if (entry.isFile()) {
      zip.file(zipPath, await readFile(full));
    }
  }
}

await addDirToZip(stageDir, 'RoundSense-win64');
const buffer = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 6 },
});
await writeFile(zipOut, buffer);

const sizeMb = (buffer.byteLength / (1024 * 1024)).toFixed(2);
console.log(`Packaged Windows portable ZIP: ${zipOut} (${sizeMb} MB)`);
