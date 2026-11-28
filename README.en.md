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

- **Mode column**: Lists every viable option for your current bank (`Full`, `Force`, `Light`, `ECO`, `AWP`) at equal weight, highlighting a default only when pro-level logic strongly converges.
- **Spend column**: Shows exact cost for fixed buys, or a **spend cap (e.g. `≤ $1,300`)** paired with a suggested loadout cost (`$1,150`) for flexible light buys so you can adapt to your spawn and team call.
- **Gear silhouettes**: Native CS2 weapon, armor (including standalone `+helmet` upgrades), defuse kit, and utility icons, plus dashed conditional notes when relevant (e.g. swapping a utility slot or picking up a kit if teammates lack one).
- **Post-loss cash & next-round capability**: Projects your conservative next-round cash (loss without plant or extra kills) and color-codes what you can afford:
  - **Emerald (Full Utility / AWP Ready)**: Enough for a full-utility rifle buy (or AWP + Kevlar) next round even if you lose.
  - **Teal (Basic Rifle Buy)**: Enough for rifle, armor, and basic smoke/flash, though full utility/kit/helmet will be tight.
  - **Amber (Rifle + Armor)**: Enough for rifle + armor only, with almost no utility budget.
  - **Slate (Insufficient)**: Spending this much risks breaking your next-round rifle buy.
  - **T-side `+Plant`**: Also shows your post-loss cash with a bomb plant bonus.

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

**Q: Can RoundSense trigger VAC?**  
No. RoundSense relies exclusively on Valve’s official local Game State Integration (GSI) HTTP feed and an external transparent overlay window. It **never reads/modifies game memory and never injects DLLs into `cs2.exe`**.

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
