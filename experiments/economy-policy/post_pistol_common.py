#!/usr/bin/env python3
"""Shared data layer for the post-pistol strategy research (new, not frozen).

Imports frozen research_common for corpus loading / STRICT / prices — read-only.
Adds: role metadata parsing, corpus teamKey -> team resolution (explicit aliases),
team-round reconstruction, post-pistol extraction, grouped-CV and cluster
bootstrap helpers.

NOT part of the frozen core; no frozen artifact is written by this module.
"""
import json
import math
import os
import re
import unicodedata
from collections import defaultdict

import numpy as np

import research_common as rc  # frozen data layer (read-only)

BASE = rc.BASE
RESULTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "cologne-2026")
PP_DIR = os.path.join(RESULTS_DIR, "post-pistol-strategy")
PLOT_DIR = os.path.join(PP_DIR, "plots")
METADATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "metadata")

ROLES_MD = os.path.join(METADATA_DIR, "player-roles.md")
SPEC_JSON = os.path.expanduser(
    "~/GitHub/cs2-demo-analysis-kit/fixtures/events/cologne-major-2026/spec.json")

# ---------------------------------------------------------------------------
# role metadata (player-roles.md — copied verbatim, SHA recorded at build time)
# ---------------------------------------------------------------------------

# Explicit aliases: raw corpus name -> metadata name (or None for team-only
# alias where the metadata roster does not contain the player at all).
# reason is mandatory and reported in role-aliases.csv.
ROLE_ALIASES = {
    # keys are norm_name()'d corpus names (NFC, casefold, no spaces)
    # BetBoom: demos show FL4MUS; infographic roster has s1ren (roster change).
    "fl4mus": {"metadata_name": None, "reason": "roster change: s1ren listed in infographic, FL4MUS played the demos"},
    # The MongolZ: demo name techno4k vs infographic Techno (same player).
    "techno4k": {"metadata_name": "Techno", "reason": "name variant: demo 'techno4k' vs infographic 'Techno'"},
    # MIBR: demo venomzera vs infographic ven0mzera (digit 0 vs letter o).
    "venomzera": {"metadata_name": "ven0mzera", "reason": "character variant: demo 'venomzera' vs infographic 'ven0mzera' (0/o)"},
    # paiN: demo v$m vs infographic vsm (stylized $).
    "v$m": {"metadata_name": "vsm", "reason": "stylized name: demo 'v$m' vs infographic 'vsm'"},
    # Aurora: demo susp not present in infographic roster.
    "susp": {"metadata_name": None, "reason": "roster change: susp played demos, not in infographic roster"},
}


def norm_name(s):
    """Case-folded, NFC-normalized, space-stripped name for exact comparison."""
    return unicodedata.normalize("NFC", s).strip().casefold().replace(" ", "")


def parse_role_metadata(path=ROLES_MD):
    """Parse player-roles.md -> list of dicts (team, player, all_star_role,
    ct_role, t_role). Hard-check: 32 teams, 160 players, 5 per team."""
    rows = []
    for line in open(path, encoding="utf-8"):
        if not line.startswith("| "):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 2 or "：" not in cells[1] or cells[0] in ("队伍", "Team"):
            continue
        team = cells[0]
        for entry in cells[1].split("；"):
            entry = entry.strip()
            if not entry or "：" not in entry:
                continue
            pname, roles = entry.split("：", 1)
            parts = [x.strip() for x in roles.split(" / ")]
            if len(parts) != 3:
                raise ValueError(f"BAD ROLE ENTRY: {team} {entry}")
            all_star = parts[0]
            if " " in all_star:  # strip the infographic color token (蓝/绿/紫/橙/黄)
                all_star = all_star.split(" ", 1)[1]
            rows.append({"team": team, "player": pname.strip().rstrip("*"),
                         "all_star_role": all_star,
                         "ct_role": parts[1].strip().rstrip("*"),
                         "t_role": parts[2].strip().rstrip("*")})
    teams = defaultdict(list)
    for r in rows:
        teams[r["team"]].append(r["player"])
    assert len(teams) == 32, f"expected 32 teams, got {len(teams)}"
    for t, ps in teams.items():
        assert len(ps) == 5, f"team {t} has {len(ps)} players, expected 5"
    assert len(rows) == 160, f"expected 160 players, got {len(rows)}"
    return rows


