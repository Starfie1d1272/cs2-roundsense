#!/usr/bin/env node
/**
 * Build fixtures/demo-format/tiny-v3.zip from a real cs2-demo-format v3 ZIP.
 *
 * Trims every event/aggregate file to the first 2 rounds and drops the
 * optional columnar streams (shots/replay/duels), producing a small,
 * schema-valid package that is committed for offline tests.
 *
 * Usage:
 *   node scripts/make-tiny-demo-fixture.mjs \
 *     ~/GitHub/cs2-demo-analysis-kit/fixtures/input/sample-2026-05-17_de_ancient_Team_Spirit_13-10_Team_Falcons.zip
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "fixtures", "demo-format", "tiny-v3.zip");
const MAX_ROUND = 2;

const KEEP_KEYS = [
  "match", "players", "rounds", "playerStats", "playerEconomies",
  "kills", "damages", "blinds", "bombs", "grenades", "clutches",
];

const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/make-tiny-demo-fixture.mjs <source-v3.zip>");
  process.exit(1);
}

const zip = await JSZip.loadAsync(await readFile(source));
const manifest = JSON.parse(await zip.file("manifest.json").async("text"));

// New manifest: keep only the 11 required files
const files = {};
for (const key of KEEP_KEYS) files[key] = manifest.files[key];

const out = new JSZip();
out.file("manifest.json", JSON.stringify({ ...manifest, files }));

for (const key of KEEP_KEYS) {
  const raw = await zip.file(manifest.files[key]).async("text");
  const data = JSON.parse(raw);
  let trimmed = data;
  if (Array.isArray(data) && key !== "players" && key !== "playerStats") {
    trimmed = data.filter((row) => (row.roundNumber ?? 1) <= MAX_ROUND);
  }
  out.file(files[key], JSON.stringify(trimmed));
}

const buf = await out.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
await writeFile(OUT, buf);
console.log(`wrote ${OUT} (${(buf.length / 1024).toFixed(1)} KB)`);
