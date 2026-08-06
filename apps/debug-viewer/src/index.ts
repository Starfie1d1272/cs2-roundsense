import { estimateRemainingDefault } from "@roundsense/c4-estimator";
import { replayNdjsonFile } from "@roundsense/replay-harness";

/**
 * Minimal debug CLI (NOT a HUD): replay a recorded NDJSON file and print the
 * C4 event timeline with remaining-time estimates.
 *
 * Usage: tsx src/index.ts <path-to.ndjson>
 */
async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: tsx src/index.ts <path-to.ndjson>");
    process.exit(1);
  }

  const result = await replayNdjsonFile(path);
  console.log(`records: ${result.recordCount}`);
  console.log(`final state: ${result.finalState.state} (round ${result.finalState.roundNumber ?? "-"})`);
  console.log(`events: ${result.events.length}`);
  for (const e of result.events) {
    const tSec = (Number(e.atMonotonicNs) / 1e9).toFixed(3);
    let extra = "";
    if (e.type === "planted" && e.plantedAtMonotonicNs !== undefined) {
      const est = estimateRemainingDefault(e.plantedAtMonotonicNs, e.atMonotonicNs);
      extra = ` est_remaining=${est.remainingMs.toFixed(0)}ms`;
    }
    console.log(`  [${tSec}s] ${e.type} r${e.roundNumber ?? "-"}${extra}${e.note ? ` (${e.note})` : ""}`);
  }
  if (result.finalState.state === "planted") {
    const est = estimateRemainingDefault(
      result.finalState.plantedAtMonotonicNs!,
      BigInt(Date.now()) * 1_000_000n, // placeholder — real clock only in live mode
    );
    console.log(`note: planted estimate shown with wall-clock placeholder; live mode uses monotonic clock`);
    void est;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
