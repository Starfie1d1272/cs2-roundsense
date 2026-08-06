/**
 * Generate the weapon table from weapons.vdata (ValveData key-value format).
 *
 * Source: SteamDatabase/GameTracking-CS2 commit 2e606a0bc54f619bc96689ae29cddc337cbde60a
 *   game/csgo/pak01_dir/scripts/weapons.vdata (accessed 2026-08-06)
 * Local install path: D:\steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\pak01_dir\scripts\weapons.vdata
 *
 * Inheritance: a weapon block (_class = "weapon_x") carries m_nPrice and a
 * _base pointer; m_nKillAward may live in the prefab block (weapon_x_prefab)
 * or default to statted_item_base.m_nKillAward = 300.
 *
 * Output: packages/economy-advisor/rules/weapons.v2026-08-06.json
 */
import { writeFileSync, readFileSync } from "node:fs";

interface RawBlock {
  name: string;
  kind: "weapon" | "prefab" | "other";
  price?: number;
  killAward?: number;
  weaponType?: string;
  base?: string;
  /** 1-based line range of the block (for parent-scope inheritance) */
  startLine: number;
  endLine: number;
}

const WEAPON_TYPE_TO_CLASS: Record<string, string> = {
  WEAPONTYPE_KNIFE: "knife",
  WEAPONTYPE_PISTOL: "pistol",
  WEAPONTYPE_SUBMACHINEGUN: "smg",
  WEAPONTYPE_SHOTGUN: "shotgun",
  WEAPONTYPE_RIFLE: "rifle",
  WEAPONTYPE_MACHINEGUN: "mg",
  WEAPONTYPE_SNIPER_RIFLE: "sniper",
  WEAPONTYPE_GRENADE: "grenade",
};

function collectBlock(lines: string[], i: number, hasOwnBrace: boolean): { block: string[]; next: number } {
  const block: string[] = [lines[i]!];
  let j = i + 1;
  let depth = 0;
  if (hasOwnBrace) {
    // key like  weapon_x_prefab =  /  statted_item_base =  → next line is the
    // object's own opening brace; skip it (its close brings depth back to 0)
    while (j < lines.length && !lines[j]!.includes("{")) j++;
    if (j >= lines.length) return { block, next: j };
    depth = 1;
    j++; // do NOT count the opening brace line itself
  }
  while (j < lines.length) {
    const l = lines[j]!;
    block.push(l);
    depth += (l.match(/\{/g) ?? []).length - (l.match(/\}/g) ?? []).length;
    j++;
    if (hasOwnBrace ? depth <= 0 : depth < 0) break;
  }
  return { block, next: j };
}

export function parseWeaponsVdata(text: string): Map<string, RawBlock[]> {
  const blocks = new Map<string, RawBlock[]>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let name: string | null = null;
    let kind: RawBlock["kind"] = "other";
    // 1) weapon blocks:  _class = "weapon_ak47"
    let m = /^\s*_class\s*=\s*"(weapon_[a-z0-9_]+)"\s*$/.exec(line);
    if (m) { name = m[1]!; kind = "weapon"; }
    else {
      // 2) prefab blocks:  weapon_ak47_prefab =  |  melee =  |  statted_item_base =
      m = /^\s*(weapon_[a-z0-9_]+)_prefab\s*=\s*$/.exec(line);
      if (m) { name = m[1]! + "_prefab"; kind = "prefab"; }
      else if (/^\s*melee\s*=\s*$/.test(line)) { name = "melee"; kind = "prefab"; }
      else {
        // 3) statted_item_base
        if (/^\s*statted_item_base\s*=\s*$/.test(line)) { name = "statted_item_base"; kind = "prefab"; }
      }
    }
    if (name) {
      const { block, next } = collectBlock(lines, i, kind !== "weapon");
      const priceL = block.find((l) => /m_nPrice\s*=/.test(l));
      const awardL = block.find((l) => /m_nKillAward\s*=/.test(l));
      const typeL = block.find((l) => /m_WeaponType\s*=/.test(l));
      const baseL = block.find((l) => /^\s*_base\s*=/.test(l));
      const arr = blocks.get(name) ?? [];
      // keep prefabs before weapon blocks (prefab registered earlier), and
      // weapon blocks ordered as they appear
      arr.push({
        name,
        kind,
        price: priceL ? Number(/=\s*(-?\d+)/.exec(priceL)![1]) : undefined,
        killAward: awardL ? Number(/=\s*(-?\d+)/.exec(awardL)![1]) : undefined,
        weaponType: typeL ? /=\s*"([^"]+)"/.exec(typeL)![1] : undefined,
        base: baseL ? /=\s*"([^"]+)"/.exec(baseL)![1] : undefined,
        startLine: i + 1,
        endLine: next,
      });
      blocks.set(name, arr);
      i = next - 1;
    }
  }
  return blocks;
}

