#!/usr/bin/env python3
"""pp1 — build post-pistol research datasets (research/post-pistol-strategy).

Produces:
  metadata/player-roles.md              (copied verbatim from user source)
  metadata/role-metadata-record.json    (original path, SHAs, parse timestamp)
  metadata/frozen-core-sha256-0875db9.json (TRUE repo blob baselines at 0875db9)
  results/cologne-2026/post-pistol-strategy/role-metadata.csv
  results/cologne-2026/post-pistol-strategy/role-aliases.csv
  results/cologne-2026/post-pistol-strategy/role-join-report.md
  results/cologne-2026/post-pistol-strategy/team-map.csv
  results/cologne-2026/post-pistol-strategy/post-pistol-team-rounds.csv
  results/cologne-2026/post-pistol-strategy/team-strategy-clean-stats.csv
  results/cologne-2026/post-pistol-strategy/player-style-strict.csv

Read-only on frozen core artifacts; records their true 0875db9 SHA256 for the
end-of-task unchanged verification.
"""
import csv
import hashlib
import json
import os
import subprocess
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import post_pistol_common as ppc

FROZEN_CORE = ["economy-reference-surface.csv", "purchase-surface.csv",
               "primary-distribution.csv", "secondary-distribution.csv",
               "conditional-loadouts.csv", "retained-coverage.csv"]
FROZEN_COMMIT = "0875db9"