def build_role_index(role_rows):
    """team -> {norm_player: role_row} and player -> role_row (metadata side)."""
    team_idx = defaultdict(dict)
    for r in role_rows:
        team_idx[r["team"]][norm_name(r["player"])] = r
    return team_idx


# ---------------------------------------------------------------------------
# corpus teamKey -> team resolution (explicit, no silent fuzzy matching)
# ---------------------------------------------------------------------------

def resolve_team_names(maps_info, team_idx):
    """For each (map, teamKey) roster of 5 names, find the metadata team whose
    roster contains >= 4 of the 5 normalized names (exact match only).

    Returns (resolution, alias_usage, unmatched) where resolution[(map, teamKey)]
    = (team, n_matched, method). Raises on ambiguous matches.
    """
    resolution = {}
    alias_usage = defaultdict(list)  # raw name -> [(map, teamKey)]
    unmatched = []
    for m, info in maps_info.items():
        for tk, names in info.items():
            nset = {norm_name(n) for n in names}
            hits = []
            for team, roster in team_idx.items():
                inter = nset & set(roster)
                if len(inter) >= 4:
                    hits.append((team, len(inter)))
            if len(hits) != 1:
                unmatched.append((m, tk, names, hits))
                continue
            team, n = hits[0]
            resolution[(m, tk)] = (team, n, "exact" if n == 5 else "alias-team")
            for nm in names:
                if norm_name(nm) not in team_idx[team]:
                    alias_usage[nm].append((m, tk))
    return resolution, alias_usage, unmatched


def load_spec_series():
    """spec.json -> {series_key: {teamA, teamB}} (display names)."""
    spec = json.load(open(SPEC_JSON))
    out = {}
    for s in spec["series"]:
        out[s["key"]] = {"teamA": s["teamA"], "teamB": s["teamB"]}
    return out


def series_of_map(m):
    return re.sub(r"-m\d+-de_[a-z0-9_]+$", "", m)


# ---------------------------------------------------------------------------
# team-round reconstruction (TEAM_STRATEGY_CLEAN universe)
# ---------------------------------------------------------------------------

def build_team_rounds(rows):
    """Group raw rows into team-rounds. Returns dict keyed by
    (map, roundNumber, teamKey) with aggregate fields. Regulation only is NOT
    filtered here — overtime flag is preserved per row."""
    out = {}
    grp = defaultdict(list)
    for r in rows:
        grp[(r["map"], r["roundNumber"], r["teamKey"])].append(r)
    for (m, rn, tk), players in grp.items():
        assert len(players) == 5, f"team-round {m} {rn} {tk} has {len(players)} players"
        start = [p["startMoney"] for p in players]
        spent = [p["moneySpent"] for p in players]
        out[(m, rn, tk)] = {
            "map": m, "roundNumber": rn, "teamKey": tk,
            "side": players[0]["side"],
            "overtime": any(p["overtime"] for p in players),
            "winnerSide": players[0]["winnerSide"],
            "endReason": players[0]["endReason"],
            "scoreCT": players[0]["scoreCT"], "scoreT": players[0]["scoreT"],
            "lossIndex": players[0]["lossIndex"],
            "lossIndexAmbiguous": any(p["lossIndexAmbiguous"] for p in players),
            "team_start_money": sum(start),
            "team_money_spent": sum(spent),
            "team_money_remaining": sum(start) - sum(spent),
            "per_player_start_mean": sum(start) / 5.0,
            "per_player_start_median": float(np.median(start)),
            "per_player_remaining_mean": (sum(start) - sum(spent)) / 5.0,
            "survivedPrev_count": sum(1 for p in players if p["survivedPrev"]),
            "retained_primary_count": sum(1 for p in players
                                          if p["retainedPrimary"] is not None),
            "retained_awp_count": sum(1 for p in players
                                      if p["retainedPrimary"] == "AWP"),
            "players": players,
        }
    return out


