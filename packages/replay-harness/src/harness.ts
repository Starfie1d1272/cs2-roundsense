import { readFile } from "node:fs/promises";
import { C4StateMachine, type C4Event, type C4MachineState } from "@roundsense/c4-estimator";
import type { RecordEnvelope } from "@roundsense/gsi-protocol";
import { normalizeRecord } from "./normalize.js";

export interface HarnessResult {
  events: C4Event[];
  finalState: Readonly<C4MachineState>;
  recordCount: number;
  /** per-event type counts (convenience for assertions) */
  counts: Record<string, number>;
}

/**
 * Deterministic replay: feeds records through normalize → state machine.
 * Replay NEVER reads the wall clock — all timestamps come from the recorded
 * envelope, so identical input yields identical output (acceptance: 相同
 * fixture 多次回放得到相同结果).
 */
export function replayRecords(records: Iterable<RecordEnvelope>): HarnessResult {
  const machine = new C4StateMachine();
  let recordCount = 0;
  for (const record of records) {
    machine.observe(normalizeRecord(record));
    recordCount++;
  }
  const counts: Record<string, number> = {};
  for (const e of machine.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  return { events: machine.events, finalState: machine.state, recordCount, counts };
}

export function parseNdjsonLine(line: string): RecordEnvelope | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed) as RecordEnvelope;
}

export async function replayNdjsonFile(path: string): Promise<HarnessResult> {
  const text = await readFile(path, "utf8");
  const records: RecordEnvelope[] = [];
  for (const line of text.split("\n")) {
    const record = parseNdjsonLine(line);
    if (record) records.push(record);
  }
  return replayRecords(records);
}

/** Resolve a fixture path: cwd-relative first, then repo-root fixtures dir. */
export function fixturePath(name: string): string {
  return `${process.cwd()}/fixtures/gsi/${name}`;
}
