---
version: 1
slug: "ui-settings-html"
primary_target: "ui/settings.html"
related_targets: ["ui/overlay.html","ui/hud.css","ui/hud-client.js","ui/settings.js"]
---

# RoundSense UI Surface Brief

- **Mode:** Operate
- **Scope:** In-match transparent HUD overlay (`/overlay`) and out-of-match single-page Settings & GSI Onboarding (`/`), sharing one HUD renderer and CS2 SVG asset set.
- **Audience & job:** Competitive CS2 players making 1–2s buy-mode decisions in 15s freezetime, and configuring GSI + HUD placement/scale/opacity/AWP preference once out of match.

## Direction contract

THESIS: Swiss Timetable Precision — absolute column alignment, tabular numerals, native CS2 SVG weapon/equipment silhouettes, and next-round capability color coding; refuses rainbow buy-mode tags, watermark headers, and nested card chrome.

OWN-WORLD: Matte graphite ground (`#121519`), elevated rail (`#161A20`), 1px structural rules (`#252B34`), crisp off-white primary ink (`#F3F5F7`), slate secondary ink (`#96A1B0`), single emerald action/default accent (`#34D399`), and semantic next-round health colors (emerald full-buy, amber rifle+armor, muted slate insufficient) with sharp 0–2px geometry and 90ms state transitions.

STORY: In freezetime, the player scans mode, spend bound/cost, post-loss next cash (plus T plant delta when relevant), concrete SVG purchases (including standalone helmet upgrades and conditional alternatives), and next-round capability in one glance. Out of match, the player immediately sees GSI config status vs live game connection status, installs or repairs GSI in one click, and tunes HUD placement/scale/opacity against bright/dark offline CS2 preview scenes with instant auto-save.

FIRST VIEWPORT: Split workbench — left primary stage holds the 16:9 CS2 freezetime preview (with bright/dark backdrop + real radar + native CS2 HUD context + live positioned RoundSense HUD and scenario/backdrop switchers); right fixed 390px rail holds GSI Config & Live Connection status with the sole primary action button, HUD presentation controls (position segmented control, scale & opacity sliders), AWP preference segmented control, and collapsed technical diagnostics.

FORM: Candidate 6 (Swiss Timetable Precision) from grounded list; seed:7b5074c25636ae22. Raised with single-accent primary action discipline, direct post-loss visual continuation, and 90ms crisp state transitions.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
