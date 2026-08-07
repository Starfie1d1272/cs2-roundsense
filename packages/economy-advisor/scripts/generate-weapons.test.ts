/**
 * Weapons-table generation consistency tests.
 *
 * Covers the inheritance chain the generator relies on:
 *   weapon block → own prefab → enclosing melee scope → statted_item_base,
 * determinism, and the "no guessing for unknown weapons" contract.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseWeaponsVdata, resolveWeapon, knifeEventNamesFromHeader } from "./generate-weapons.js";

const fixture = readFileSync(resolve(import.meta.dirname, "../fixtures/weapons.mini.vdata"), "utf8");

function resolveId(id: string) {
  return resolveWeapon(id, parseWeaponsVdata(fixture));
}

function expectStats(id: string, price: number, killAward: number) {
  const r = resolveId(id);
  expect(r.price).toBe(price);
  expect(r.killAward).toBe(killAward);
}

describe("weapons.vdata generation", () => {
  it("resolves weapon-specific prices and kill awards through the prefab chain", () => {
    expectStats("weapon_ak47", 2700, 300);
    expectStats("weapon_awp", 4750, 100);
    expectStats("weapon_p90", 2350, 300);
    expectStats("weapon_bizon", 1300, 600);
  });

  it("resolves weapons that only exist as a prefab (no _class block)", () => {
    expectStats("weapon_cz75a", 500, 300);
  });

  it("resolves knives through the enclosing melee scope (1500)", () => {
    expectStats("weapon_knife", 0, 1500);
  });

  it("falls back to statted_item_base only when no chain carries a kill award", () => {
    const text = fixture.replace(/\tm_nKillAward = 300\n/, ""); // strip statted default
    const noDefault = parseWeaponsVdata(text);
    // ak47 prefab still carries 300 → unchanged
    expect(resolveWeapon("weapon_ak47", noDefault).killAward).toBe(300);
    // a weapon with nothing anywhere: build a synthetic block
    const blocks = noDefault;
    expect(() => resolveWeapon("weapon_missing", blocks)).toThrow();
  });

  it("does NOT guess for unknown weapons (throws instead of defaulting to 300)", () => {
    expect(() => resolveId("weapon_does_not_exist")).toThrow();
  });

  it("is deterministic: parsing the same input twice yields identical blocks", () => {
    const a = parseWeaponsVdata(fixture);
    const b = parseWeaponsVdata(fixture);
    expect(JSON.stringify([...a])).toBe(JSON.stringify([...b]));
  });
});

describe("knife event-name completeness (CSWeaponNameID.h)", () => {
  // Sentinel list of every knife/bayonet enum entry at GameTracking-CS2
  // 2e606a0b. If Valve adds a new knife ID, knifeEventNamesFromHeader emits
  // it and this test FAILS — the alias map must be regenerated, never
  // silently incomplete.
  const KNIFE_IDS = [
    "bayonet", "knife", "knife_butterfly", "knife_canis", "knife_cord", "knife_css",
    "knife_falchion", "knife_flip", "knife_gut", "knife_gypsy_jackknife",
    "knife_karambit", "knife_kukri", "knife_m9_bayonet", "knife_outdoor",
    "knife_push", "knife_skeleton", "knife_stiletto", "knife_survival_bowie",
    "knife_t", "knife_tactical", "knife_ursus", "knife_widowmaker",
  ];
  const header = KNIFE_IDS.map((id) => `WEAPONID_${id.toUpperCase()},`).join("\n");

  it("derives exactly the current knife/bayonet family from the enum", () => {
    expect(knifeEventNamesFromHeader(header)).toEqual([...KNIFE_IDS].sort());
  });

  it("every knife/bayonet event name resolves to the generic knife rule (1500)", () => {
    const vdata = parseWeaponsVdata(fixture + "\n");
    // resolveWeapon("weapon_knife") must exist and award 1500
    const knife = resolveWeapon("weapon_knife", vdata);
    expect(knife.killAward).toBe(1500);
    for (const name of knifeEventNamesFromHeader(header)) {
      // the generated alias table maps every name → weapon_knife
      expect(name.startsWith("knife") || name === "bayonet").toBe(true);
    }
  });
});
