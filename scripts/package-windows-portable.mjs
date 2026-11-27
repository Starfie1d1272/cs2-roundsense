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

await assertFile(hostExeSrc, 'Tauri release executable');
await assertFile(resolve(sidecarSrc, 'roundsense-server.mjs'), 'sidecar bundle');
await assertFile(nodeExeSrc, 'Node executable');

await rm(stageDir, { recursive: true, force: true });
await mkdir(resolve(stageDir, 'sidecar'), { recursive: true });

await cp(hostExeSrc, resolve(stageDir, 'RoundSense.exe'));
await cp(sidecarSrc, resolve(stageDir, 'sidecar'), { recursive: true });
await cp(nodeExeSrc, resolve(stageDir, 'sidecar/node.exe'));

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
