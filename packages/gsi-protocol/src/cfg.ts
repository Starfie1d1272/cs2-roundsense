/**
 * Generation of the CS2 GSI configuration file (`gamestate_integration_*.cfg`).
 *
 * This file is written on the WINDOWS machine that runs CS2, into the game's
 * `csgo/cfg` directory (assumption A9 — exact path to be confirmed on
 * Windows). Valve documentation (assumption A7): buffer default 0.1s,
 * throttle default 1.0s, timeout default 1.1s; no UTF-8 BOM allowed (A8).
 */

export interface GsiCfgOptions {
  /** Local endpoint the game will POST to. Must be reachable from CS2. */
  uri: string;
  /** Event aggregation window in seconds. 0.0 disables buffering. */
  buffer?: number;
  /** Minimum seconds between POSTs after a 2XX response. */
  throttle?: number;
  /** POST timeout in seconds. */
  timeout?: number;
  /** Heartbeat interval in seconds (no state change → still POSTs). */
  heartbeat?: number;
  /** Optional auth token echoed back as JSON in the payload `auth` block. */
  token?: string;
  /** Precision for duration fields (countdowns, timers). */
  precisionTime?: number;
  /** Precision for positions. */
  precisionPosition?: number;
  /** Precision for vectors. */
  precisionVector?: number;
}

/**
 * Components a NORMAL PLAYER may subscribe to (assumption A1).
 * Spectator-only components (`bomb`, `phase_countdowns`, `allplayers_*`,
 * `allgrenades`, `player_position`) are intentionally NOT requested.
 */
export const NORMAL_PLAYER_COMPONENTS = [
  "provider",
  "map",
  "map_round_wins",
  "round",
  "player_id",
  "player_state",
  "player_weapons",
  "player_match_stats",
] as const;

export const DEFAULT_GSI_CFG: Required<
  Pick<GsiCfgOptions, "buffer" | "throttle" | "timeout" | "heartbeat">
> = {
  buffer: 0.1,
  throttle: 1.0,
  timeout: 1.1,
  heartbeat: 60.0,
};

const LINE = (k: string, v: string | number) => `  "${k}" "${v}"`;

/**
 * Render the cfg file text. Output is guaranteed BOM-free (A8) and uses the
 * Valve sample layout (`"Section v.X" { ... }`).
 */
export function renderGsiCfg(options: GsiCfgOptions): string {
  const buffer = options.buffer ?? DEFAULT_GSI_CFG.buffer;
  const throttle = options.throttle ?? DEFAULT_GSI_CFG.throttle;
  const timeout = options.timeout ?? DEFAULT_GSI_CFG.timeout;
  const heartbeat = options.heartbeat ?? DEFAULT_GSI_CFG.heartbeat;

  const lines: string[] = ['"RoundSense v.0.1"', "{"];
  lines.push(LINE("uri", options.uri));
  lines.push(LINE("timeout", timeout.toFixed(1)));
  lines.push(LINE("buffer", buffer.toFixed(1)));
  lines.push(LINE("throttle", throttle.toFixed(1)));
  lines.push(LINE("heartbeat", heartbeat.toFixed(1)));
  if (options.token) {
    lines.push("  \"auth\"", "  {", LINE("token", options.token), "  }");
  }
  lines.push("  \"output\"", "  {");
  lines.push(LINE("precision_time", (options.precisionTime ?? 3).toString()));
  lines.push(LINE("precision_position", (options.precisionPosition ?? 1).toString()));
  lines.push(LINE("precision_vector", (options.precisionVector ?? 3).toString()));
  lines.push("  }");
  lines.push("  \"data\"", "  {");
  for (const component of NORMAL_PLAYER_COMPONENTS) {
    lines.push(`    "${component}"            "1"`);
  }
  lines.push("  }");
  lines.push("}");
  return lines.join("\n") + "\n";
}

/** File name to place in the game's `csgo/cfg` directory (A8/A9). */
export function gsiCfgFileName(): string {
  return "gamestate_integration_roundsense.cfg";
}
