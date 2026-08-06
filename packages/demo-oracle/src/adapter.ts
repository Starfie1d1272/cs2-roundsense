import { readFile } from "node:fs/promises";
import { parseDemoPackage, type ParsedDemoPackage } from "cs2-demo-format/parser";

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
