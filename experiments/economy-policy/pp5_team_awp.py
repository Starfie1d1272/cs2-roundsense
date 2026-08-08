#!/usr/bin/env python3
"""pp5 — team/system post-pistol propensity + AWP dependency.

Team propensity (team-round unit):
  - raw post-pistol FORCE rate per team
  - beta-binomial shrinkage (method of moments, towards global mean)
  - regularized logistic team effect (controlling side, team start money,
    plant (T), opponent survivors, half)
  - cluster-bootstrap 95% CI by match series
  - IGL metadata name attached (team/IGL-system association only, no causal
    claims on individual IGLs)

AWP dependency (role metadata: all_star_role == AWPer):
  - designated AWPer AWP resulting / acquisition / retained rates
  - dual-AWP frequency (team-round level, resulting primaries)
  - non-AWPer AWP frequency
  - team force propensity vs AWP dependency association (descriptive)
  - AWPer economy behavior before AWP purchase rounds (descriptive,
    sequential evidence only)

Outputs:
  team-system-propensity.csv, awp-dependency.csv, awp-economy-association.md
  plots/06-team-force-propensity.png
  plots/08-awp-dependency-vs-economy.png
"""
import csv
import json
import os
import sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import post_pistol_common as ppc

SEED = 42
B = 1000


def load_branches():
    with open(os.path.join(ppc.PP_DIR, "post-pistol-team-rounds.csv")) as f:
        rows = list(csv.DictReader(f))
    with open(os.path.join(ppc.PP_DIR, "post-pistol-branches.csv")) as f:
        br = {r["map"] + "|" + r["half"]: r for r in csv.DictReader(f)}
    for r in rows:
        r["branch"] = br[r["map"] + "|" + r["half"]]["branch"]
        r["team_spend_ratio"] = float(r["team_spend_ratio"])
        r["team_start_money"] = float(r["team_start_money"])
        r["pistol_bomb_planted"] = (r["pistol_bomb_planted"] == "True")
        r["opponent_survivors_pistol_end"] = int(r["opponent_survivors_pistol_end"])
        r["half"] = r["half"]
    return rows


def beta_binom_shrinkage(k, n, mu, phi):
    """Shrunken rate (k+a)/(n+a+b) with a,b from mean mu and overdispersion phi
    (beta-binomial MOM). phi=0 -> a -> inf (no shrinkage)."""
    if phi <= 0:
        return mu if n == 0 else k / n
    # beta-binomial MOM: Var/np(1-p) = 1 + (n-1) * rho, rho = 1/(a+b+1)
    rho = phi
    ab = 1.0 / rho - 1.0
    a = mu * ab
    b = (1 - mu) * ab
    return (k + a) / (n + a + b)


def cluster_rate_ci(rows, keyfn, B=B, seed=SEED):
    series = np.array([r["match_series"] for r in rows])
    y = np.array([1 if keyfn(r) else 0 for r in rows])
    uniq = sorted(set(series))
    rng = np.random.default_rng(seed)
    boots = []
    for _ in range(B):
        picked = rng.choice(len(uniq), size=len(uniq), replace=True)
        idx = np.concatenate([np.where(series == uniq[u])[0] for u in picked])
        boots.append(y[idx].mean())
    return np.percentile(boots, [2.5, 97.5])


