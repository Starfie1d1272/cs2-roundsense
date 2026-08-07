#!/usr/bin/env python3
"""RoundSense Final Pipeline — plotting stage (closeout).

10 individual curves (T/CT x lossReward 1400..3400, retained=none) +
1 overview 2x5 grid. Human-readable only; CSV keeps the full $0-16000/$50 grid.

Rules:
- OBSERVED/INTERPOLATED -> solid line within contiguous runs
- INTERPOLATED_WIDE    -> dashed line within contiguous runs
- EXTRAPOLATED/LOW_SUPPORT -> NO probability curve, NO probability dots;
  only a very light gray x-range background is allowed.
- No pistol annotation, no observed-money markers.
- full>=50% / full>=80% crossings computed in supported region only.
- Legend: each class label is added on its FIRST ACTUALLY DRAWN run.
Run with DAK venv python + env -u PYTHONPATH (matplotlib lives there).
"""
import csv, json, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "cologne-2026")
POL = list(csv.DictReader(open(f"{OUT}/economy-reference-surface.csv")))
COLORS = {"eco": "#228b22", "semi": "#e67e00", "force": "#1e50c8", "full": "#c81e1e"}
SOLID = {"OBSERVED", "INTERPOLATED"}
WIDE = {"INTERPOLATED_WIDE"}
UNSUPPORTED = {"EXTRAPOLATED", "LOW_SUPPORT"}
LRS = [1400, 1900, 2400, 2900, 3400]
XLIM = (800, 6000)

def contiguous_runs(mask):
    runs = []
    i = 0
    while i < len(mask):
        if mask[i]:
            j = i
            while j + 1 < len(mask) and mask[j + 1]:
                j += 1
            runs.append((i, j))
            i = j + 1
        else:
            i += 1
    return runs

def draw_axes(ax, rows, title, legend=True):
    M = np.array([int(r["roundStartMoney"]) for r in rows])
    conf = np.array([r["confidence"] for r in rows])
    fullv = np.array([float(r["p_full"]) for r in rows])
    # unsupported x-ranges: light gray background only (no probability drawn)
    un = np.isin(conf, list(UNSUPPORTED))
    for (i, j) in contiguous_runs(un):
        ax.axvspan(M[i], M[j], color="#f0f0f0", zorder=0)
    for key in ["eco", "semi", "force", "full"]:
        p = np.array([float(r["p_" + key]) for r in rows])
        labeled = False
        for (i, j) in contiguous_runs(np.isin(conf, list(SOLID))):
            ax.plot(M[i:j + 1], p[i:j + 1], color=COLORS[key], lw=2.0,
                    label=key if (legend and not labeled) else None)
            labeled = True
        for (i, j) in contiguous_runs(np.isin(conf, list(WIDE))):
            ax.plot(M[i:j + 1], p[i:j + 1], color=COLORS[key], lw=1.3, ls="--", alpha=0.7,
                    label=key + " (wide)" if (legend and not labeled) else None)
            labeled = True
    sup = np.isin(conf, list(SOLID))
    for thr, ls, col, label in [(0.5, "--", "#c81e1e", "full>50%"), (0.8, ":", "#c81e1e", "full>80%")]:
        idx = np.where(sup & (fullv >= thr))[0]
        if len(idx):
            ax.axvline(M[idx[0]], color=col, ls=ls, lw=1.3)
            ax.text(M[idx[0]] + 30, 0.97 if thr == 0.5 else 0.90, "{} @ ${}".format(label, M[idx[0]]),
                    color=col, fontsize=8.5)
    ax.set_xlim(*XLIM)
    ax.set_ylim(0, 1.02)
    ax.set_title(title, fontsize=11)
    ax.grid(alpha=0.3, lw=0.5)

for side in ["t", "ct"]:
    for lr in LRS:
        rows = [r for r in POL if r["side"] == side and r["lossReward"] == str(lr)
                and r["retained_value"] == "none"]
        fig, ax = plt.subplots(figsize=(13.5, 7.2), dpi=110)
        draw_axes(ax, rows, "{} side · lossReward ${} · retained none".format(side.upper(), lr))
        ax.set_xlabel("roundStartMoney ($)", fontsize=10)
        ax.set_ylabel("probability", fontsize=10)
        ax.legend(loc="center right", fontsize=9, framealpha=0.9)
        fig.tight_layout()
        fig.savefig("{}/{}_lr{}_{}_curve.png".format(OUT, side, lr, "none"))
        plt.close(fig)

fig, axes = plt.subplots(2, 5, figsize=(26, 9), dpi=100)
for ri, side in enumerate(["t", "ct"]):
    for ci, lr in enumerate(LRS):
        ax = axes[ri][ci]
        rows = [r for r in POL if r["side"] == side and r["lossReward"] == str(lr)
                and r["retained_value"] == "none"]
        draw_axes(ax, rows, "{} lr${}".format(side.upper(), lr), legend=(ri == 0 and ci == 0))
        if ri == 1:
            ax.set_xlabel("roundStartMoney ($)", fontsize=9)
        if ci == 0:
            ax.set_ylabel("probability", fontsize=9)
        if ri == 0 and ci == 0:
            ax.legend(loc="upper left", fontsize=7.5, framealpha=0.9)
fig.tight_layout()
fig.savefig("{}/economy-curves-overview.png".format(OUT))
plt.close(fig)
print("plots done: 10 individual + overview (xlim 800-6000)")