/** Resolve inheritance: weapon → prefab chain → statted_item_base (300).
 * Among a weapon's multiple blocks, prefer one carrying `_base` (full
 * definition with inherited kill award) or an explicit m_nKillAward. */
export function resolveWeapon(
  id: string,
  blocks: Map<string, RawBlock[]>,
): { price: number; killAward: number; weaponType: string; class: string } {
  const all = blocks.get(id) ?? blocks.get(`${id}_prefab`);
  if (!all || all.length === 0) throw new Error(`no block for ${id}`);
  const prefabs = new Map<string, RawBlock>();
  for (const [k, v] of blocks) if (k.endsWith("_prefab") || k === "statted_item_base" || k === "melee") for (const b of v) prefabs.set(k, b);
  const resolveOne = (w: RawBlock): { price?: number; killAward?: number; weaponType?: string } => {
    let price = w.price;
    let award = w.killAward;
    let wt = w.weaponType;
    const chain: string[] = [];
    if (w.base) chain.push(w.base);
    else if (w.kind === "weapon") {
      chain.push(`${w.name}_prefab`); // first block lives inside its own prefab scope
      // parent-scope inheritance: the smallest enclosing prefab/melee block
      const parent = [...prefabs.values()].find((p) => p.startLine < w.startLine && p.endLine >= w.endLine);
      if (parent) chain.push(parent.name);
      else chain.push("melee"); // melee-scope blocks (knives) — melee.m_nKillAward = 1500
    }
    for (const c of chain) {
      let base = prefabs.get(c);
      while (base) {
        if (award === undefined && base.killAward !== undefined) award = base.killAward;
        if (price === undefined && base.price !== undefined) price = base.price;
        if (wt === undefined && base.weaponType !== undefined) wt = base.weaponType;
        if (base.base) base = prefabs.get(base.base);
        else break;
      }
    }
    if (award === undefined) {
      const sb = prefabs.get("statted_item_base");
      if (sb?.killAward !== undefined) award = sb.killAward;
    }
    return { price, killAward: award, weaponType: wt };
  };
  let weaponBlocks = all.filter((b) => b.kind === "weapon");
  if (weaponBlocks.length === 0) {
    // weapon has no _class block (e.g. cz75a, mp5sd legacy ids) — use its prefab
    const p = prefabs.get(`${id}_prefab`);
    if (p) weaponBlocks = [p];
  }
  const candidates = [...weaponBlocks].sort((a, b) => {
    const score = (x: RawBlock) => (x.base ? 2 : 0) + (x.killAward !== undefined ? 1 : 0);
    return score(b) - score(a);
  });
  for (const cand of candidates) {
    const r = resolveOne(cand);
    if (r.price !== undefined && r.killAward !== undefined) {
      return { price: r.price, killAward: r.killAward, weaponType: r.weaponType ?? "", class: WEAPON_TYPE_TO_CLASS[r.weaponType ?? ""] ?? `unknown:${r.weaponType}` };
    }
  }
  throw new Error(`unresolved for ${id}`);
}

/** Known demo/GSI weapon-id spellings (kills.json / game events) → vdata id. */
const ALIASES: Record<string, string> = {
  m4a4: "weapon_m4a1", // M4A4 legacy internal name → CS2 id weapon_m4a1
  m4a1: "weapon_m4a1", // M4A4 legacy alias kept for demo kills.json compatibility
  m4a1_silencer: "weapon_m4a1_silencer",
  usp_silencer: "weapon_usp_silencer",
  hkp2000: "weapon_hkp2000",
  elite: "weapon_elite",
  tec9: "weapon_tec9",
  cz75a: "weapon_cz75a",
  cz75: "weapon_cz75a",
  fiveseven: "weapon_fiveseven",
  deagle: "weapon_deagle",
  revolver: "weapon_revolver",
  glock: "weapon_glock",
  ak47: "weapon_ak47",
  galilar: "weapon_galilar",
  famas: "weapon_famas",
  sg556: "weapon_sg556",
  aug: "weapon_aug",
  awp: "weapon_awp",
  ssg08: "weapon_ssg08",
  scar20: "weapon_scar20",
  g3sg1: "weapon_g3sg1",
  mac10: "weapon_mac10",
  mp9: "weapon_mp9",
  mp7: "weapon_mp7",
  mp5sd: "weapon_mp5sd",
  ump45: "weapon_ump45",
  p90: "weapon_p90",
  bizon: "weapon_bizon",
  nova: "weapon_nova",
  sawedoff: "weapon_sawedoff",
  mag7: "weapon_mag7",
  xm1014: "weapon_xm1014",
  m249: "weapon_m249",
  negev: "weapon_negev",
  taser: "weapon_taser",
  zeus: "weapon_taser",
  knife: "weapon_knife",
  hegrenade: "weapon_hegrenade",
  molotov: "weapon_molotov",
  incgrenade: "weapon_incgrenade",
  inferno: "weapon_incgrenade", // Molotov ground fire
  decoy: "weapon_decoy",
  flashbang: "weapon_flashbang",
  smokegrenade: "weapon_smokegrenade",
};