def sha256_file(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def blob_sha256(rev, path):
    b = subprocess.run(["git", "show", f"{rev}:{path}"],
                       capture_output=True, check=True).stdout
    return hashlib.sha256(b).hexdigest()


def main():
    os.makedirs(ppc.PP_DIR, exist_ok=True)
    os.makedirs(ppc.METADATA_DIR, exist_ok=True)

    # ------------------------------------------------------------------
    # 1. role metadata: verbatim copy + record (SHAs must be identical)
    # ------------------------------------------------------------------
    src = "/Users/starfie1d/Downloads/hltv-cologne-major/player-roles.md"
    dst = os.path.join(ppc.METADATA_DIR, "player-roles.md")
    sh_src = sha256_file(src)
    if not os.path.exists(dst):
        data = open(src, "rb").read()
        open(dst, "wb").write(data)
    sh_dst = sha256_file(dst)
    assert sh_src == sh_dst, "copied metadata SHA mismatch"
    import datetime
    record = {
        "original_path": src,
        "copied_path": dst,
        "sha256_original": sh_src,
        "sha256_copied": sh_dst,
        "parse_timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    json.dump(record, open(os.path.join(ppc.METADATA_DIR, "role-metadata-record.json"), "w"),
              indent=2)

    # ------------------------------------------------------------------
    # 2. frozen core baseline: TRUE repo blobs at 0875db9
    #    (the committed _core-sha256.json holds /tmp-generation hashes that do
    #    NOT match the committed blobs — recorded here as a pre-existing
    #    finding; our unchanged-verification uses the true blob hashes)
    # ------------------------------------------------------------------
    core_blobs = {}
    for f in FROZEN_CORE:
        p = os.path.join(ppc.RESULTS_DIR, f)
        core_blobs[f] = {
            "repo_blob_sha256_0875db9": blob_sha256(FROZEN_COMMIT, f"experiments/economy-policy/results/cologne-2026/{f}"),
            "working_tree_sha256": sha256_file(p),
        }
    json.dump(core_blobs, open(os.path.join(ppc.METADATA_DIR,
                                            "frozen-core-sha256-0875db9.json"), "w"), indent=2)
    for f, h in core_blobs.items():
        assert h["repo_blob_sha256_0875db9"] == h["working_tree_sha256"], f"working tree diverged: {f}"

    # ------------------------------------------------------------------
    # 3. load corpus + role metadata + resolve teams
    # ------------------------------------------------------------------
    rows = ppc.rc.load_rows()
    role_rows = ppc.parse_role_metadata()
    team_idx = ppc.build_role_index(role_rows)

    by_map = defaultdict(lambda: defaultdict(list))
    for r in rows:
        by_map[r["map"]][r["teamKey"]].append(r["name"])
    maps_info = {m: {tk: sorted(set(v)) for tk, v in tkd.items()} for m, tkd in by_map.items()}

    resolution, alias_usage, unmatched = ppc.resolve_team_names(maps_info, team_idx)
    assert not unmatched, f"unresolved team rosters: {unmatched[:5]}"
    team_by_map = {(m, tk): team for (m, tk), (team, n, method) in resolution.items()}

    spec = ppc.load_spec_series()
    series_missing = [s for s in {ppc.series_of_map(m) for m in maps_info} if s not in spec]
    assert not series_missing, f"series missing from spec.json: {series_missing}"

    # ------------------------------------------------------------------
    # 4. role-metadata.csv (32 teams x 5 players)
    # ------------------------------------------------------------------
    with open(os.path.join(ppc.PP_DIR, "role-metadata.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["team", "player", "all_star_role", "ct_role", "t_role", "source"])
        for r in role_rows:
            w.writerow([r["team"], r["player"], r["all_star_role"],
                        r["ct_role"], r["t_role"], "hltv-infographic-iem-cologne-major-2026"])

    # ------------------------------------------------------------------
    # 5. role-aliases.csv (explicit, no silent fuzzy matching)
    # ------------------------------------------------------------------
    alias_rows = []
    seen = set()
    for raw_name, usage in sorted(alias_usage.items()):
        key = ppc.norm_name(raw_name)
        assert key in ppc.ROLE_ALIASES, f"alias not declared: {raw_name}"
        alias_rows.append({
            "raw_corpus_name": raw_name,
            "metadata_name": ppc.ROLE_ALIASES[key]["metadata_name"] or "",
            "reason": ppc.ROLE_ALIASES[key]["reason"],
            "occurrences": len(usage),
        })
        seen.add(key)
    for raw_name in ppc.ROLE_ALIASES:
        if raw_name not in seen:
            raise ValueError(f"alias declared but never observed: {raw_name}")
    with open(os.path.join(ppc.PP_DIR, "role-aliases.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["raw_corpus_name", "metadata_name", "reason", "occurrences"])
        w.writeheader()
        w.writerows(alias_rows)

    # ------------------------------------------------------------------
    # 6. team-map.csv (per map, per teamKey: resolved team + spec names)
    # ------------------------------------------------------------------
    with open(os.path.join(ppc.PP_DIR, "team-map.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["map", "series", "teamKey", "team", "spec_teamA", "spec_teamB",
                    "method", "n_matched"])
        for m in sorted(maps_info):
            s = ppc.series_of_map(m)
            for tk in ("teamA", "teamB"):
                team, n, method = resolution[(m, tk)]
                w.writerow([m, s, tk, team, spec[s]["teamA"], spec[s]["teamB"],
                            method, n])

    # ------------------------------------------------------------------
    # 7. TEAM_STRATEGY_CLEAN: team-rounds + post-pistol sample
    # ------------------------------------------------------------------
    team_rounds = ppc.build_team_rounds(rows)
    pp_rows, exclusions = ppc.build_post_pistol_team_rounds(team_rounds)

    # attach resolved team names (loser team + opponent)
    for r in pp_rows:
        r["team"] = team_by_map.get((r["map"], r["teamKey"]))
        r["opponent"] = team_by_map.get((r["map"], r["opponent_teamKey"]))
        assert r["team"] and r["opponent"], f"team resolution failed for {r['map']}"

    # exclusion census for the report
    excl = defaultdict(int)
    for e in exclusions:
        excl[e["reason"]] += 1
    raw_candidates = len(pp_rows) + len(exclusions)
    stats = {
        "raw_candidate_post_pistol_team_rounds": raw_candidates,
        "clean_post_pistol_team_rounds": len(pp_rows),
        "excluded_total": len(exclusions),
        "exclusion_reasons": dict(excl),
        "maps": len(maps_info),
        "series": len({ppc.series_of_map(m) for m in maps_info}),
    }
    with open(os.path.join(ppc.PP_DIR, "team-strategy-clean-stats.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["key", "value"])
        w.writeheader()
        for k, v in stats.items():
            w.writerow({"key": k, "value": json.dumps(v) if isinstance(v, dict) else v})

    with open(os.path.join(ppc.PP_DIR, "post-pistol-team-rounds.csv"), "w", newline="") as f:
        fields = ["match_series", "map", "half", "post_pistol_round", "team", "teamKey",
                  "side", "opponent", "opponent_teamKey", "pistol_outcome",
                  "pistol_win_method", "pistol_bomb_planted", "pistol_bomb_exploded",
                  "pistol_defused", "own_survivors_pistol_end",
                  "opponent_survivors_pistol_end", "own_kills", "opponent_kills",
                  "team_start_money", "team_money_spent", "team_money_remaining",
                  "team_spend_ratio", "per_player_start_mean", "per_player_start_median",
                  "per_player_remaining_mean", "team_loss_reward_if_current_round_lost",
                  "retained_primary_count_at_decision", "retained_awp_count_at_decision",
                  "opponent_team_start_money", "opponent_retained_primary_count",
                  "opponent_retained_awp_count", "opponent_per_player_start_mean",
                  "opponent_loss_index", "opponent_loss_reward",
                  "opponent_survivedPrev_count", "pistol_winner_side"]
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in pp_rows:
            w.writerow(r)

    # ------------------------------------------------------------------
    # 8. PLAYER_STYLE_STRICT: frozen STRICT + role join
    # ------------------------------------------------------------------
    STRICT, FAMILY = ppc.rc.build_dataset(rows)
    strict_joined = ppc.attach_roles(STRICT, team_by_map, team_idx, ppc.ROLE_ALIASES)
    with open(os.path.join(ppc.PP_DIR, "player-style-strict.csv"), "w", newline="") as f:
        fields = ["map", "roundNumber", "playerIndex", "name", "team", "teamKey", "side",
                  "actionType", "startMoney", "moneySpent", "equipmentValue",
                  "lossIndex", "overtime", "primary", "secondary", "hasArmor",
                  "hasHelmet", "hasDefuseKit", "grenades", "retainedPrimary",
                  "retainedSecondary", "retainedArmor", "retainedHelmet",
                  "retainedKit", "retainedGrenades", "correctedRetainedPrimary",
                  "_lr", "all_star_role", "ct_role", "t_role", "role_join_method"]
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in strict_joined:
            row = {k: r.get(k) for k in fields}
            row["grenades"] = json.dumps(r["grenades"])
            row["retainedGrenades"] = json.dumps(r["retainedGrenades"])
            w.writerow(row)

    # ------------------------------------------------------------------
    # 9. role-join-report.md
    # ------------------------------------------------------------------
    n_exact = sum(1 for r in strict_joined if r["role_join_method"] == "exact")
    n_alias_player = sum(1 for r in strict_joined if r["role_join_method"] == "alias-player")
    n_alias_team = sum(1 for r in strict_joined if r["role_join_method"] == "alias-team-only")
    n_unresolved = sum(1 for r in strict_joined if r["role_join_method"] == "unresolved")
    md = [
        "# Role Join Report (post-pistol strategy research)",
        "",
        f"- metadata: `{dst}` (SHA256 `{sh_dst}`) — verbatim copy of {src}",
        f"- parse timestamp: {record['parse_timestamp']}",
        f"- metadata rows: {len(role_rows)} (32 teams x 5 players hard-checked)",
        f"- corpus maps: {len(maps_info)}, series: {len({ppc.series_of_map(m) for m in maps_info})} (106/106 in spec.json)",
        f"- team resolution: {sum(1 for v in resolution.values() if v[1] == 5)} exact-5 rosters, "
        f"{sum(1 for v in resolution.values() if v[1] == 4)} alias-team rosters, 0 ambiguous, 0 unmatched",
        "",
        "## Join method on PLAYER_STYLE_STRICT",
        "",
        f"- exact (5/5 roster, player name exact normalized): {n_exact}",
        f"- alias-player (roster 4/5 + explicit player alias): {n_alias_player}",
        f"- alias-team-only (roster 4/5, alias player has no metadata row): {n_alias_team}",
        f"- unresolved: {n_unresolved}",
        "",
        "## Aliases (explicit, see role-aliases.csv)",
        "",
    ]
    for a in alias_rows:
        md.append(f"- `{a['raw_corpus_name']}` -> `{a['metadata_name'] or '(no metadata player)'}` "
                  f"({a['occurrences']} team-roster occurrences) — {a['reason']}")
    md += [
        "",
        "## Method",
        "",
        "- join key: `team + exact normalized player name` (NFC, casefold, strip spaces).",
        "- no fuzzy/similarity matching anywhere; 4/5-roster matches require the other 4 names to be exact.",
        "- All-Star and CT/T role systems kept separate (no merging, no AWP responsibility inference).",
        "- `AWPer / AWPer` in the infographic is a copy of the un-differentiated AWPer label; "
        "no primary/secondary AWP inference is made.",
        "",
        "## Known limitation",
        "",
        "- players with `alias-team-only` (FL4MUS/BetBoom, susp/Aurora) have NULL role fields "
        "and are excluded from role-conditioned analysis (they stay in team-level analysis).",
    ]
    open(os.path.join(ppc.PP_DIR, "role-join-report.md"), "w").write("\n".join(md))

    print(json.dumps({
        "post_pistol_team_rounds": len(pp_rows),
        "t": sum(1 for r in pp_rows if r["side"] == "t"),
        "ct": sum(1 for r in pp_rows if r["side"] == "ct"),
        "strict_rows": len(STRICT),
        "role_join": {"exact": n_exact, "alias_player": n_alias_player,
                      "alias_team": n_alias_team, "unresolved": n_unresolved},
        "exclusions": dict(excl),
    }, indent=2))


if __name__ == "__main__":
    main()