def team_round_loss_reward(tr):
    return rc.LOSS_REWARDS[max(0, min(int(tr["lossIndex"]), 4))]


def build_post_pistol_team_rounds(team_rounds):
    """For each regulation half of each map: the pistol round (R1/R13), the
    post-pistol round (R2/R14), and the pistol LOSING team's decision.

    Returns (list of post-pistol team-round dicts, list of exclusion dicts).
    Field set follows the task spec; kills are derived from survivors
    (5 - opponent_survivors) because the corpus has no per-round kill field.
    """
    by_map = defaultdict(dict)
    for k, tr in team_rounds.items():
        by_map[tr["map"]][tr["roundNumber"]] = tr

    rows_out = []
    exclusions = []
    for m, rnd in sorted(by_map.items()):
        for half, (prn, ppn) in {"h1": (1, 2), "h2": (13, 14)}.items():
            pr = rnd.get(prn)
            pp = rnd.get(ppn)
            if pr is None or pp is None:
                exclusions.append({"map": m, "half": half, "reason": "missing pistol or post-pistol round"})
                continue
            # pistol round rows: both team-rounds share winnerSide
            pistol_winner_side = pr["winnerSide"]
            if pistol_winner_side not in ("t", "ct"):
                exclusions.append({"map": m, "half": half, "reason": "pistol winner unresolved"})
                continue
            loser_side = "ct" if pistol_winner_side == "t" else "t"
            # team-rounds are per teamKey: match by side
            loser_tr = None
            winner_tr = None
            candidates = [tr for tr in team_rounds.values()
                          if tr["map"] == m and tr["roundNumber"] == ppn]
            for tr in candidates:
                if tr["side"] == loser_side:
                    loser_tr = tr
                if tr["side"] == pistol_winner_side:
                    winner_tr = tr
            if loser_tr is None or winner_tr is None:
                exclusions.append({"map": m, "half": half, "reason": "post-pistol team-round missing for a side"})
                continue
            if loser_tr["overtime"]:
                exclusions.append({"map": m, "half": half, "reason": "overtime"})
                continue
            if loser_tr["lossIndexAmbiguous"]:
                exclusions.append({"map": m, "half": half, "reason": "lossIndexAmbiguous"})
                continue
            if any(p["startMoney"] is None or p["moneySpent"] is None for p in loser_tr["players"]):
                exclusions.append({"map": m, "half": half, "reason": "missing startMoney/moneySpent"})
                continue
            # pistol-round facts (from the pistol round's own row snapshot)
            bomb_planted = pr["endReason"] in ("target_bombed", "bomb_defused")
            own_surv = loser_tr["survivedPrev_count"]
            opp_surv = winner_tr["survivedPrev_count"]
            ratio = (loser_tr["team_money_spent"] / loser_tr["team_start_money"]
                     if loser_tr["team_start_money"] > 0 else math.nan)
            rows_out.append({
                "match_series": series_of_map(m),
                "map": m,
                "half": half,
                "post_pistol_round": ppn,
                "team": None,  # filled by caller after team resolution
                "teamKey": loser_tr["teamKey"],
                "side": loser_side,
                "opponent": None,
                "opponent_teamKey": winner_tr["teamKey"],
                "pistol_outcome": "loss",
                "pistol_win_method": pr["endReason"],
                "pistol_bomb_planted": bomb_planted,
                "pistol_bomb_exploded": pr["endReason"] == "target_bombed",
                "pistol_defused": pr["endReason"] == "bomb_defused",
                "own_survivors_pistol_end": own_surv,
                "opponent_survivors_pistol_end": opp_surv,
                # kills derived: each team's kills = 5 - opponent survivors
                "own_kills": 5 - opp_surv,
                "opponent_kills": 5 - own_surv,
                "team_start_money": loser_tr["team_start_money"],
                "team_money_spent": loser_tr["team_money_spent"],
                "team_money_remaining": loser_tr["team_money_remaining"],
                "team_spend_ratio": ratio,
                "per_player_start_mean": loser_tr["per_player_start_mean"],
                "per_player_start_median": loser_tr["per_player_start_median"],
                "per_player_remaining_mean": loser_tr["per_player_remaining_mean"],
                "team_loss_reward_if_current_round_lost": team_round_loss_reward(loser_tr),
                "retained_primary_count_at_decision": loser_tr["retained_primary_count"],
                "retained_awp_count_at_decision": loser_tr["retained_awp_count"],
                "opponent_team_start_money": winner_tr["team_start_money"],
                "opponent_retained_primary_count": winner_tr["retained_primary_count"],
                "opponent_retained_awp_count": winner_tr["retained_awp_count"],
                "opponent_per_player_start_mean": winner_tr["per_player_start_mean"],
                "opponent_loss_index": winner_tr["lossIndex"],
                "opponent_loss_reward": team_round_loss_reward(winner_tr),
                "opponent_survivedPrev_count": opp_surv,
                "pistol_winner_side": pistol_winner_side,
                "half_rounds": len([rn for rn in rnd if rn <= 24]),
            })
    return rows_out, exclusions


