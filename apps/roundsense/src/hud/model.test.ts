import { describe, expect, it } from "vitest";
import type { GsiPayload, GsiReceipt } from "@roundsense/gsi-protocol";
import { DEFAULT_HUD_SETTINGS, HudRuntime } from "./model.js";

const SELF = "76561198000000001";
export function payload(over: Partial<GsiPayload> = {}): GsiPayload {
  return {
    provider: { appid: 730, steamid: SELF },
    map: {
      name: "de_mirage",
      mode: "competitive",
      phase: "live",
      round: 8,
      team_ct: { score: 4, consecutive_round_losses: 1 },
      team_t: { score: 3, consecutive_round_losses: 1 },
    },
    round: { phase: "freezetime" },
    player: {
      steamid: SELF,
      activity: "playing",
      team: "CT",
      state: { money: 3450, armor: 0, helmet: false, defusekit: false },
      weapons: {},
    },
    ...over,
  };
}
export function receipt(
  data: GsiPayload = payload(),
  seq = 0,
  timeMs = 0,
): GsiReceipt {
  return {
    payload: data,
    seq,
    receivedAtWallClock: "2026-10-07T00:00:00.000Z",
    receivedAtMonotonicNs: BigInt(timeMs) * 1_000_000n,
  };
}
function lifecycle(runtime: HudRuntime, skip = false) {
  const pistol = payload();
  pistol.map!.round = 1;
  runtime.observe(receipt(pistol, 0));
  runtime.observe(receipt({ ...pistol, round: { phase: "live" } }, 1, 100));
  runtime.observe(
    receipt(
      {
        ...pistol,
        map: { ...pistol.map, round: 2 },
        player: undefined,
        round: { phase: "over", win_team: "CT" },
      },
      skip ? 3 : 2,
      200,
    ),
  );
  const after = payload();
  after.map!.round = 2;
  runtime.observe(receipt(after, skip ? 4 : 3, 300));
}

describe("live HUD semantics", () => {
  it("shows every option with real spending and loss projections", () => {
    const runtime = new HudRuntime();
    runtime.observe(receipt());
    const out = runtime.snapshot(0n);
    expect(out.visible).toBe(true);
    expect(out.cards.map((c) => c.title)).toEqual(["强起", "半起", "ECO"]);
    expect(out.cards.find((c) => c.title === "半起")).toMatchObject({
      budgetLabel: "投入 ≤",
      budget: 1300,
      spend: 1150,
      nextMoney: 4200,
      capability: "长枪甲道具",
      qualifier: "可选",
    });
    expect(out.cards.find((c) => c.title === "ECO")).toMatchObject({
      spend: 0,
      nextMoney: 5350,
      purchases: "无需购买",
    });
    expect(out.cards).toHaveLength(out.options.length);
  });
  it.each(["live", "over", undefined])(
    "hides outside explicit freezetime: %s",
    (phase) => {
      const runtime = new HudRuntime();
      runtime.observe(receipt(payload({ round: { phase } })));
      expect(runtime.snapshot(0n)).toMatchObject({
        visible: false,
        cards: [],
        hiddenReason: "outside-freezetime",
      });
    },
  );
  it("expires without a new packet and never returns the old cards", () => {
    const runtime = new HudRuntime();
    runtime.observe(receipt());
    expect(runtime.snapshot(5_001_000_000n)).toMatchObject({
      visible: false,
      cards: [],
      options: [],
      hiddenReason: "stale",
    });
  });
  it("hides warmup, foreign player, menu and noncompetitive source", () => {
    const examples = [
      payload({ map: { ...payload().map, phase: "warmup" } }),
      payload({
        player: { ...payload().player, steamid: "76561198000000002" },
      }),
      payload({ player: undefined }),
      payload({ map: { ...payload().map, mode: "deathmatch" } }),
    ];
    for (const data of examples) {
      const runtime = new HudRuntime();
      runtime.observe(receipt(data));
      expect(runtime.snapshot(0n).visible).toBe(false);
    }
  });
  it("does not reuse last round's inventory from a partial current frame", () => {
    const runtime = new HudRuntime();
    runtime.observe(receipt());
    runtime.observe(
      receipt(
        payload({ player: { ...payload().player, weapons: undefined } }),
        1,
        50,
      ),
    );
    expect(runtime.snapshot(50_000_000n).cards).toEqual([
      expect.objectContaining({
        title: "信息不足",
        spend: null,
        nextMoney: null,
        budget: null,
      }),
    ]);
  });
  it("shows missing loss state and pistol unsupported without made-up amounts", () => {
    for (const data of [
      payload({ map: { ...payload().map, team_ct: { score: 4 } } }),
      payload({ map: { ...payload().map, round: 1 } }),
    ]) {
      const runtime = new HudRuntime();
      runtime.observe(receipt(data));
      expect(runtime.snapshot(0n).cards[0]).toMatchObject({
        spend: null,
        nextMoney: null,
        budget: null,
      });
    }
  });
  it("preserves post-pistol winner through a terminal frame without player fields", () => {
    const runtime = new HudRuntime();
    lifecycle(runtime);
    expect(
      runtime.snapshot(300_000_000n).cards.some((c) => c.title === "全起"),
    ).toBe(true);
  });
  it("retains complete history when changing presentation settings", () => {
    const runtime = new HudRuntime();
    lifecycle(runtime);
    const before = runtime.snapshot(300_000_000n).cards;
    runtime.updateSettings({ ...DEFAULT_HUD_SETTINGS, scale: 1.2 });
    expect(runtime.snapshot(300_000_000n).cards).toEqual(before);
  });
  it("does not recover an unseen pistol winner across a sequence gap", () => {
    const runtime = new HudRuntime();
    lifecycle(runtime, true);
    expect(runtime.snapshot(300_000_000n).cards.map((c) => c.title)).toEqual([
      "ECO",
      "强起",
    ]);
  });
  it.each([6_000, 250])(
    "discards known winner history after a time gap or clock rollback: %sms",
    (timeMs) => {
      const runtime = new HudRuntime();
      lifecycle(runtime);
      expect(runtime.snapshot(300_000_000n).cards.some((c) => c.title === "全起")).toBe(true);
      const next = payload();
      next.map!.round = 2;
      runtime.observe(receipt(next, 4, timeMs));
      expect(runtime.snapshot(BigInt(timeMs) * 1_000_000n).cards.map((c) => c.title)).toEqual(["ECO", "强起"]);
    },
  );
  it("supports explicitly declared AWP preference without suppressing other options", () => {
    const runtime = new HudRuntime();
    runtime.updateSettings({ ...DEFAULT_HUD_SETTINGS, awpPriority: "PREFER" });
    runtime.observe(
      receipt(
        payload({
          player: {
            ...payload().player,
            state: { ...payload().player!.state, money: 7000 },
          },
        }),
      ),
    );
    const cards = runtime.snapshot(0n).cards;
    expect(cards[0]).toMatchObject({ title: "起 AWP", qualifier: "优先" });
    expect(cards.length).toBeGreaterThan(1);
  });
});