def main():
    rows = load_branches()
    # role metadata for IGL + designated AWPer
    role_rows = ppc.parse_role_metadata()
    igl_by_team = {}
    awper_by_team = defaultdict(list)
    for r in role_rows:
        if r["all_star_role"] == "IGL":
            igl_by_team[r["team"]] = r["player"]
        if r["all_star_role"] == "AWPer":
            awper_by_team[r["team"]].append(r["player"])

    # ---------------------------------------------------------------
    # 1. team propensity
    # ---------------------------------------------------------------
    teams = sorted({r["team"] for r in rows})
    k_arr = []
    n_arr = []
    for team in teams:
        sub = [r for r in rows if r["team"] == team]
        n_arr.append(len(sub))
        k_arr.append(sum(1 for r in sub if r["branch"] == "FORCE"))
    k_arr = np.array(k_arr, dtype=float)
    n_arr = np.array(n_arr, dtype=float)
    mu_global = k_arr.sum() / n_arr.sum()
    # MOM overdispersion: rho = (Var - mu(1-mu) * mean(n-1)/n... ) simple MOM:
    p_hat = np.where(n_arr > 0, k_arr / n_arr, mu_global)
    # weighted variance of p_hat about mu
    w = n_arr / n_arr.sum()
    var_p = np.sum(w * (p_hat - mu_global) ** 2)
    # expected binomial variance under common p: mu(1-mu) * E[1/n]
    exp_var = mu_global * (1 - mu_global) * np.mean(1.0 / np.where(n_arr > 0, n_arr, 1))
    rho = max(0.0, (var_p - exp_var) / (var_p + 1e-9)) if var_p > 0 else 0.0
    rho = min(rho, 0.5)

    # regularized logistic team effect (control features)
    from sklearn.linear_model import LogisticRegression
    ctl = []
    for r in rows:
        ctl.append([
            r["team_start_money"] / 1000.0,
            int(r["side"] == "ct"),
            int(r["pistol_bomb_planted"]),
            int(r["opponent_survivors_pistol_end"]),
            int(r["half"] == "h2"),
        ])
    X = np.array(ctl)
    y = np.array([1 if r["branch"] == "FORCE" else 0 for r in rows])
    team_idx = {t: i for i, t in enumerate(teams)}
    team_onehot = np.zeros((len(rows), len(teams)))
    for i, r in enumerate(rows):
        team_onehot[i, team_idx[r["team"]]] = 1.0
    Xt = np.hstack([X, team_onehot])
    model = LogisticRegression(C=1.0, max_iter=3000, random_state=SEED)
    model.fit(Xt, y)
    team_effects = model.coef_[0][5:]
    disp_rho = float(rho)  # capture before any later reassignment

    out = []
    for i, team in enumerate(teams):
        sub = [r for r in rows if r["team"] == team]
        k = sum(1 for r in sub if r["branch"] == "FORCE")
        n = len(sub)
        raw = k / n if n else float("nan")
        shrunk = beta_binom_shrinkage(k, n, mu_global, rho)
        ci = cluster_rate_ci(sub, lambda r: r["branch"] == "FORCE") if n >= 3 else (float("nan"), float("nan"))
        out.append({
            "team": team,
            "n": n,
            "n_t": sum(1 for r in sub if r["side"] == "t"),
            "n_ct": sum(1 for r in sub if r["side"] == "ct"),
            "raw_force_rate": round(raw, 4),
            "shrunk_force_rate": round(float(shrunk), 4),
            "adjusted_effect_logodds": round(float(team_effects[i]), 4),
            "ci95_low": round(ci[0], 4),
            "ci95_high": round(ci[1], 4),
            "igl": igl_by_team.get(team, ""),
            "low_support": "LOW SUPPORT" if n < 20 else "",
        })
    with open(os.path.join(ppc.PP_DIR, "team-system-propensity.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)

    # ---------------------------------------------------------------
    # 2. AWP dependency
    # ---------------------------------------------------------------
    strict = list(csv.DictReader(open(os.path.join(ppc.PP_DIR, "player-style-strict.csv"))))
    for r in strict:
        r["startMoney"] = float(r["startMoney"])
        r["moneySpent"] = float(r["moneySpent"])
        r["roundNumber"] = int(r["roundNumber"])
    FAMILY = ppc.rc.load_weapon_families()

    team_awp = []
    for team in teams:
        awpers = awper_by_team.get(team, [])
        team_strict = [r for r in strict if r["team"] == team]
        awper_rows = [r for r in team_strict if r["name"] in awpers]
        non_awper_rows = [r for r in team_strict if r["name"] not in awpers and r["name"] != ""]
        # financially viable rounds: startMoney >= 5400 (AWP+armor), >= 4000 (AWP only)
        def rates(rr, min_money):
            sub = [r for r in rr if r["startMoney"] >= min_money]
            if not sub:
                return None
            n = len(sub)
            resulting = sum(1 for r in sub if r["primary"] == "AWP") / n
            acquired = sum(1 for r in sub if r["primary"] == "AWP" and r["retainedPrimary"] != "AWP") / n
            retained = sum(1 for r in sub if r["retainedPrimary"] == "AWP") / n
            return n, resulting, acquired, retained
        awp5400 = rates(awper_rows, 5400)
        awp4000 = rates(awper_rows, 4000)
        non5400 = rates(non_awper_rows, 5400)
        # dual-AWP frequency from team-round reconstruction
        raw_rows = ppc.rc.load_rows()
        tr = ppc.build_team_rounds(raw_rows)
        dual = 0
        dual_n = 0
        for k, t in tr.items():
            if t["overtime"]:
                continue
            primaries = [p["primary"] for p in t["players"]]
            if primaries.count("AWP") >= 2:
                dual += 1
            dual_n += 1
        dual_rate = dual / dual_n if dual_n else float("nan")
        # team post-pistol force rate
        sub = [r for r in rows if r["team"] == team]
        force_rate = sum(1 for r in sub if r["branch"] == "FORCE") / len(sub) if sub else float("nan")
        team_awp.append({
            "team": team,
            "designated_awper": ",".join(awpers),
            "awp_resulting_rate_5400": round(awp5400[1], 4) if awp5400 else "",
            "awp_acquired_rate_5400": round(awp5400[2], 4) if awp5400 else "",
            "awp_retained_rate_5400": round(awp5400[3], 4) if awp5400 else "",
            "n_viable_5400": awp5400[0] if awp5400 else 0,
            "awp_resulting_rate_4000": round(awp4000[1], 4) if awp4000 else "",
            "n_viable_4000": awp4000[0] if awp4000 else 0,
            "non_awper_awp_rate_5400": round(non5400[1], 4) if non5400 else "",
            "n_non_awper_5400": non5400[0] if non5400 else 0,
            "dual_awp_team_round_rate": round(dual_rate, 4),
            "post_pistol_force_rate": round(force_rate, 4),
            "post_pistol_n": len(sub),
        })
    with open(os.path.join(ppc.PP_DIR, "awp-dependency.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(team_awp[0].keys()))
        w.writeheader()
        w.writerows(team_awp)

    # association: team force propensity vs AWP resulting rate (Spearman)
    from scipy.stats import spearmanr
    assoc = []
    pairs = [(float(t["awp_resulting_rate_5400"]), float(t["post_pistol_force_rate"]))
             for t in team_awp if t["awp_resulting_rate_5400"] != "" and t["post_pistol_n"] >= 5]
    if len(pairs) >= 8:
        rho, p = spearmanr([p[0] for p in pairs], [p[1] for p in pairs])
        assoc.append({"pair": "awp_resulting_rate_5400 vs post_pistol_force_rate",
                      "n_teams": len(pairs), "spearman_rho": round(float(rho), 4),
                      "p": round(float(p), 4)})
    pairs2 = [(float(t["awp_retained_rate_5400"]), float(t["post_pistol_force_rate"]))
              for t in team_awp if t["awp_retained_rate_5400"] != "" and t["post_pistol_n"] >= 5]
    if len(pairs2) >= 8:
        rho, p = spearmanr([p[0] for p in pairs2], [p[1] for p in pairs2])
        assoc.append({"pair": "awp_retained_rate_5400 vs post_pistol_force_rate",
                      "n_teams": len(pairs2), "spearman_rho": round(float(rho), 4),
                      "p": round(float(p), 4)})

    # ---------------------------------------------------------------
    # 3. AWPer pre-AWP-buy economy behavior (sequential, descriptive)
    # ---------------------------------------------------------------
    prebuy = defaultdict(list)   # role group -> list of prev-round spent
    prebuy_action = defaultdict(lambda: defaultdict(int))
    prebuy_n = defaultdict(int)
    for team in teams:
        awpers = awper_by_team.get(team, [])
        team_strict = [r for r in strict if r["team"] == team]
        by_key = {(r["map"], r["roundNumber"], r["name"]): r for r in team_strict}
        for r in team_strict:
            if r["name"] not in awpers:
                continue
            bought_awp = (r["primary"] == "AWP" and r["retainedPrimary"] != "AWP"
                          and r["moneySpent"] >= 2000)
            if not bought_awp:
                continue
            prev = by_key.get((r["map"], r["roundNumber"] - 1, r["name"]))
            if prev is None or prev["roundNumber"] in (1, 13):
                continue
            prebuy["AWPer"].append(prev["moneySpent"])
            prebuy_action["AWPer"][prev["actionType"]] += 1
            prebuy_n["AWPer"] += 1
        # non-AWPer comparison: pre-full-buy rounds (primary rifle/SMG bought)
        for r in team_strict:
            if r["name"] in awpers:
                continue
            fam = FAMILY.get(r["primary"], "other")
            if fam not in ("rifle", "smg") or r["retainedPrimary"] == r["primary"]:
                continue
            prev = by_key.get((r["map"], r["roundNumber"] - 1, r["name"]))
            if prev is None or prev["roundNumber"] in (1, 13):
                continue
            prebuy["non-AWPer"].append(prev["moneySpent"])
            prebuy_action["non-AWPer"][prev["actionType"]] += 1
            prebuy_n["non-AWPer"] += 1

    md = [
        "# AWP Dependency & Economy Association (descriptive)",
        "",
        "## Designated AWPer (role metadata, all_star_role == AWPer)",
        "",
        "- AWP resulting rate: P(resulting primary == AWP) in financially viable rounds",
        "  (startMoney >= $5400 = AWP + kevlar; >= $4000 = AWP only).",
        "- AWP acquired rate: bought this round (retainedPrimary != AWP).",
        "- AWP retained rate: carried in (retainedPrimary == AWP).",
        "- dual-AWP: >= 2 players with resulting primary AWP in the same team-round (all regulation rounds).",
        "- non-AWPer AWP: players with role != AWPer resulting with AWP in viable rounds.",
        "",
        "## Association with post-pistol FORCE propensity",
        "",
    ]
    for a in assoc:
        md.append(f"- {a['pair']}: rho={a['spearman_rho']}, p={a['p']}, n_teams={a['n_teams']} (Spearman, descriptive)")
    if not assoc:
        md.append("- (insufficient teams with n>=5 post-pistol rounds for association test)")
    md += [
        "",
        "## AWPer economy behavior in the round BEFORE an AWP purchase",
        "",
        "Sequential evidence only (previous-round row of the same player).",
        "AWPer: rounds immediately before a bought AWP; non-AWPer: rounds before a bought rifle/SMG.",
        "",
    ]
    for group in ("AWPer", "non-AWPer"):
        vals = prebuy.get(group, [])
        if vals:
            md.append(f"- {group}: n={len(vals)}, mean prev-round spent={np.mean(vals):.0f}, "
                      f"median={np.median(vals):.0f}, eco-rate="
                      f"{prebuy_action[group].get('eco', 0) / len(vals):.3f}, "
                      f"action={dict(prebuy_action[group])}")
        else:
            md.append(f"- {group}: no qualifying rows")
    md += [
        "",
        "## Cautions",
        "",
        "- All associations are observational (single event, small n per team).",
        "- AWP dependency is confounded with team strength and map pool; no causal",
        "  claim 'AWP-dependent teams ECO more' is supported by this table alone.",
        "- 'because they need AWP they ECO' requires sequential evidence; the table",
        "  above only describes the previous-round state, not the decision rule.",
    ]
    open(os.path.join(ppc.PP_DIR, "awp-economy-association.md"), "w").write("\n".join(md))

    # ---------------------------------------------------------------
    # plots
    # ---------------------------------------------------------------
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(11, 5))
    order = sorted(out, key=lambda t: -t["shrunk_force_rate"])
    names = [t["team"] for t in order]
    shrunk = [t["shrunk_force_rate"] for t in order]
    raw = [t["raw_force_rate"] for t in order]
    n = [t["n"] for t in order]
    xpos = np.arange(len(names))
    yerr = np.array([[t["raw_force_rate"] - t["ci95_low"] if t["ci95_low"] == t["ci95_low"] else 0,
                      t["ci95_high"] - t["raw_force_rate"] if t["ci95_high"] == t["ci95_high"] else 0]
                     for t in order]).T
    ax.errorbar(xpos, raw, yerr=yerr, fmt="none", ecolor="#c8c8c8", zorder=1)
    ax.scatter(xpos, raw, s=30, color="#dd8452", label="raw", zorder=2)
    ax.scatter(xpos, shrunk, s=60, color="#4c72b0", label="beta-binomial shrunk", zorder=3)
    ax.axhline(mu_global, color="gray", ls="--", lw=1)
    for i, nn in enumerate(n):
        ax.text(i, 1.02, str(nn), ha="center", fontsize=7, color="gray")
    ax.set_xticks(xpos)
    ax.set_xticklabels(names, rotation=90, fontsize=7)
    ax.set_ylim(0, 1.08)
    ax.set_ylabel("post-pistol FORCE rate")
    ax.legend()
    ax.set_title("Team/system post-pistol FORCE propensity (shrinkage; n labels on top)")
    fig.tight_layout()
    fig.savefig(os.path.join(ppc.PLOT_DIR, "06-team-force-propensity.png"), dpi=150)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(6.5, 4.5))
    xx = [float(t["awp_resulting_rate_5400"]) for t in team_awp if t["awp_resulting_rate_5400"] != ""]
    yy = [float(t["post_pistol_force_rate"]) for t in team_awp if t["awp_resulting_rate_5400"] != ""]
    ax.scatter(xx, yy, s=40, alpha=0.8)
    for t in team_awp:
        if t["awp_resulting_rate_5400"] != "":
            ax.annotate(t["team"], (float(t["awp_resulting_rate_5400"]),
                                    float(t["post_pistol_force_rate"])),
                        fontsize=6, alpha=0.7, xytext=(2, 2), textcoords="offset points")
    ax.set_xlabel("designated AWPer AWP resulting rate (start >= $5400)")
    ax.set_ylabel("team post-pistol FORCE rate")
    ax.set_title("AWP dependency vs post-pistol FORCE propensity (descriptive)")
    fig.tight_layout()
    fig.savefig(os.path.join(ppc.PLOT_DIR, "08-awp-dependency-vs-economy.png"), dpi=150)
    plt.close(fig)

    print(json.dumps({
        "teams": len(teams),
        "global_force_rate": round(mu_global, 4),
        "overdispersion_rho": round(disp_rho, 4),
        "awp_association": assoc,
        "prebuy_awper_n": prebuy_n.get("AWPer", 0),
        "prebuy_awper_mean_spent": round(float(np.mean(prebuy.get("AWPer", [0]))), 1),
        "prebuy_nonawper_n": prebuy_n.get("non-AWPer", 0),
        "prebuy_nonawper_mean_spent": round(float(np.mean(prebuy.get("non-AWPer", [0]))), 1),
    }, indent=2))


if __name__ == "__main__":
    main()