# ---------------------------------------------------------------------------
# player-style dataset (PLAYER_STYLE_STRICT — frozen STRICT + role join)
# ---------------------------------------------------------------------------

def attach_roles(rows, team_by_map, role_idx, alias_map):
    """Attach (team, all_star_role, ct_role, t_role, role_join_method) to rows
    that carry 'name' + 'map' + 'teamKey'. team_by_map: {(map, teamKey): team}."""
    out = []
    for r in rows:
        team = team_by_map.get((r["map"], r["teamKey"]))
        rec = dict(r)
        rec["team"] = team
        rec["all_star_role"] = None
        rec["ct_role"] = None
        rec["t_role"] = None
        rec["role_join_method"] = "unresolved" if team is None else "team-unresolved"
        if team is not None:
            name = r.get("name", "")
            n = norm_name(name)
            role = role_idx.get(team, {}).get(n)
            if role is None and n in alias_map:
                target = alias_map[n].get("metadata_name")
                if target:
                    role = role_idx.get(team, {}).get(norm_name(target))
                    rec["role_join_method"] = "alias-player"
                else:
                    rec["role_join_method"] = "alias-team-only"
            if role is not None:
                rec["all_star_role"] = role["all_star_role"]
                rec["ct_role"] = role["ct_role"]
                rec["t_role"] = role["t_role"]
                rec["role_join_method"] = "exact" if rec["role_join_method"] == "team-unresolved" else rec["role_join_method"]
        out.append(rec)
    return out


# ---------------------------------------------------------------------------
# grouped-CV / bootstrap helpers
# ---------------------------------------------------------------------------

def group_of(series):
    """Group id for match-series clustered CV/bootstrap."""
    return series


def cluster_bootstrap_indices(groups, rng, B=1000):
    """Resample match-series clusters (whole series kept together). Returns
    list of index arrays (one per bootstrap replicate)."""
    uniq = sorted(set(groups))
    out = []
    for _ in range(B):
        picked = rng.choice(len(uniq), size=len(uniq), replace=True)
        idx = np.concatenate([np.where(groups == uniq[u])[0] for u in picked])
        out.append(idx)
    return out


def logloss_binary(y, p):
    eps = 1e-9
    p = np.clip(p, eps, 1 - eps)
    return -np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))


def brier_binary(y, p):
    return np.mean((p - y) ** 2)
