/**
 * Runtime-audit extractor (Mac side).
 *
 * Inputs:
 *   - GSI NDJSON (recorder format: one JSON per line, `payload` key optional)
 *   - the matching cs2-demo-format v3 ZIP (exported after the Windows run)
 *   - optional convar dump file (--convars <path>, one `name value` per line)
 *
 * Output (stdout JSON):
 *   cells: [{ round, targetSide, winReason, directStateBefore, directStateAfter,
 *             nextLossPayout, convars: {...} | null }]
 *
 * DIRECT state comes ONLY from GSI map.team_ct/team_t.consecutive_round_losses
 * (or the demo netvar fallback) — if the field is absent on the current
 * build, directState* is null and the caller must treat the row as
 * modeled/precondition, NOT direct.
 *
 * Win-reason → target side (the side that WINS the cell round):
 *   time_ran_out → CT, bomb_defused → CT, target_bombed → T,
 *   elimination → explicit (--target-side ct|t).
 */
import { readFileSync } from "node:fs";

export interface CellRow {
  round: number;
  targetSide: "CT" | "T" | null;
  winReason: string | null;
  directStateBefore: number | null;
  directStateAfter: number | null;
  nextLossPayout: number | null;
  convars: Record<string, string> | null;
}

interface GsiPayload {
  map?: { round?: number; team_ct?: { consecutive_round_losses?: number }; team_t?: { consecutive_round_losses?: number } };
  round?: { phase?: string; win_team?: string };
}

const TARGET_SIDE: Record<string, "CT" | "T"> = {
  time_ran_out: "CT",
  bomb_defused: "CT",
  target_bombed: "T",
};

/** Parse recorder NDJSON → per-round payload samples. */
export function parseGsiNdjson(text: string): { round: number; payload: GsiPayload }[] {
  const out: { round: number; payload: GsiPayload }[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const raw = JSON.parse(line) as { payload?: GsiPayload; receivedAt?: string };
    const payload = (raw.payload ?? raw) as GsiPayload;
    const round = payload.map?.round;
    if (round === undefined) continue;
    out.push({ round, payload });
  }
  return out;
}

/** Latest observed consecutive-loss state per round, per team key. */
export function directLossStates(
  samples: { round: number; payload: GsiPayload }[],
): Map<number, { ct: number | null; t: number | null }> {
  const last = new Map<number, { ct: number | null; t: number | null }>();
  for (const s of samples) {
    const prev = last.get(s.round) ?? { ct: null, t: null };
    const ct = s.payload.map?.team_ct?.consecutive_round_losses;
    const t = s.payload.map?.team_t?.consecutive_round_losses;
    if (ct !== undefined) prev.ct = ct;
    if (t !== undefined) prev.t = t;
    last.set(s.round, prev);
  }
  return last;
}

export interface V3Context {
  rounds: { roundNumber: number; endReason: string; winnerTeamKey: string }[];
  /** per (round, playerIndex) next-round startMoney — for loss payout, use
   * the replay settlement when present; otherwise income-difference of the
   * losing side is out of scope here (payout: null). */
  payouts: Map<number, number[]>;
}

/** Read v3 ZIP (JSON files inline) — tiny loader, no heavy deps beyond zip. */
export function loadV3Context(zipPath: string, zipLoader: (p: string) => Promise<Uint8Array>): Promise<V3Context> {
  return zipLoader(zipPath).then((buf) => {
    // Minimal zip reading for the audit kit is done via the demo-oracle
    // adapter by callers; this stub keeps the contract explicit.
    void buf;
    throw new Error("loadV3Context: use demo-oracle loadDemoPackage instead (see main)");
  });
}

export function extract(
  samples: { round: number; payload: GsiPayload }[],
  rounds: { roundNumber: number; endReason: string; winnerTeamKey: string }[],
  convars: Record<string, string> | null,
  explicitElimSide: "CT" | "T" | null,
): CellRow[] {
  const states = directLossStates(samples);
  const cells: CellRow[] = [];
  for (const r of rounds) {
    const st = states.get(r.roundNumber);
    if (!st) continue; // no GSI observation for this round — skip (not direct)
    const targetSide = TARGET_SIDE[r.endReason] ?? (r.endReason === "ct_win" || r.endReason === "t_win" ? explicitElimSide : null);
    const before = st.ct ?? st.t; // per-cell: caller maps side; CT state is the
    // primary observed field in the controlled setup (target side is CT for
    // 3 of 4 win reasons) — team_t used when CT absent.
    const after = st.ct ?? st.t;
    cells.push({
      round: r.roundNumber,
      targetSide,
      winReason: r.endReason,
      directStateBefore: before,
      directStateAfter: after,
      nextLossPayout: null, // filled by the caller from the demo replay settlement
      convars,
    });
  }
  return cells;
}

export function parseConvars(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^(\S+)\s+(.+)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const ndjsonPath = args[0];
  if (!ndjsonPath) {
    console.error("usage: tsx extract-runtime-audit.ts <gsi.ndjson> [--rounds <rounds.json>] [--convars <file>] [--target-side ct|t]");
    process.exit(1);
  }
  const roundsPath = args.indexOf("--rounds") >= 0 ? args[args.indexOf("--rounds") + 1] : null;
  const convarsPath = args.indexOf("--convars") >= 0 ? args[args.indexOf("--convars") + 1] : null;
  const explicitSide = args.indexOf("--target-side") >= 0 ? (args[args.indexOf("--target-side") + 1] as "CT" | "T") : null;
  const samples = parseGsiNdjson(readFileSync(ndjsonPath, "utf8"));
  const rounds = roundsPath
    ? (JSON.parse(readFileSync(roundsPath, "utf8")) as { roundNumber: number; endReason: string; winnerTeamKey: string }[])
    : [...new Map(samples.map((s) => [s.round, null])).keys()].map((roundNumber) => ({ roundNumber, endReason: "unknown", winnerTeamKey: "teamA" }));
  const convars = convarsPath ? parseConvars(readFileSync(convarsPath, "utf8")) : null;
  const cells = extract(samples, rounds, convars, explicitSide);
  console.log(JSON.stringify({ cells }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
