import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseDemoPackage, type ParsedDemoPackage } from "cs2-demo-format/parser";
import { manifestSchema, SCHEMAS_BY_KEY } from "cs2-demo-format";

/**
 * Read-only adapter for `cs2-demo-format` v3 ZIP packages (P1).
 *
 * - Path is caller-provided: no absolute path is bound anywhere in the repo.
 * - Loads and strictly validates against the canonical schemas.
 * - Nothing is written back to the source ZIP.
 */
export async function loadDemoPackage(zipPath: string): Promise<ParsedDemoPackage> {
  const buffer = await readFile(zipPath);
  return parseDemoPackage(buffer);
}

/**
 * Load an UNPACKED v3 package directory (manifest.json + declared files).
 * Useful for corpora stored as plain directories (e.g. Windows
 * cs2-research/corpus). Validates with the same canonical schemas.
 */
export async function loadDemoPackageDir(dirPath: string): Promise<ParsedDemoPackage> {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(join(dirPath, "manifest.json"), "utf8")));
  const files: Record<string, unknown> = {};
  for (const [key, filename] of Object.entries(manifest.files)) {
    const schema = (SCHEMAS_BY_KEY as Record<string, { parse: (v: unknown) => unknown }>)[key];
    if (!schema) throw new Error(`Unknown manifest file key: ${key}`);
    const filePath = join(dirPath, filename);
    // Optional columnar streams (shots/replay/duels) are frequently trimmed
    // from unpacked corpora — tolerate their absence, keep everything else strict.
    if (["shots", "replay", "duels"].includes(key) && !existsSync(filePath)) continue;
    files[key] = schema.parse(JSON.parse(await readFile(filePath, "utf8")));
  }
  return { manifest, files: files as unknown as ParsedDemoPackage["files"] };
}

export type { ParsedDemoPackage } from "cs2-demo-format/parser";
export {
  type Manifest,
  type Match,
  type PlayerRow,
  type RoundRow,
  type PlayerStatsRow,
  type PlayerEconomyRow,
  type KillRow,
  type DamageRow,
  type BlindRow,
  type BombRow,
  type ClutchRow,
  type GrenadeRow,
} from "cs2-demo-format";
