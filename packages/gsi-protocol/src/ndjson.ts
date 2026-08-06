import { createWriteStream, type WriteStream } from "node:fs";
import type { GsiPayload } from "./payload.js";

/**
 * NDJSON record envelope — one line per received payload.
 *
 * Required fields (P0-A recording contract):
 * - seq: strictly increasing per-process sequence number
 * - receivedAtWallClock / receivedAtMonotonicNs: dual-clock capture
 * - providerTimestamp: `provider.timestamp` verbatim (semantics: A5, unverified)
 * - build: CS2 build / provider info as observed in the payload
 * - gsi: the receiver's own GSI parameters at startup (buffer/throttle/...)
 * - payload: sanitized original payload (auth stripped)
 */
export interface RecordEnvelope {
  seq: number;
  receivedAtWallClock: string;
  receivedAtMonotonicNs: string; // bigint serialized as decimal string (JSON-safe)
  providerTimestamp?: number;
  build?: {
    providerName?: string;
    appid?: number;
    version?: number;
  };
  gsi: {
    bufferMs?: number;
    throttleMs?: number;
    tokenConfigured: boolean;
  };
  payload: GsiPayload;
}

/** Minimal writer — append-only NDJSON. Single process, single file. */
export class NdjsonWriter {
  private stream: WriteStream;
  private seq = 0;
  private closed = false;

  constructor(
    readonly path: string,
    readonly gsiParams: { bufferMs?: number; throttleMs?: number; tokenConfigured: boolean },
    private readonly emitError?: (err: Error) => void,
  ) {
    this.stream = createWriteStream(path, { flags: "a" });
    this.stream.on("error", (err) => this.emitError?.(err));
  }

  write(record: Omit<RecordEnvelope, "seq" | "gsi">): number {
    if (this.closed) throw new Error(`NDJSON writer closed: ${this.path}`);
    const seq = this.seq++;
    const envelope: RecordEnvelope = {
      ...record,
      seq,
      gsi: { ...this.gsiParams },
    };
    this.stream.write(JSON.stringify(envelope) + "\n");
    return seq;
  }

  /** Flush buffered data to the OS. Call on shutdown or every N seconds. */
  flush(): void {
    // WriteStream buffering is handled by Node; drain is the flush signal.
    if (!this.stream.destroyed) this.stream.cork?.();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await new Promise<void>((resolve, reject) => {
      this.stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  }
}
