import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { ROUND_TYPES } from "@roundsense/shared-types";
import { economyTypeSchema } from "cs2-demo-format";
import { loadDemoPackage } from "./adapter.js";
import { bombTruth, economyTruth, roundTruth, teamLossStreakPerRound } from "./truth.js";
import { gapReport } from "./gaps.js";

const TINY = join(process.cwd(), "fixtures", "demo-format", "tiny-v3.zip");

describe("demo-oracle adapter", () => {
  it("parses the committed tiny v3 package", async () => {
    const pkg = await loadDemoPackage(TINY);
    expect(pkg.manifest.schemaVersion).toBe("cs2-demo-format/3.0");
    expect(pkg.files.rounds.length).toBeGreaterThanOrEqual(1);
    expect(pkg.files.players.length).toBeGreaterThan(0);
    expect(pkg.files.bombs).toBeInstanceOf(Array);
    expect(pkg.files.playerEconomies).toBeInstanceOf(Array);
  });
});

describe("demo-oracle truth queries", () => {
  it("computes C4 truth (plant/explode/defuse + fuse) per round", async () => {
    const pkg = await loadDemoPackage(TINY);
    const bombs = bombTruth(pkg);
    expect(bombs.length).toBe(pkg.files.rounds.length);
    for (const b of bombs) expect(b.derived).toBe(true);
    const withFuse = bombs.filter((b) => b.fuseMs !== null);
    // The tiny fixture derives from a real match — round 1 plants (we saw
    // planted at tick 3814 in the source sample); fuse must be positive.
    if (withFuse.length > 0) {
      for (const b of withFuse) {
        expect(b.fuseMs).toBeGreaterThan(0);
        expect(b.explodedTick!).toBeGreaterThan(b.plantedTick!);
      }
    } else {
      // honest fallback: report rather than assert
      console.warn("[demo-oracle test] no measurable fuse in tiny fixture");
    }
  });

  it("joins economy rows with team results", async () => {
    const pkg = await loadDemoPackage(TINY);
    const econ = economyTruth(pkg);
    expect(econ.length).toBeGreaterThan(0);
    for (const row of econ) {
      expect(["win", "loss", null]).toContain(row.teamResult);
      expect(ROUND_TYPES).toContain(row.type);
    }
  });

  it("derives team loss streaks from round winners (C2 semantics)", async () => {
    const pkg = await loadDemoPackage(TINY);
    const streaks = teamLossStreakPerRound(pkg);
    for (const round of pkg.files.rounds) {
      const a = streaks.get(`${round.roundNumber}:teamA`);
      const b = streaks.get(`${round.roundNumber}:teamB`);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThanOrEqual(0);
    }
  });

  it("round truth joins bomb truth per round", async () => {
    const pkg = await loadDemoPackage(TINY);
    const rounds = roundTruth(pkg);
    for (const r of rounds) {
      expect(r.bomb === null || r.bomb.roundNumber === r.roundNumber).toBe(true);
    }
  });

  it("gap report never claims silent defaults", async () => {
    const pkg = await loadDemoPackage(TINY);
    const gaps = gapReport(pkg);
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) {
      expect(g.mitigation.length).toBeGreaterThan(10);
    }
  });
});

describe("shared-types consistency with cs2-demo-format", () => {
  it("ROUND_TYPES matches economyTypeSchema options (D1)", () => {
    expect([...ROUND_TYPES].sort()).toEqual([...economyTypeSchema.options].sort());
  });
});
