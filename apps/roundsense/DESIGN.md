---
name: RoundSense
description: Swiss Timetable Precision UI system for CS2 freezetime economy HUD and single-page Settings.
colors:
  bg-ground: "#121519"
  bg-rail: "#161A20"
  bg-inset: "#101317"
  bg-control: "#1C212A"
  bg-control-active: "#252C38"
  border-rule: "#252B34"
  border-strong: "#353E4B"
  ink-primary: "#F3F5F7"
  ink-secondary: "#9AA6B6"
  ink-muted: "#8491A2"
  accent: "#34D399"
  accent-ink: "#07130E"
  cap-full: "#34D399"
  cap-rifle: "#F59E0B"
  cap-low: "#98A3B3"
  danger: "#F87171"
typography:
  brand:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.05em"
  hud-figure:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "13.5px"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "0em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0em"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "0.02em"
rounded:
  sharp: "0px"
  dot: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "20px"
  xl: "24px"
components:
  hud-panel:
    backgroundColor: "rgba(16, 19, 24, var(--hud-opacity))"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.sharp}"
    width: "264px"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.sharp}"
    padding: "8px 12px"
  button-ghost:
    backgroundColor: "{colors.bg-control}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.sharp}"
    padding: "8px 12px"
---

## Overview

RoundSense uses **Swiss Timetable Precision** across both its in-match transparent HUD overlay (`/overlay`) and its out-of-match Settings & GSI Onboarding workbench (`/`). The visual system optimizes for 1–2 second glanceability during CS2's 15-second freezetime and quiet set-and-forget utility outside matches.

## Colors

- **Neutral surfaces**: Matte graphite ground (`#121519`), elevated settings rail (`#161A20`), inset status wells (`#101317`), and crisp 1px structural rules (`#252B34`).
- **Single action/default accent**: Emerald (`#34D399`) is strictly reserved for the one primary user action in Settings (installing/fixing GSI) and for marking `isDefault` when Policy V3 explicitly designates a default option.
- **Semantic next-round capability**: Colors never encode buy-mode names (avoiding rainbow noise). Instead, color encodes next-round post-loss viability: emerald (`#34D399`) for full-buy capable, amber (`#F59E0B`) for rifle+armor only, and muted slate (`#98A3B3`) for insufficient cash.

## Typography

- **Single system sans stack** with `font-variant-numeric: tabular-nums` on all HUD tables, sliders, and money readouts so columns lock vertically across updates.
- **No decorative monospace or display fonts**: emphasis comes from weight (`700` on mode names and key figures) and column alignment.

## Layout

- **In-match HUD (`.rs-hud`)**: Fixed 3-column timetable grid (`58px 1fr 72px` within `264px` width, aligning cleanly with the left edge of CS2's top team avatars across 4:3, 16:10, and 16:9), followed by a native CS2 SVG gear silhouette row and optional dashed conditional-alternative row. Zero brand watermark inside the live HUD.
- **Settings Workbench (`.rs-workbench`)**: Desktop split layout with a fluid left 16:9 CS2 freezetime preview stage (supporting bright/dark backdrops, optional real CS2 screenshots at `/assets/preview/bright.webp` and `dark.webp`, and 5 built-in offline scenarios + live match feed) paired with a fixed `390px` right control rail. Below `980px`, stacks into a single column; below `720px`, the stage centers the unclipped HUD cleanly.

## Elevation & Depth

- Flat architectural layering separated by 1px rules and subtle tonal steps (`#101317` → `#121519` → `#161A20` → `#1C212A`).
- No backdrop-filter blur, glowing borders, or decorative drop shadows.

## Shapes

- Sharp `0px` structural corners across panels, buttons, segmented controls, and range thumbs; circular `50%` dots reserved strictly for connection/status indicators.

## Components

- **Shared HUD Renderer (`ui/hud-renderer.js`)**: Pure DOM renderer consuming `HudSnapshot v2`, mapping all CS2 items to `/assets/cs2/*.svg` silhouettes, using `helmet_only.svg` with a `+` cue for `helmetUpgradeOnly`, displaying `$0` for `PRESERVE` zero-spend rows, and surfacing T-side `+包` post-loss deltas and localized conditional alternatives.
- **GSI Status & Onboarding Panel**: Explicitly separates **GSI 配置** (`READY`, `NEEDS_INSTALL`, `NOT_FOUND`, `ERROR`) from **CS2 对局** live connection state, with inline manual directory selection and collapsed technical diagnostics.
- **Auto-saving Controls**: Segmented controls for position and AWP preference plus custom-styled range sliders for scale (`80%–150%`) and opacity (`45%–95%`) persist immediately to `POST /settings`.

## Do's and Don'ts

- **Do** keep all viable buy options at equal structural weight unless `option.isDefault` is explicitly true.
- **Do** use native CS2 SVG silhouettes from `ui/assets/cs2/` instead of text-only item lists or emoji/Unicode stand-ins.
- **Don't** add brand watermarks, oversized current-cash hero headers, or per-mode rainbow colors to the live HUD.
- **Don't** expose GSI tokens, ports, or PowerShell setup instructions in the main Settings flow.
