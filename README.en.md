# RoundSense

[简体中文](README.md) | **English**

**A read-only, zero-injection CS2 freezetime economy decision HUD.**  
During every 15-second freezetime, RoundSense appears below your radar so you can answer three high-leverage questions in a 1–2 second glance: **how much is this round worth spending, what can I buy within that budget, and if we lose, can I still full-buy next round?** It hides automatically once the round goes live.

---

## Why RoundSense?

Most CS2 buy helpers either dictate a single rigid loadout or hook into the game process. RoundSense distills its buy logic from **IEM Cologne Major 2026 pro match demos (200+ maps, 20,000+ valid player-rounds)** and lays out every viable route side by side with its next-round consequences:

1. **Help newer players truly understand CS2 economy**  
   No more memorizing rigid rules of thumb. See how pro players actually navigate full buys, forces, light buys, and ecos—and immediately understand *why* a round calls for a light buy cap or a full save.
2. **Keep experienced players & IGLs from tilt-forcing**  
   In close matches or loss streaks, it is easy to impulse-force without doing the math. RoundSense puts the **exact cost of forcing** right in front of you—what your bank and next-round buy capability will look like if you lose—so you and your team can make calm calls within 15 seconds.

> Curious about the methodology and validation data? See the [Research Archive Index](docs/research-index.md) (in Chinese).

---

## Reading the HUD in 30 Seconds

![RoundSense In-Match HUD Showcase](docs/assets/hud-showcase.png)

The live overlay contains only what you need to decide in a glance—zero prose, zero clutter:

- **Mode column**: Shows only the most meaningful buy options (`Full`, `Force`, `Light`, `ECO`, `AWP`) alongside their next-round consequences—no redundant force row when a clean full buy is available.
- **Spend column**: Shows exact cost for fixed buys, or a **spend cap (e.g. `≤ $1,300`)** paired with a suggested loadout cost (`$1,150`) for flexible light buys so you can adapt to your spawn and team call.
- **Gear silhouettes**: Native CS2 weapon, armor (including standalone `+helmet` upgrades), defuse kit, and utility icons, plus dashed conditional notes when relevant (e.g. swapping a utility slot or picking up a kit if teammates lack one).
- **Standard post-loss cash & next-round capability**: Projects your standard loss-no-plant next-round cash (no extra kills; excludes the T-side timeout-alive zero-loss-bonus branch, and marks halftime/match-point resets explicitly) and color-codes what you can afford:
  - **Emerald (Full Utility / AWP Ready)**: Enough for a full-utility rifle buy (or AWP + Kevlar) next round even if you lose.
  - **Teal (Basic Rifle Buy)**: Enough for rifle, armor, and basic smoke/flash, though full utility/kit/helmet will be tight.
  - **Amber (Rifle + Armor)**: Enough for rifle + armor only, with almost no utility budget.
  - **Slate (Insufficient)**: Spending this much risks breaking your next-round rifle buy.
  - **T-side `+Plant`**: Also shows your post-loss cash with a bomb plant bonus.

---

## Does This Buy Advice Actually Hold Up? (Two-Major Blind Replay)

Every CS2 player asks the same question: **"Is this actually better than buying by gut feel?"**

To test it honestly, we studied pro buying habits across **IEM Cologne Major 2026** (202 maps), **froze the rules**, and then ran them untouched—zero tuning—on a completely separate Major: **PGL Singapore Major 2026 · Stage 1** (53 new maps, 7,062 rounds), feeding it only the cash and gear a normal player sees in freezetime:

![RoundSense Cross-Event Out-of-Sample Validation (Cologne vs Singapore Stage 1)](docs/assets/cross-event-validation.png)

