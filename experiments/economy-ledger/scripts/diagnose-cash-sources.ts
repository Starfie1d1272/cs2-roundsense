/**
 * Bounded replay cash-source diagnosis (2026-08-06, one-shot audit).
 *
 * For a chosen round, print a per-frame cash ledger for chosen players over
 * the replay segment [freezeEndTick(r), startTick(r+1)) — covering the round's
 * live phase, round-end settlement, and the tail before the next round —
 * cross-referenced with kills/round_end events, and compared field-by-field
 * against player-economies.json (startMoney/moneySpent).
 *
 * Run: pnpm --filter @roundsense/experiment-economy-ledger exec tsx scripts/diagnose-cash-sources.ts <zip> <round> <name1> [name2 ...]
 *
 * This tool ONLY reports evidence. It changes no rules and no state machine.
 */
import { loadDemoPackage } from "@roundsense/demo-oracle";
import { decodeDelta } from "cs2-demo-format/parser";

interface CashJump {
  frame: number;
  tick: number;
  phase: "freeze-tail" | "live" | "round_end" | "post";
  cashBefore: number;
  cashAfter: number;
  delta: number;
  events: string[];
  equipDelta: number;
  grenadeDelta: string;
}

async function main(): Promise<void> {
  const zipPath = process.argv[2]!;
  const roundNumber = Number(process.argv[3]!);
  const names = process.argv.slice(4);
  const pkg = await loadDemoPackage(zipPath);
  const { players, rounds, kills, bombs, playerEconomies, replay } = pkg.files;
  if (!replay) { console.log("no replay in package"); return; }
  const round = rounds.find((r) => r.roundNumber === roundNumber)!;
  const next = rounds.find((r) => r.roundNumber === roundNumber + 1);
  const rr = replay.rounds.find((r) => r.roundNumber === roundNumber);
  if (!rr) { console.log(`no replay segment for round ${roundNumber}`); return; }

  const teamByPlayer = new Map<number, string>();
  players.forEach((p, i) => teamByPlayer.set(i, p.teamKey));
  const nameOf = new Map(players.map((p, i) => [i, p.name]));
  const indices = names.map((n) => players.findIndex((p) => p.name === n)).filter((i) => i >= 0);
  const tTeam = round.teamASide === "t" ? "teamA" : "teamB";
  const killsInRound = kills.filter((k) => k.roundNumber === roundNumber);
  const plantsInRound = bombs.filter((b) => b.roundNumber === roundNumber && b.type === "planted");
  const defusesInRound = bombs.filter((b) => b.roundNumber === roundNumber && b.type === "defused");

  // events per tick (with 1-frame tolerance window = tickStep ticks)
  const eventsByTick = new Map<number, string[]>();
  for (const k of killsInRound) {
    const kv = k.killerIndex === null ? "NULL" : nameOf.get(k.killerIndex) ?? `p${k.killerIndex}`;
    const vv = nameOf.get(k.victimIndex) ?? `p${k.victimIndex}`;
    const tag = `KILL ${kv}→${vv} ${k.weapon}`;
    const list = eventsByTick.get(k.tick) ?? [];
    list.push(tag);
    eventsByTick.set(k.tick, list);
  }
  for (const b of plantsInRound) { const l = eventsByTick.get(b.tick) ?? []; l.push(`PLANT by ${nameOf.get(b.actorIndex)}`); eventsByTick.set(b.tick, l); }
  for (const b of defusesInRound) { const l = eventsByTick.get(b.tick) ?? []; l.push(`DEFUSE by ${nameOf.get(b.actorIndex)}`); eventsByTick.set(b.tick, l); }
  const endList = eventsByTick.get(round.endTick) ?? [];
  endList.push(`ROUND_END ${round.endReason} winner=${round.winnerTeamKey}`);
  eventsByTick.set(round.endTick, endList);

  console.log(`\n=== ${zipPath.split("/").pop()} round ${roundNumber} (${round.endReason}, winner=${round.winnerTeamKey}, endTick=${round.endTick}, freezeEndTick=${round.freezeEndTick ?? "?"}) ===`);
  console.log(`target players: ${names.join(", ")} → indices ${indices.join(",")}`);

  for (const pi of indices) {
    const track = rr.players.find((t) => t.playerIndex === pi);
    if (!track) { console.log(`  p${pi} ${nameOf.get(pi)}: no track in replay segment`); continue; }
    const money = decodeDelta(track.money);
    const equip = decodeDelta(track.equipValue);
    const hp = track.hp;
    const name = nameOf.get(pi)!;

    // player-economies comparison rows
    const econ = new Map<number, { start: number; spent: number }>();
    for (const e of playerEconomies.filter((e) => e.playerIndex === pi)) {
      econ.set(e.roundNumber, { start: e.startMoney, spent: e.moneySpent });
    }
    const e4 = econ.get(roundNumber);
    const e5 = econ.get(roundNumber + 1);

    console.log(`\n  ── p${pi} ${name} (${teamByPlayer.get(pi)}, in-round team award applies: ${teamByPlayer.get(pi) === tTeam ? "T-side (no)" : "CT-side (yes)"}) ──`);
    console.log(`  player-economies: startMoney(r${roundNumber})=${e4?.start} moneySpent(r${roundNumber})=${e4?.spent} startMoney(r${roundNumber + 1})=${e5?.start}`);

    const firstCash = money[0];
    const lastCash = money[money.length - 1];
    console.log(`  replay segment: ${rr.frameCount} frames, tickStep=${rr.tickStep}, firstCash=${firstCash}, lastCash=${lastCash}`);
    // buy-phase check: replay starts at freezeEndTick (after buytime) →
    //   firstCash should equal startMoney − moneySpent (if spent is the true
    //   net buy-phase outflow and no buy happens after freezeEndTick).
    if (e4) {
      const implied = e4.start - e4.spent;
      console.log(`  buy-phase net outflow check: startMoney − moneySpent = ${implied} vs replay firstCash = ${firstCash} → diff = ${firstCash - implied}`);
    }
    if (e5) {
      console.log(`  startMoney(r+1) vs replay lastCash: ${e5.start} vs ${lastCash} → diff = ${e5.start - lastCash}`);
    }

    // enumerate every nonzero cash jump with event context
    const jumps: CashJump[] = [];
    for (let f = 0; f < money.length - 1; f++) {
      const delta = money[f + 1]! - money[f]!;
      if (delta === 0) continue;
      const tick = rr.startTick + f * rr.tickStep;
      const phase = tick < round.endTick ? "live" : tick === round.endTick ? "round_end" : "post";
      const events: string[] = [];
      for (const [et, tags] of eventsByTick) {
        if (Math.abs(et - tick) <= rr.tickStep) events.push(...tags);
      }
      jumps.push({
        frame: f,
        tick,
        phase,
        cashBefore: money[f]!,
        cashAfter: money[f + 1]!,
        delta,
        events,
        equipDelta: equip[f + 1]! - equip[f]!,
        grenadeDelta: `${(track.grenades?.[f] ?? []).join("+")} → ${(track.grenades?.[f + 1] ?? []).join("+")}`,
      });
    }
    if (jumps.length === 0) { console.log(`  (no cash movement in replay segment)`); continue; }
    for (const j of jumps) {
      const ev = j.events.length ? ` | events: ${j.events.join("; ")}` : "";
      const eq = j.equipDelta !== 0 ? ` | equipΔ=${j.equipDelta}` : "";
      console.log(`  tick=${j.tick} frame=${j.frame} [${j.phase}] ${j.cashBefore} → ${j.cashAfter} (Δ${j.delta > 0 ? "+" : ""}${j.delta})${ev}${eq}`);
    }
  }

  // round result context
  console.log(`\n  round context: tElim(T killed) = ${killsInRound.filter((k) => k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === tTeam).length}, winner=${round.winnerTeamKey}`);
  if (next) console.log(`  next round ${next.roundNumber}: ${next.endReason} winner=${next.winnerTeamKey}`);
}

void main();
