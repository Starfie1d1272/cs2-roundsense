import { weaponIdToItem, type InventoryState } from "@roundsense/economy-advisor";
import type { GsiPayload } from "@roundsense/gsi-protocol";
import type { ItemId } from "@roundsense/shared-types";

const GSI_NON_WEAPON: Record<string, ItemId> = {
  weapon_smokegrenade: "smoke",
  weapon_flashbang: "flash",
  weapon_hegrenade: "he",
  weapon_molotov: "molotov",
  weapon_incgrenade: "incendiary",
  weapon_decoy: "decoy",
};

const GSI_NAME_ALIASES: Record<string, ItemId> = { weapon_m4a4: "m4a4" };
const PRIMARY_TYPE_HINTS = ["Rifle", "Submachine Gun", "Shotgun", "Machine Gun", "SniperRifle"];

/**
 * Decode only a complete normal-player inventory observation. GSI payloads
 * are partial; omitted fields are not evidence of an empty slot or false
 * equipment flag. Callers retain a prior complete observation explicitly or
 * expose UNKNOWN.
 */
export function inventoryFrom(payload: GsiPayload): InventoryState | undefined {
  const state = payload.player?.state;
  const weapons = payload.player?.weapons;
  if (
    state === undefined ||
    weapons === undefined ||
    state.armor === undefined ||
    state.helmet === undefined ||
    state.defusekit === undefined
  ) return undefined;
  let primary: ItemId | null = null;
  let secondary: ItemId | undefined;
  const grenades: ItemId[] = [];
  for (const weapon of Object.values(weapons)) {
    const name = weapon?.name;
    if (!name) continue;
    const item = GSI_NON_WEAPON[name] ?? GSI_NAME_ALIASES[name] ?? weaponIdToItem(name);
    if (!item) continue;
    if (["smoke", "flash", "he", "molotov", "incendiary", "decoy"].includes(item)) {
      const quantity = weapon?.ammo_reserve !== undefined && weapon.ammo_reserve >= 0 ? weapon.ammo_reserve : 1;
      for (let index = 0; index < quantity; index++) grenades.push(item);
      continue;
    }
    if (item === "kevlar" || item === "kevlar_helmet") continue;
    const type = weapon?.type ?? "";
    if (PRIMARY_TYPE_HINTS.some((hint) => type.includes(hint))) primary = item;
    else if (type.includes("Pistol")) secondary = item;
  }
  return {
    primary,
    secondary,
    armor: state.armor,
    hasHelmet: state.helmet,
    hasDefuseKit: state.defusekit,
    grenades,
  };
}
