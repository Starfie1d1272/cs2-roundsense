# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

TypeScript + CSS + vanilla DOM served by the local `apps/roundsense` Node HTTP/SSE service (no frontend framework; rendered in both browser preview and future Windows transparent overlay WebView).

## Users

Counter-Strike 2 competitive players playing live matches on Windows (with macOS/browser used for local development and QA). During the 15-second freezetime buy window, the player is under time pressure, splitting attention between team buy calls, radar/spawn, and the buy menu; outside matches, they open Settings once to finish GSI setup and tune HUD placement, scale, opacity, and AWP preference, then leave RoundSense running quietly in the background.

## Product Purpose

RoundSense is a local, read-only CS2 round-economy decision assistant. Instead of prescribing a single loadout, it answers the higher-leverage question first: **how much is this round worth spending, what can I buy within that budget, and if we lose, can I still full-buy next round?**

Success means:
- In-match: the player grasps all viable buy modes, spend bounds/costs, concrete purchases, and next-round loss cash/capability in a 1–2 second glance without reading prose or leaving the game flow.
- Out-of-match: the player finishes automatic CS2 GSI setup in one click (or recovers cleanly from missing/mismatched paths), previews the HUD against realistic offline scenarios without launching CS2, and rarely needs to open Settings again.

## Positioning

Unlike generic buy-script or loadout overlays that dictate one gun combo, RoundSense is built on Policy V3 structured economy bounds: it presents all valid tactical options side by side (ECO, 半起, 强起, 全起, 起 AWP) without artificially forcing a single pick unless the engine explicitly sets `defaultOptionId`, accounts for current inventory (including armor-to-helmet-only upgrades), and exposes concrete post-loss next-round affordability and conditional alternatives.

## Operating Context

- **Two distinct surfaces sharing one HUD renderer**:
  1. **In-match HUD Overlay (`/overlay`)**: Transparent, click-through, non-focus-stealing window shown only during live competitive freezetime for the local player. Automatically hides outside freezetime, during spectator/non-competitive modes, or on stale/interrupted GSI feeds (strict 2–5s freshness lease; never displays cached stale recommendations). Reports its actual rendered bounds to the native host (`set_overlay_state`).
  2. **Out-of-match Settings & Onboarding (`/`)**: Single-page local configuration tool. Used primarily on first install and occasional tuning; runs quietly in the background afterward. Settings auto-save immediately.
- **Data contract**: `HudSnapshot v2` (`apps/roundsense/src/hud/model.ts`) provides structured `money`, `lossIndex`, `roundContext`, `policyStatus`, `defaultOptionId`, `unresolved`, `settings`, and `options[]` (each with `mode`, `isDefault`, `adviceStrength`, `spendingGuidance`, `spend`, `maxSpendNow`, `purchases[]` including `helmetUpgradeOnly` and `quantity`, `lossNextMoney`, `lossWithPlantNextMoney`, `futureCapability`, and `conditionalAlternatives[]`).
- **GSI Onboarding API**: Local HTTP endpoints inspect, install (with backup), and restore `gamestate_integration_roundsense.cfg` across `READY`, `NEEDS_INSTALL` (missing / content mismatch), `NOT_FOUND`, and `ERROR` states, plus `otherGsiFiles` awareness.

## Capabilities and Constraints

- **Strict truthfulness & fair-play boundaries**:
  - Local, read-only, normal-player CS2 GSI only.
  - Never display exact opponent cash.
  - Never display uncalibrated C4 countdown timers.
  - Never fabricate or carry over recommendations across GSI gaps or incomplete inventory.
- **Language**: Simplified Chinese UI copy paired with universal CS2 weapon/economy abbreviations (`AK`, `M4A1-S`, `ECO`, `AWP`, etc.). No i18n switcher in scope.
- **Settings schema**: `awpPriority` (`NEUTRAL` | `PREFER` | `SAVE_FOR_AWP`), `position` (`below-radar` | `lower-left` | `lower-right`), `scale` (`0.8`–`1.5`), `opacity` (`0.45`–`0.95`).
- **Scope constraints for redesign**:
  - Replace the legacy UI and styles cleanly; do not keep legacy renderers or v1/v2 UI toggles.
  - Fix `discoverCs2()` so an explicit user-selected `preferredInstallPath` does not silently fall back to another CS2 installation when invalid.
  - Do not reopen Policy V3 economic research or Tauri packaging during the UI/UX rewrite.

## Brand Commitments

- **Name**: RoundSense (set-and-forget native-feeling CS2 utility; avoid developer-console or watermark presence inside the live HUD).
- **Assets**: Copy the required subset of CS2 weapon, equipment (including standalone helmet for `helmetUpgradeOnly`, armor, armor+helmet, defuse kit), utility, and side SVG silhouettes from `/Users/starfie1d/GitHub/Mizar/packages/cs2-assets/generated/public/assets/cs2/` into `apps/roundsense` so the app owns its assets independently.

## Evidence on Hand

- Live Policy V3 + HUD v2 runtime and 15 real HTTP GSI QA scenarios in `scripts/hud-scenarios.ts` (`ct-mid`, `t-rich`, `ct-low`, `retained-rifle`, `awp`, `save-awp`, `pistol-winner`, `pistol-loser`, `missing-loss`, `missing-inventory`, `pistol`, `overtime`, `live`, `stale`, `spectator`).
- CS2 SVG weapon/equipment/utility/side silhouettes and map radar images available in `/Users/starfie1d/GitHub/Mizar/packages/cs2-assets/generated/public/assets/cs2/`.
- No user testimonials, telemetry claims, or external marketing copy; do not invent any.

## Product Principles

1. **Glance before read**: In freezetime, structured numbers and native CS2 silhouettes carry the decision; prose stays out of the live HUD.
2. **Neutral clarity over forced prescription**: Show every valid policy option at equal structural weight; highlight a default only when `isDefault` is explicitly set by the engine.
3. **Truthful state boundaries**: Separate GSI config status from live game connection status; fail closed (hide or show explicit insufficient-state notice) whenever GSI freshness or inventory completeness is lost.
4. **Configure once, stay invisible**: Settings must work completely offline via built-in preview scenarios, save automatically, and hide engineering internals (tokens, ports, hashes, SSE) behind optional diagnostics.
5. **Native utility, not debug panel**: Both surfaces should feel like a calm, high-precision companion built for CS2 rather than a developer console.