Three things you actually feel in-game (from the **Singapore Major blind test**, comparing only the #1 top suggestion):

- **Buys closer to pro habits**: **74.4%** of rounds land within one grenade (**$400**) of actual pro spend ($460 average gap overall, and just **$272** when carrying gear over).
- **Far less likely to break next round**: After losing a normal round, you can still full-buy next round **45.6%** of the time (**+9.9 percentage points** over "buy the best gun you can afford") while keeping rifle/AWP firepower on **87.6%** of rounds.
- **Smarter helmet & utility calls, zero bad math**: **77.4%** main weapon match, **83.9%** CT helmet-vs-utility match, and **0** over-budget, wrong-side, or duplicate suggestions across the entire event.

What does that look like in a real match?

| Common Round | Typical Pitfall | What RoundSense Suggests |
| :--- | :--- | :--- |
| **T · $3,850** (normal) | Forcing bare AK + Vesthelm with 0 grenades | **Galil + Vesthelm + Smoke/Molotov/Flash** for a full execute |
| **CT · $4,850** (normal) | Auto-buying helmet and running dry on utility | **M4 + Kevlar + 4 grenades** (tops up helmet with spare cash; optional kit note) |
| **CT · $3,450** (1 loss) | Spending everything and breaking next round, or AFK $0 | **Light buy cap `≤ $1,300`** (protects next full buy) alongside ECO / Force |

<details>
<summary>Full technical cross-event table (4 strategies · Cologne study set vs. Singapore S1 blind test)</summary>

| Strict 1-vs-1 Lead Metric (All Eligible Rounds) | Cologne Study Set (`n=28,594`) | Singapore S1 Blind Test (`n=7,062`) |
| :--- | ---: | ---: |
| **Lead spend MAE** (vs. B0 / B1 / B2) | **$472** (vs. $555 / $490 / $539) | **$460** (vs. $547 / $461 / $527) |
| **Lead spend within $400** | **73.2%** (vs. 66.7% / 64.2% / 72.0%) | **74.4%** (vs. 68.1% / 67.4% / 74.0%) |
| **Lead primary weapon family match** | **76.8%** (vs. 69.2% / 77.5% / 72.1%) | **77.4%** (vs. 69.6% / 77.6% / 72.7%) |
| **CT normal-round helmet match** | **83.0%** (vs. 71.7% / 80.8% / 76.7%) | **83.9%** (vs. 68.6% / 82.7% / 74.2%) |
| **Current rifle/AWP · Next-round full-buy** (pro: 73.1%·51.6% / 76.4%·51.9%) | **86.4% · 44.3%** (B0 86.7%·33.3% / B1 75.3%·51.6%) | **87.6% · 45.6%** (B0 88.8%·35.7% / B1 78.3%·51.3%) |
| **Option-set within $400 / avg options** | **81.8% / 1.55** | **82.6% / 1.52** |
| **Mechanical audit (illegal/cap / duplicate / light-floor)** | **0 / 0 / 0** (legacy V3: 0 / 10,208 / 1,904) | **0 / 0 / 0** (legacy V3: 0 / 2,524 / 369) |

- Reproducible unified script (`replay.json` end-of-round state recovery): [cross-event-replay-benchmark.ts](scripts/cross-event-replay-benchmark.ts)
- Machine-readable reports: [cologne-cross-event-benchmark.json](docs/data/cologne-cross-event-benchmark.json) · [singapore-s1-cross-event-benchmark.json](docs/data/singapore-s1-cross-event-benchmark.json)

</details>

- *Note: Historical freezetime decision replay. Singapore Stage 1 was never used to tune any policy rule; results are reported verbatim and measure decision quality & economy continuity rather than win-rate guarantees.*

---

## Key Features

- **Portable & ready to run**: The Windows portable ZIP bundles a self-contained Node runtime and local backend—no Node, pnpm, or Rust installation required.
- **Strictly read-only & VAC-safe**: Uses only CS2’s official local HTTP Game State Integration (`127.0.0.1:3001`) and read-only Win32 window geometry. **Never reads or writes game memory, and never injects into `cs2.exe`.**
- **Honest boundaries**: Never fabricates exact opponent cash or uncalibrated C4 countdown timers. Automatically hides outside freezetime, while spectating, on Alt+Tab, or when GSI data goes stale.
- **Three economy roles**: Supports **Rifler**, **AWPer**, and **Jame Save-for-AWP** (adds an ECO save line when saving unlocks AWP + Kevlar next round).
- **One-click GSI setup & offline preview**: Auto-discovers your Steam / CS2 folder, detects same-port GSI conflicts, backs up existing configs, and lets you tune HUD position, scale, and opacity against bright/dark offline CS2 scenes before launching the game.
- **Quiet desktop utility**: Single-instance, minimizes to system tray, click-through overlay that never steals focus, and cleans up background processes cleanly via Windows Job Objects.

---

## Settings & Offline Preview Workbench

![RoundSense Settings & Offline Preview Workbench](docs/assets/workbench-preview.png)

## Getting Started (Windows 10 / 11)

> Requirements: Windows 10 / 11 (64-bit) with Microsoft Edge WebView2 Runtime (pre-installed on Windows 11).  
> **Important**: Set CS2 to **Fullscreen Windowed** (or Windowed) so the transparent desktop overlay can render over the game.

1. Download the Windows portable ZIP from GitHub Releases / Actions and extract it to any folder.
2. Run `RoundSense.exe` to open the Settings & Preview window.
3. In the right-hand **Game Integration & Connection** panel, click **One-Click Install GSI Config** (or click **Browse…** if CS2 is in a custom library).
4. Adjust HUD placement (below radar / lower-left / lower-right), scale, opacity, and economy role—changes preview live and auto-save immediately.
5. Launch (or restart) CS2 into Competitive mode. The HUD appears during freezetime and hides automatically when the round starts or when you Alt+Tab.
6. Close the Settings window anytime to keep RoundSense running quietly in the system tray; right-click the tray icon and choose **Quit RoundSense** to exit completely.

---

## FAQ

**Q: How does RoundSense interact with CS2, and what are its safety boundaries?**  
RoundSense relies exclusively on Valve’s official local Game State Integration (GSI) HTTP feed and renders an external transparent OS overlay window. It **never reads or writes game memory, never injects DLLs into `cs2.exe`, never hooks game rendering, and never simulates keyboard/mouse input**. While no third-party tool can speak for Valve with an absolute guarantee, RoundSense is strictly engineered to stay within official read-only boundaries.

**Q: Why does CS2 need to be in Fullscreen Windowed mode?**  
Because RoundSense refuses to inject into the game process, the HUD renders as a separate transparent OS window. Exclusive fullscreen lets the display driver bypass desktop windows, whereas Fullscreen Windowed displays the overlay cleanly with zero injection.

**Q: Why doesn’t the HUD show during pistol rounds, live rounds, or spectating?**  
By design: it hides during live play so it never obstructs vision, stays out of pistol rounds (where buys are highly personal/tactical), and hides when spectating or in non-competitive modes.

---

## Local Data & Logs

- **Windows**: `%LOCALAPPDATA%\RoundSense\` (`hud-settings.json`, `gsi-token`, `gsi-backups\`, `logs\sidecar.log`)
- **macOS / Linux (dev mode)**: `~/.config/RoundSense/`

---

## Developer Guide

```bash
# Install dependencies (Node >= 24.21, pnpm 12.9.1)
pnpm install

# Start local HUD service (open http://127.0.0.1:3100/ in your browser)
pnpm hud

# Format, lint, typecheck, and run tests
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test

# Build single-file desktop sidecar
pnpm --filter @roundsense/desktop build:sidecar

# Build desktop host and package Windows portable ZIP (run on Windows)
cargo build --release --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @roundsense/desktop package:win
```

## Repository Structure

- `apps/desktop/` — Tauri v2 native desktop host (single instance, system tray, Node sidecar lifecycle, Win32 CS2 overlay placement)
- `apps/roundsense/` — Local HUD/GSI HTTP+SSE service, CS2 GSI auto-onboarding, and shared HUD / Settings UI
- `packages/economy-advisor/` — CS2 competitive economy rules and Policy V3 recommendation engine
- `packages/gsi-protocol/` — CS2 GSI HTTP receiver, token auth, and payload parsing
- `packages/c4-estimator/`, `packages/replay-harness/`, `packages/shared-types/` — Shared types and replay test infrastructure
- `docs/` — [Research Index](docs/research-index.md), [Policy V3 Architecture Lock](docs/policy-v3-architecture.md), and [Final Acceptance Report](docs/experiments/policy-v3-final-acceptance.md)

## License

MIT