async function main(): Promise<void> {
  const src = process.argv[2] ?? "/tmp/gt-cs2/game/csgo/pak01_dir/scripts/weapons.vdata";
  const outPath = process.argv[3] ?? "packages/economy-advisor/rules/weapons.v2026-08-06.json";
  const text = readFileSync(src, "utf8");
  const blocks = parseWeaponsVdata(text);
  const aliasToId: Record<string, string> = {};
  const aliasWarnings: string[] = [];
  for (const [alias, id] of Object.entries(ALIASES)) {
    if (!blocks.has(id) && !blocks.has(`${id}_prefab`)) { aliasWarnings.push(`${alias} → ${id} missing from vdata`); continue; }
    aliasToId[alias] = id;
  }
  if (aliasWarnings.length) console.error(`!! aliases unresolvable: ${aliasWarnings.join("; ")}`);
  const rows: Record<string, { price: number; killAward: number; class: string; weaponType: string; aliases: string[] }> = {};
  let skipped = 0;
  const weaponIds = new Set<string>();
  for (const [id, arr] of blocks) if (arr.some((b) => b.kind === "weapon")) weaponIds.add(id);
  for (const id of [...weaponIds, ...Object.values(ALIASES)]) {
    if (rows[id]) continue;
    if (!blocks.has(id)) {
      // weapon only exists as a prefab (cz75a, mp5sd, …): synthesize from prefab
      if (!blocks.has(`${id}_prefab`)) continue;
    }
    try {
      const r = resolveWeapon(id, blocks);
      const aliases = Object.entries(ALIASES).filter(([, v]) => v === id).map(([a]) => a);
      rows[id] = { price: r.price, killAward: r.killAward, class: r.class, weaponType: r.weaponType, aliases };
    } catch (e) {
      skipped++;
      console.error(`!! ${id}: ${(e as Error).message}`);
    }
  }
  const output = {
    generatedFrom: {
      repo: "SteamDatabase/GameTracking-CS2",
      commit: "2e606a0bc54f619bc96689ae29cddc337cbde60a",
      path: "game/csgo/pak01_dir/scripts/weapons.vdata",
      accessed: "2026-08-06",
      localInstall: "D:\\steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\pak01_dir\\scripts\\weapons.vdata",
      note: "price = m_nPrice; killAward = m_nKillAward resolved through _base → prefab → statted_item_base (300); first block per weapon id wins.",
    },
    weaponAliases: aliasToId,
    weapons: rows,
  };
  if (process.env.WEAPONS_DEBUG) {
    const awp = blocks.get("weapon_awp");
    console.error("awp blocks:", JSON.stringify(awp?.map((b) => ({ kind: b.kind, price: b.price, killAward: b.killAward, base: b.base }))));
    console.error("awp_prefab:", JSON.stringify(blocks.get("weapon_awp_prefab")));
  }
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`wrote ${Object.keys(rows).length} weapons (skipped ${skipped}) → ${outPath}`);
  const interesting = ["weapon_p90", "weapon_cz75a", "weapon_xm1014", "weapon_m4a1", "weapon_m4a1_silencer", "weapon_bizon", "weapon_ak47", "weapon_awp", "weapon_taser", "weapon_mp7", "weapon_mp5sd", "weapon_ump45", "weapon_glock"];
  for (const id of interesting) if (rows[id]) console.log(`  ${id}: ${JSON.stringify(rows[id])}`);
}

// run only when executed directly (not when imported by tests/tools)
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main();
}
