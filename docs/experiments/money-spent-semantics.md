# moneySpent Production Semantics Audit (2026-08-06)

Question: what exactly is `player-economies.moneySpent` — which tick is it
sampled at, is it gross or net, and why do buytime-tail purchases not appear?

## Production call chain (code-level)

`cs2-demo-format` exporter (python, cs2df):

1. `python/src/cs2df/parse.py:383-386`
   ```python
   freeze_ticks = sorted({int(r["tick"]) for r in round_freeze_ends ...})
   economy_raw = _rows(p.parse_ticks(
       ["steamid", "team_num", "cash_spent_this_round", "current_equip_value",
        "start_balance", "armor", "has_helmet", "has_defuser", "inventory"],
       ticks=freeze_ticks))
   ```
   → economy rows are sampled **once per round, at the tick of the
   `round_freeze_end` event** (demoparser2 per-tick snapshot).
2. `python/src/cs2df/events.py:661-671` → `moneySpent = cash_spent_this_round`,
   `startMoney = start_balance`, `equipmentValue = current_equip_value`.
3. demoparser2 maps these to CS2 game properties; the game-side field is
   `CCSPlayerController_InGameMoneyServices.m_iCashSpentThisRound`
   (int32; confirmed in GameTracking-CS2 `DumpSource2/schemas/server/
   CCSPlayerController_InGameMoneyServices.h`).

So `moneySpent` is the value of the game's per-round cumulative-spent
counter **at the freeze-end tick**.

## Replay reconciliation (42 tail-flow samples, stage3)

For every post-freeze buy/sellback event found by the replay scan:

- `startMoney − moneySpent == replay segment first cash` in **42/42** cases
  (diff = 0) → `moneySpent` never includes purchases after the freeze-end
  sampling tick, even though buytime continues for ~5s more (buytime 20s vs
  freezetime 15s).
- The three original diagnosed cases agree:
  luchov (buy 200 after freezeEnd, spent=1100, start−spent=firstCash),
  meyern (sellback +200 after freezeEnd), Boombl4 (buys 300+200 after
  freezeEnd, spent=1500 = pre-freeze only).

## Field contract suggestion (cs2-demo-format, NOT modified this round)

The current contract text (“本回合花费” / money spent this round) is
inaccurate as an exact cash-flow definition. Suggested wording (proposal
only — no cross-repo change was made):

> `moneySpent`：游戏原生 `m_iCashSpentThisRound` 在 `round_freeze_end`
> 时的快照。不包含 `round_freeze_end` 之后、buytime 关闭之前发生的购买
> 或退款。`sellback/refund` 对原生累计字段的影响尚未确认。

## Answers

1. **`moneySpent` covers which window?** — `[roundStart, round_freeze_end
   event tick]` (the freezetime window, 15s). Purchases/sellbacks in the
   buytime tail (freezeEnd → freezeEnd+~5s under H2) are NOT included.
2. **Gross or net?** — the game field is a cumulative counter of money
   spent (gross to the sampling tick). Whether sellbacks *inside* the
   window decrement it is not established by this audit (the observed
   sellback, meyern, is in the tail → outside the window). → unresolved.
3. **Why are post-freeze buys missing?** — the exporter deliberately
   samples at `round_freeze_end` ticks (one snapshot per round). It is an
   exporter design choice, not a parser truncation: demoparser2 can read
   the field at any tick, but cs2df only asks for freeze-end ticks.

## Field contract verdict

Current contract text (“本回合花费” / money spent this round) is
**inaccurate**. Precise contract:

```text
moneySpent = cumulative m_iCashSpentThisRound at the round_freeze_end tick
           = gross spend within [roundStart, freezeEnd] only;
             buytime-tail spend (freezeEnd → buyClose) is NOT included
```

Proposed contract wording (no schema change this round):

> “累计购买支出，采样于该回合 round_freeze_end 时点（即 freezetime 窗口内
> 的毛支出）；buytime 尾段（freezeEnd 至 buyClose，约 5 秒）的购买与卖回
> 不计入。sellback 是否抵扣窗口内累计值未验证。”

## Residual impact (task 3, bounded)

stage3 (84 matches, 16081 samples): 42 player-rounds have a post-freeze
buy/sellback tail flow; of those, **4 have nonzero ledger residuals**
(1 fully explained: MAJ3R −200 = −net; 3 partial). Scale:

- nonzero residuals total: 1595
- residual −200: 437 total, 3 with a tail flow
- residual +500: 194 total, 1 with a tail flow
- residual −500: 168 total, 0 with a tail flow
- residual +200: 30 total, 0 with a tail flow

→ buytime-tail flows explain at most ~0.25% of nonzero residuals
(4/1595). The ±200/±500 peaks are NOT buytime artifacts; their main source
remains the loss-counter model (one direct case: xiELO s3-r1-m1-m2 r14 —
replay settlement 2400 vs modeled 1900, with the −500 tail-buy error
cancelling the +500 counter error in the ledger residual).

## Still indistinguishable

- sellback/refund semantics of `m_iCashSpentThisRound` inside the window
- exact offset between the demo `round_freeze_end` event tick and
  `replay.rounds[].freezeEndTick` (same exporter, assumed equal)
- whether `start_balance` is sampled at the same freeze-end tick or at
  round start (it equals pre-buy balance; observed consistent with replay
  first cash + spent in all 42 samples)

Tools: `scripts/buytime-corpus-scan.ts --json`, `scripts/diagnose-cash-sources.ts`.
