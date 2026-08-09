#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy==2.5.1", "scikit-learn==1.9.0"]
# ///
"""Bounded final diagnostic for RoundSense Policy V3 purchase context.

The script reuses the frozen ``research_common`` player-round contract.  Demo
fields are used only as offline outcomes or to audit pre-decision state.  Every
live feature in the held-out ladders is available to normal-player GSI either
directly or through bounded, integrity-checked round history.

Outputs one deterministic JSON artifact covering:

* actual MR3 overtime reset/path behavior;
* conditional utility bundle allocation and map ablation;
* regulation current-state vs bounded-history held-out value.

This is observational evidence about professional choices, not an optimality
or causal estimator and not a runtime research-data loader.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import re
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median
from typing import Callable, Iterable, Sequence

import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import research_common as rc


EXPECTED_CORPUS_SHA256 = "33f29c35fb124a4e45d38a00be8f389d32403c0762576b607db7a9a37fe0d9e6"
FROZEN_ECONOMY_COMMIT = "0875db9"
FROZEN_POST_PISTOL_COMMIT = "ac8444f"
PARENT_COMMIT = "d194d17"
FOLDS = 5
SEED = 42
BOOTSTRAPS = 1000
MIN_CELL = 50
MAP_GO_MIN_BITS = 0.005
HISTORY_GO_MIN_BITS = 0.010

GRENADE_PRICES = {
    "smoke": 300,
    "flashbang": 200,
    "hegrenade": 300,
    "molotov": 400,
    "incendiary": 600,
    "decoy": 50,
}
KIT_PRICE = 400
UTILITY_TARGETS = ("smoke", "fire", "flash1", "flash2", "he", "kit")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def stable_hash(value: object) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def round4(value: float | None) -> float | None:
    if value is None or not math.isfinite(float(value)):
        return None
    return round(float(value), 4)


def series_of_map(map_key: str) -> str:
    return re.sub(r"-m\d+-de_[a-z0-9_]+$", "", map_key)


def ordinary_map_name(map_key: str) -> str:
    match = re.search(r"(de_[a-z0-9_]+)$", map_key)
    if not match:
        raise SystemExit(f"map name missing from corpus key: {map_key}")
    return match.group(1)


def round_in_half(round_number: int) -> int:
    return round_number if round_number <= 12 else round_number - 12


def context_of(round_number: int) -> str:
    position = round_in_half(round_number)
    if position == 1:
        return "PISTOL"
    if position == 2:
        return "POST_PISTOL"
    return "NORMAL"


def armor_state(has_armor: bool, has_helmet: bool) -> str:
    if has_helmet and not has_armor:
        raise SystemExit("illegal helmet without armor")
    return "vesthelm" if has_helmet else "kevlar" if has_armor else "none"


def primary_family(weapon: object, families: dict[str, str]) -> str:
    if not weapon:
        return "none"
    return families.get(str(weapon), "other")


def secondary_class(weapon: object) -> str:
    if not weapon:
        return "none"
    value = str(weapon)
    if value in rc.DEFAULT_PISTOLS:
        return "default"
    if value in rc.PAID_PISTOLS:
        return "paid"
    return "other"


def budget_band(value: int) -> str:
    if value < 200:
        return "000-199"
    if value < 300:
        return "200-299"
    if value < 400:
        return "300-399"
    if value < 500:
        return "400-499"
    if value < 600:
        return "500-599"
    if value < 800:
        return "600-799"
    if value < 1000:
        return "800-999"
    if value < 1200:
        return "1000-1199"
    return "1200+"


def percentile(values: Sequence[float], q: float) -> float | None:
    if not values:
        return None
    return float(np.percentile(np.asarray(values, dtype=float), q * 100.0))


def wilson_interval(successes: int, n: int) -> list[float | None]:
    if n == 0:
        return [None, None]
    z = 1.959963984540054
    p = successes / n
    denom = 1.0 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    radius = z * math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denom
    return [round4(max(0.0, centre - radius)), round4(min(1.0, centre + radius))]


def cluster_bootstrap_mean_ci(
    examples: Sequence[dict], value_fn: Callable[[dict], float], *, seed_offset: int = 0
) -> list[float | None]:
    if not examples:
        return [None, None]
    by_group: dict[str, list[dict]] = defaultdict(list)
    for example in examples:
        by_group[str(example["series"])].append(example)
    groups = sorted(by_group)
    if len(groups) < 2:
        return [None, None]
    rng = np.random.default_rng(SEED + seed_offset)
    estimates = []
    for _ in range(BOOTSTRAPS):
        picked = rng.integers(0, len(groups), len(groups))
        values = [value_fn(row) for index in picked for row in by_group[groups[int(index)]]]
        estimates.append(float(np.mean(values)))
    return [round4(float(np.percentile(estimates, 2.5))), round4(float(np.percentile(estimates, 97.5)))]


def group_folds(examples: Sequence[dict]) -> tuple[list[int], dict[str, int]]:
    counts = Counter(str(example["series"]) for example in examples)
    totals = [0] * FOLDS
    assignments: dict[str, int] = {}
    for group, count in sorted(counts.items(), key=lambda item: (-item[1], item[0])):
        fold = min(range(FOLDS), key=lambda index: (totals[index], index))
        assignments[group] = fold
        totals[fold] += count
    return [assignments[str(example["series"])] for example in examples], assignments


def opponent_loss_index(rows: Sequence[dict]) -> dict[tuple[str, int, str], int]:
    by_side: dict[tuple[str, int, str], int] = {}
    for row in rows:
        key = (str(row["map"]), int(row["roundNumber"]), str(row["side"]))
        value = int(row["lossIndex"])
        if key in by_side and by_side[key] != value:
            raise SystemExit(f"team loss index mismatch: {key}")
        by_side[key] = value
    result = {}
    for map_key, round_number, side in by_side:
        other = "t" if side == "ct" else "ct"
        value = by_side.get((map_key, round_number, other))
        if value is not None:
            result[(map_key, round_number, side)] = value
    return result


def actual_team_outcome(row: dict) -> str:
    return "W" if row["winnerSide"] == row["side"] else "L"


def load_helmet_module(repo_root: Path):
    path = repo_root / "experiments" / "ct-helmet-decision" / "helmet_decision_study.py"
    spec = importlib.util.spec_from_file_location("helmet_decision_study", path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot import helmet extraction helper: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def extract_predecision_replay_state(
    rows: Sequence[dict], maps_dir: Path
) -> tuple[dict[tuple[str, int, int], dict], dict]:
    """Recover current grenades/kit/armor from the previous round's end.

    ``retainedGrenades`` in the frozen player-round table is the previous
    freeze snapshot, so it cannot represent items consumed during that round.
    Replay end state is the narrow existing source that matches what live GSI
    would directly observe at the next decision.  Dead players start empty.
    """
    by_map: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_map[str(row["map"])].append(row)
    values: dict[tuple[str, int, int], dict] = {}
    records = []
    exclusions: Counter[str] = Counter()
    for map_key, map_rows in sorted(by_map.items()):
        archive = maps_dir / f"{map_key}.zip"
        if not archive.exists():
            exclusions["missing_event_package"] += len(map_rows)
            continue
        with zipfile.ZipFile(archive) as zipped:
            replay = json.loads(zipped.read("replay.json"))
        replay_rounds = {int(round_row["roundNumber"]): round_row for round_row in replay["rounds"]}
        for row in map_rows:
            round_number = int(row["roundNumber"])
            previous = replay_rounds.get(round_number - 1)
            if previous is None:
                exclusions["missing_previous_replay_round"] += 1
                continue
            track = next(
                (
                    player
                    for player in previous["players"]
                    if int(player["playerIndex"]) == int(row["playerIndex"])
                ),
                None,
            )
            if not track or not track.get("flags") or not track.get("armor") or not track.get("grenades"):
                exclusions["missing_previous_player_track"] += 1
                continue
            flags = int(track["flags"][-1])
            alive = bool(flags & 1)
            state = {
                "alive": alive,
                "armor": int(track["armor"][-1]) if alive else 0,
                "kit": bool(flags & 4) if alive else False,
                "grenades": list(track["grenades"][-1]) if alive else [],
            }
            key = (map_key, round_number, int(row["playerIndex"]))
            values[key] = state
            records.append({"map": map_key, "round": round_number, "player_index": key[2], **state})
    return values, {
        "requested_rows": len(rows),
        "extracted_rows": len(records),
        "exclusions": dict(sorted(exclusions.items())),
        "extraction_sha256": stable_hash(
            sorted(records, key=lambda record: (record["map"], record["round"], record["player_index"]))
        ),
        "source": "previous replay round final frame; flags bit 1 alive, bit 4 defuse kit",
    }


def ot_half_start(round_number: int) -> int:
    if round_number < 25:
        raise ValueError("not overtime")
    return round_number - ((round_number - 25) % 3)


def build_ot_examples(
    rows: Sequence[dict], families: dict[str, str], repo_root: Path, maps_dir: Path
) -> tuple[list[dict], dict]:
    overtime = [row for row in rows if bool(row["overtime"])]
    if len(overtime) != 1680:
        raise SystemExit(f"overtime player-row count changed: {len(overtime)}")

    grouped: dict[tuple[str, int, str], list[dict]] = defaultdict(list)
    for row in overtime:
        grouped[(str(row["map"]), int(row["roundNumber"]), str(row["teamKey"]))].append(row)
    if any(len(group) != 5 for group in grouped.values()):
        raise SystemExit("overtime team-round does not have five players")

    team_rounds: dict[tuple[str, int, str], dict] = {}
    for key, players in grouped.items():
        first = players[0]
        team_rounds[key] = {
            "side": str(first["side"]),
            "winner_side": str(first["winnerSide"]),
            "score": (int(first["scoreCT"]), int(first["scoreT"])),
        }

    starts = sorted({ot_half_start(int(row["roundNumber"])) for row in overtime})
    expected_starts = [25, 28, 31, 34, 37, 40, 43, 46]
    if starts != expected_starts:
        raise SystemExit(f"unexpected overtime half starts: {starts}")

    reset_rows = [row for row in overtime if int(row["roundNumber"]) == ot_half_start(int(row["roundNumber"]))]
    second_half_reset_rows = [row for row in reset_rows if ((int(row["roundNumber"]) - 25) // 3) % 2 == 1]
    first_half_reset_rows = [row for row in reset_rows if ((int(row["roundNumber"]) - 25) // 3) % 2 == 0]
    if any(int(row["startMoney"]) != 10000 for row in second_half_reset_rows):
        raise SystemExit("directly observed second-half overtime reset is not uniformly $10,000")
    stale_first_half = sum(int(row["moneySpent"]) > int(row["startMoney"]) for row in first_half_reset_rows)
    if stale_first_half == 0:
        raise SystemExit("expected first-half reset capture artifact was not observed")

    reset_freeze_money: dict[tuple[str, int, int], int] = {}
    reset_by_map: dict[str, list[dict]] = defaultdict(list)
    for row in reset_rows:
        reset_by_map[str(row["map"])].append(row)
    for map_key, map_rows in sorted(reset_by_map.items()):
        with zipfile.ZipFile(maps_dir / f"{map_key}.zip") as zipped:
            replay = json.loads(zipped.read("replay.json"))
        replay_rounds = {int(round_row["roundNumber"]): round_row for round_row in replay["rounds"]}
        for row in map_rows:
            replay_round = replay_rounds.get(int(row["roundNumber"]))
            track = next(
                (
                    player for player in replay_round["players"]
                    if int(player["playerIndex"]) == int(row["playerIndex"])
                ),
                None,
            ) if replay_round else None
            if not track or not track.get("money"):
                raise SystemExit("OT reset replay freeze-end money missing")
            reset_freeze_money[(str(row["map"]), int(row["roundNumber"]), int(row["playerIndex"]))] = int(track["money"][0])
    reconstructed_reset_money = [
        reset_freeze_money[(str(row["map"]), int(row["roundNumber"]), int(row["playerIndex"]))]
        + int(row["moneySpent"])
        for row in reset_rows
    ]
    if set(reconstructed_reset_money) != {10000}:
        raise SystemExit(f"OT reset reconstruction is not uniformly $10,000: {Counter(reconstructed_reset_money)}")

    exact_candidates = [
        row
        for row in overtime
        if int(row["roundNumber"]) % 3 != 1
        and int(row["roundNumber"]) != ot_half_start(int(row["roundNumber"]))
        and row["side"] == "ct"
        and bool(row["retainedArmor"])
        and not bool(row["retainedHelmet"])
        and bool(row["survivedPrev"])
    ]
    helmet_module = load_helmet_module(repo_root)
    exact_armor, extraction = helmet_module.extract_previous_end_armor(exact_candidates, maps_dir)

    examples: list[dict] = []
    for row in overtime:
        round_number = int(row["roundNumber"])
        start = ot_half_start(round_number)
        position = round_number - start + 1
        path = []
        for prior_round in range(start, round_number):
            previous = team_rounds.get((str(row["map"]), prior_round, str(row["teamKey"])))
            if previous is None:
                raise SystemExit("overtime path has missing previous team-round")
            path.append("W" if previous["winner_side"] == previous["side"] else "L")
        gave, received = rc.drop_flags(row)
        actual_drop = bool(row["dropGave"]) or bool(row["dropReceived"])
        retained_grenades = [] if position == 1 else rc.norm_grenades(row["retainedGrenades"])
        resulting_grenades = rc.norm_grenades(row["grenades"])
        retained_armor = False if position == 1 else bool(row["retainedArmor"])
        retained_helmet = False if position == 1 else bool(row["retainedHelmet"])
        key = (str(row["map"]), round_number, int(row["playerIndex"]))
        example = {
            "series": series_of_map(str(row["map"])),
            "map": str(row["map"]),
            "round": round_number,
            "half_start": start,
            "position": position,
            "path": "".join(path) or "START",
            "team_key": str(row["teamKey"]),
            "side": str(row["side"]),
            "clean": (
                position == 1
                or (
                    not bool(row["lossIndexAmbiguous"])
                    and not actual_drop
                    and not gave
                    and not received
                )
            ),
            "recorded_start_money": int(row["startMoney"]),
            "corrected_start_money": 10000 if position == 1 else int(row["startMoney"]),
            "retained_armor": retained_armor,
            "retained_helmet": retained_helmet,
            "retained_primary": None if position == 1 else row.get("retainedPrimary"),
            "retained_grenades": retained_grenades,
            "has_armor": bool(row["hasArmor"]),
            "has_helmet": bool(row["hasHelmet"]),
            "has_kit": bool(row["hasDefuseKit"]),
            "primary_family": primary_family(row.get("primary"), families),
            "money_spent": int(row["moneySpent"]),
            "grenades": resulting_grenades,
            "utility_count": len(resulting_grenades),
            "smoke": int("smoke" in resulting_grenades),
            "fire": int("molotov" in resulting_grenades or "incendiary" in resulting_grenades),
            "flash1": int(resulting_grenades.count("flashbang") >= 1),
            "flash2": int(resulting_grenades.count("flashbang") >= 2),
            "he": int("hegrenade" in resulting_grenades),
            "exact_pre_armor": exact_armor.get(key),
        }
        example["fresh_choice"] = (
            armor_state(example["has_armor"], example["has_helmet"])
            if not retained_armor and not retained_helmet
            else None
        )
        example["full_armor_upgrade"] = (
            int(example["has_helmet"])
            if exact_armor.get(key) == 100 and not retained_helmet
            else None
        )
        examples.append(example)

    reset_team_rounds = {
        (example["map"], example["round"], example["team_key"])
        for example in examples
        if example["position"] == 1
    }
    reset_match_halves = {(example["map"], example["round"]) for example in examples if example["position"] == 1}
    half_side_sets: dict[tuple[str, int, str], set[str]] = defaultdict(set)
    for example in examples:
        half_side_sets[(example["map"], example["half_start"], example["team_key"])].add(example["side"])
    if any(len(sides) != 1 for sides in half_side_sets.values()):
        raise SystemExit("side changed within a three-round OT half")
    block_half_pairs = 0
    for map_key in sorted({example["map"] for example in examples}):
        starts_for_map = sorted({example["half_start"] for example in examples if example["map"] == map_key})
        for first_start in [start for start in starts_for_map if ((start - 25) // 3) % 2 == 0]:
            second_start = first_start + 3
            if second_start not in starts_for_map:
                continue
            block_half_pairs += 1
            team_keys = {example["team_key"] for example in examples if example["map"] == map_key and example["half_start"] == first_start}
            for team_key in team_keys:
                first_side = next(iter(half_side_sets[(map_key, first_start, team_key)]))
                second_side = next(iter(half_side_sets[(map_key, second_start, team_key)]))
                if first_side == second_side:
                    raise SystemExit("OT block did not swap sides between MR3 halves")
    audit = {
        "player_rows": len(overtime),
        "maps": len({row["map"] for row in overtime}),
        "match_series": len({series_of_map(str(row["map"])) for row in overtime}),
        "team_rounds": len(grouped),
        "match_half_starts": len(reset_match_halves),
        "team_half_starts": len(reset_team_rounds),
        "half_starts": len(reset_team_rounds),
        "complete_block_half_pairs": block_half_pairs,
        "side_constant_within_half": True,
        "side_swapped_between_block_halves": True,
        "observed_round_range": [min(int(row["roundNumber"]) for row in overtime), max(int(row["roundNumber"]) for row in overtime)],
        "score_at_first_ot": sorted({(int(row["scoreCT"]), int(row["scoreT"])) for row in overtime if int(row["roundNumber"]) == 25}),
        "half_start_rounds": starts,
        "direct_10000_second_half_player_rows": len(second_half_reset_rows),
        "second_half_reset_all_10000": True,
        "first_half_reset_player_rows": len(first_half_reset_rows),
        "first_half_recorded_money_below_spend": stale_first_half,
        "first_half_start_money_status": "STALE_PRE_RESTART_CAPTURE",
        "reconstructed_10000_reset_player_rows": len(reconstructed_reset_money),
        "reset_money_reconstruction": "freeze-end replay money[0] + player-economies moneySpent",
        "corrected_reset_contract": "$10,000 and empty retained inventory at every three-round OT half start",
        "different_rule_states_observed": False,
        "pre_armor_extraction": extraction,
    }
    return examples, audit


def summarize_ot_group(examples: Sequence[dict], side: str, path: str) -> dict:
    raw_rows = [example for example in examples if example["side"] == side and example["path"] == path]
    rows = [example for example in raw_rows if example["clean"]]
    raw_team_rounds = {(row["map"], row["round"], row["team_key"]) for row in raw_rows}
    team_rounds = {(row["map"], row["round"], row["team_key"]) for row in rows}
    clean_counts = Counter((row["map"], row["round"], row["team_key"]) for row in rows)
    fresh = [row for row in rows if row["fresh_choice"] is not None]
    full_upgrade = [row for row in rows if row["full_armor_upgrade"] is not None]

    def rate(group: Sequence[dict], predicate: Callable[[dict], bool]) -> float | None:
        return sum(predicate(row) for row in group) / len(group) if group else None

    return {
        "side": side,
        "path": path,
        "position": 1 if path == "START" else len(path) + 1,
        "raw_player_rows": len(raw_rows),
        "raw_team_rounds": len(raw_team_rounds),
        "player_rows": len(rows),
        "team_rounds": len(team_rounds),
        "complete_clean_team_rounds": sum(count == 5 for count in clean_counts.values()),
        "maps": len({row["map"] for row in rows}),
        "match_series": len({row["series"] for row in rows}),
        "spend": {
            "mean": round4(float(np.mean([row["money_spent"] for row in rows]))) if rows else None,
            "median": round4(float(np.median([row["money_spent"] for row in rows]))) if rows else None,
            "p25": round4(percentile([row["money_spent"] for row in rows], 0.25)),
            "p75": round4(percentile([row["money_spent"] for row in rows], 0.75)),
        },
        "primary_probability": {
            family: round4(rate(rows, lambda row, family=family: row["primary_family"] == family))
            for family in ("rifle", "sniper", "smg", "heavy", "none")
        },
        "fresh_armor": {
            "n": len(fresh),
            "no_armor": round4(rate(fresh, lambda row: row["fresh_choice"] == "none")),
            "kevlar": round4(rate(fresh, lambda row: row["fresh_choice"] == "kevlar")),
            "vesthelm": round4(rate(fresh, lambda row: row["fresh_choice"] == "vesthelm")),
            "vesthelm_cluster_ci95": cluster_bootstrap_mean_ci(
                fresh, lambda row: float(row["fresh_choice"] == "vesthelm"), seed_offset=len(path) + (0 if side == "ct" else 10)
            ),
        },
        "full_armor_no_helmet": {
            "n": len(full_upgrade),
            "helmet_upgrade": round4(rate(full_upgrade, lambda row: bool(row["full_armor_upgrade"]))),
            "helmet_upgrade_cluster_ci95": cluster_bootstrap_mean_ci(
                full_upgrade, lambda row: float(bool(row["full_armor_upgrade"])), seed_offset=20 + len(path)
            ),
        },
        "utility": {
            "grenade_count_mean": round4(float(np.mean([row["utility_count"] for row in rows]))) if rows else None,
            **{item: round4(rate(rows, lambda row, item=item: bool(row[item]))) for item in ("smoke", "fire", "flash1", "flash2", "he")},
            "kit": round4(rate(rows, lambda row: bool(row["has_kit"]))) if side == "ct" else None,
        },
    }


def overtime_analysis(
    rows: Sequence[dict], families: dict[str, str], repo_root: Path, maps_dir: Path
) -> dict:
    examples, audit = build_ot_examples(rows, families, repo_root, maps_dir)
    path_order = ["START", "W", "L", "WW", "WL", "LW", "LL"]
    summaries = [summarize_ot_group(examples, side, path) for side in ("ct", "t") for path in path_order]
    summaries = [summary for summary in summaries if summary["player_rows"] > 0]
    return {
        "audit": audit,
        "path_summaries": summaries,
        "support_rule": "rates use clean player rows; team_rounds and match_series expose clustering/support",
        "chronology_claim": "not used",
    }


def utility_delta(row: dict, prestate: dict) -> tuple[dict[str, int] | None, str | None]:
    retained = Counter(prestate["grenades"])
    resulting = Counter(rc.norm_grenades(row["grenades"]))
    if any(resulting[item] < retained[item] for item in retained):
        return None, "resulting_grenade_below_retained"
    if bool(prestate["kit"]) and not bool(row["hasDefuseKit"]):
        return None, "resulting_kit_below_retained"
    bought = {item: max(0, resulting[item] - retained[item]) for item in set(retained) | set(resulting)}
    grenade_cost = sum(GRENADE_PRICES.get(item, 0) * count for item, count in bought.items())
    kit_bought = int(row["side"] == "ct" and bool(row["hasDefuseKit"]) and not bool(prestate["kit"]))
    utility_cost = grenade_cost + KIT_PRICE * kit_bought
    budget = int(row["startMoney"]) - (int(row["moneySpent"]) - utility_cost)
    if budget < 0 or budget > 16000:
        return None, "utility_budget_out_of_range"
    return {
        "utility_purchase_cost": utility_cost,
        "utility_budget": budget,
        "kit_bought": kit_bought,
    }, None


def build_regulation_examples(
    strict: Sequence[dict], all_rows: Sequence[dict], families: dict[str, str], maps_dir: Path
) -> tuple[list[dict], dict]:
    opponent_losses = opponent_loss_index([row for row in all_rows if not bool(row["overtime"])])
    exclusions: Counter[str] = Counter()
    examples: list[dict] = []
    replay_candidates = [row for row in strict if int(row["roundNumber"]) not in {1, 13}]
    predecision_states, extraction = extract_predecision_replay_state(replay_candidates, maps_dir)
    for row in strict:
        round_number = int(row["roundNumber"])
        if round_number in {1, 13}:
            exclusions["pistol_round"] += 1
            continue
        if row.get("correctedRetainedPrimary") == "UNKNOWN":
            exclusions["retained_primary_unknown"] += 1
            continue
        state_key = (str(row["map"]), round_number, int(row["playerIndex"]))
        prestate = predecision_states.get(state_key)
        if prestate is None:
            exclusions["predecision_replay_state_missing"] += 1
            continue
        delta, reason = utility_delta(row, prestate)
        if delta is None:
            exclusions[reason or "utility_delta_unknown"] += 1
            continue
        other_loss = opponent_losses.get((str(row["map"]), round_number, str(row["side"])))
        if other_loss is None:
            exclusions["opponent_loss_index_missing"] += 1
            continue
        grenades = rc.norm_grenades(row["grenades"])
        retained_grenades = list(prestate["grenades"])
        side = str(row["side"])
        own_score = int(row["scoreCT"] if side == "ct" else row["scoreT"])
        opponent_score = int(row["scoreT"] if side == "ct" else row["scoreCT"])
        example = {
            "series": series_of_map(str(row["map"])),
            "map": str(row["map"]),
            "map_name": ordinary_map_name(str(row["map"])),
            "round": round_number,
            "round_in_half": round_in_half(round_number),
            "context": context_of(round_number),
            "team_key": str(row["teamKey"]),
            "player_index": int(row["playerIndex"]),
            "side": side,
            "start_money": int(row["startMoney"]),
            "money_band": int(row["startMoney"]) // 250,
            "loss_index": max(0, min(4, int(row["lossIndex"]))),
            "opponent_loss_index": max(0, min(4, int(other_loss))),
            "own_score": own_score,
            "opponent_score": opponent_score,
            "score_diff": own_score - opponent_score,
            "retained_primary_family": primary_family(row.get("correctedRetainedPrimary"), families),
            "retained_secondary_class": secondary_class(row.get("retainedSecondary")),
            "retained_armor": int(int(prestate["armor"]) > 0),
            "retained_helmet": int(bool(row["retainedHelmet"]) and bool(prestate["alive"])),
            "retained_kit": int(bool(prestate["kit"])),
            "retained_smoke": int("smoke" in retained_grenades),
            "retained_fire": int("molotov" in retained_grenades or "incendiary" in retained_grenades),
            "retained_flash_count": retained_grenades.count("flashbang"),
            "retained_he": int("hegrenade" in retained_grenades),
            "retained_grenade_count": len(retained_grenades),
            "economic_mode": str(row["actionType"]),
            "resulting_primary_family": primary_family(row.get("primary"), families),
            "resulting_armor_state": armor_state(bool(row["hasArmor"]), bool(row["hasHelmet"])),
            "utility_budget": int(delta["utility_budget"]),
            "utility_budget_band": budget_band(int(delta["utility_budget"])),
            "utility_purchase_cost": int(delta["utility_purchase_cost"]),
            "grenades": grenades,
            "smoke": int("smoke" in grenades),
            "fire": int("molotov" in grenades or "incendiary" in grenades),
            "flash1": int(grenades.count("flashbang") >= 1),
            "flash2": int(grenades.count("flashbang") >= 2),
            "he": int("hegrenade" in grenades),
            "kit": int(side == "ct" and bool(row["hasDefuseKit"])),
        }
        examples.append(example)

    raw_by_team_half: dict[tuple[str, str, str], dict[int, dict]] = defaultdict(dict)
    for row in strict:
        round_number = int(row["roundNumber"])
        half = "h1" if round_number <= 12 else "h2"
        raw_by_team_half[(str(row["map"]), half, str(row["teamKey"]))].setdefault(round_number, row)
    for example in examples:
        half = "h1" if example["round"] <= 12 else "h2"
        raw_lookup = raw_by_team_half[(example["map"], half, example["team_key"])]
        prior_rounds = sorted(round_number for round_number in raw_lookup if round_number < example["round"])[-3:]
        history = [actual_team_outcome(raw_lookup[round_number]) for round_number in prior_rounds]
        plants = [
            int(
                raw_lookup[round_number]["side"] == "t"
                and raw_lookup[round_number]["endReason"] in {"target_bombed", "bomb_defused"}
            )
            for round_number in prior_rounds
        ]
        padded_history = ["NONE"] * (3 - len(history)) + history
        padded_plants = [0] * (3 - len(plants)) + plants
        example["history_length"] = len(history)
        example["history_last3"] = "".join(history) if history else "START"
        example["history_last1"] = padded_history[-1]
        example["history_last2"] = "".join(padded_history[-2:])
        example["history_previous_t_plant"] = padded_plants[-1]
        example["history_t_plant_last3"] = int(any(padded_plants))

    expected = len(strict) - exclusions["pistol_round"] - exclusions["retained_primary_unknown"]
    if len(examples) > expected:
        raise SystemExit("regulation example accounting overflow")
    return examples, {
        "strict_player_rows": len(strict),
        "analysis_player_rows": len(examples),
        "match_series": len({example["series"] for example in examples}),
        "maps": len({example["map"] for example in examples}),
        "map_names": dict(sorted(Counter(example["map_name"] for example in examples).items())),
        "exclusions": dict(sorted(exclusions.items())),
        "predecision_replay_extraction": extraction,
        "chronology_recoverable": False,
        "allocation_representation": "previous replay end pre-state to resulting freeze-end bundle; utility budget after fixed non-utility spend",
    }


def current_features(example: dict, stage: str, *, include_map: bool = False, include_history: bool = False) -> dict:
    features: dict[str, object] = {
        "side": example["side"],
        "start_money_scaled": example["start_money"] / 1000.0,
        "money_band": str(example["money_band"]),
        "loss_index": str(example["loss_index"]),
        "opponent_loss_index": str(example["opponent_loss_index"]),
        "round_context": example["context"],
        "round_in_half": float(example["round_in_half"]),
        "score_diff": float(example["score_diff"]),
        "own_score": float(example["own_score"]),
        "opponent_score": float(example["opponent_score"]),
        "retained_primary_family": example["retained_primary_family"],
        "retained_secondary_class": example["retained_secondary_class"],
        "retained_armor": str(example["retained_armor"]),
        "retained_helmet": str(example["retained_helmet"]),
        "retained_kit": str(example["retained_kit"]),
        "retained_smoke": str(example["retained_smoke"]),
        "retained_fire": str(example["retained_fire"]),
        "retained_flash_count": str(example["retained_flash_count"]),
        "retained_he": str(example["retained_he"]),
        "retained_grenade_count": str(example["retained_grenade_count"]),
        # Explicit interactions keep the linear held-out estimator from
        # mistaking model misspecification for history value.  Every component
        # is already in the deployable current state.
        "state_side_context": f"{example['side']}:{example['context']}",
        "state_context_money": f"{example['context']}:{example['money_band']}",
        "state_side_context_money": f"{example['side']}:{example['context']}:{example['money_band']}",
        "state_side_loss_money": f"{example['side']}:{example['loss_index']}:{example['money_band']}",
        "state_side_round": f"{example['side']}:{example['round_in_half']}",
        "state_side_retained_primary": f"{example['side']}:{example['retained_primary_family']}",
    }
    if stage in {"major", "utility"}:
        features["economic_mode"] = example["economic_mode"]
        features["state_side_mode"] = f"{example['side']}:{example['economic_mode']}"
        features["state_mode_money"] = f"{example['economic_mode']}:{example['money_band']}"
    if stage == "utility":
        features.update({
            "resulting_primary_family": example["resulting_primary_family"],
            "resulting_armor_state": example["resulting_armor_state"],
            "utility_budget_scaled": example["utility_budget"] / 1000.0,
            "utility_budget_band": example["utility_budget_band"],
            "state_side_mode_utility_budget": f"{example['side']}:{example['economic_mode']}:{example['utility_budget_band']}",
            "state_primary_armor_utility_budget": (
                f"{example['resulting_primary_family']}:{example['resulting_armor_state']}:{example['utility_budget_band']}"
            ),
        })
    if include_map:
        features["map_name"] = example["map_name"]
    if include_history:
        features.update({
            "history_length": str(example["history_length"]),
            "history_last1": example["history_last1"],
            "history_last2": example["history_last2"],
            "history_last3": example["history_last3"],
            "history_previous_t_plant": str(example["history_previous_t_plant"]),
            "history_t_plant_last3": str(example["history_t_plant_last3"]),
        })
    return features


def oof_binary(
    examples: Sequence[dict], target: str, feature_fn: Callable[[dict], dict], fold_ids: Sequence[int]
) -> np.ndarray:
    from sklearn.feature_extraction import DictVectorizer
    from sklearn.linear_model import LogisticRegression

    labels = np.asarray([int(example[target]) for example in examples], dtype=int)
    predictions = np.zeros(len(examples), dtype=float)
    for fold in range(FOLDS):
        train = [index for index, fold_id in enumerate(fold_ids) if fold_id != fold]
        test = [index for index, fold_id in enumerate(fold_ids) if fold_id == fold]
        vectorizer = DictVectorizer(sparse=True)
        train_x = vectorizer.fit_transform([feature_fn(examples[index]) for index in train])
        test_x = vectorizer.transform([feature_fn(examples[index]) for index in test])
        train_y = labels[train]
        if len(set(train_y)) < 2:
            predictions[test] = float(np.mean(train_y))
            continue
        model = LogisticRegression(max_iter=3000, random_state=SEED, solver="lbfgs")
        model.fit(train_x, train_y)
        predictions[test] = model.predict_proba(test_x)[:, list(model.classes_).index(1)]
    return np.clip(predictions, 1e-9, 1 - 1e-9)


def oof_multiclass(
    examples: Sequence[dict], target: str, feature_fn: Callable[[dict], dict], fold_ids: Sequence[int]
) -> tuple[np.ndarray, list[str]]:
    from sklearn.feature_extraction import DictVectorizer
    from sklearn.linear_model import LogisticRegression

    classes = sorted({str(example[target]) for example in examples})
    class_index = {label: index for index, label in enumerate(classes)}
    labels = np.asarray([class_index[str(example[target])] for example in examples], dtype=int)
    predictions = np.zeros((len(examples), len(classes)), dtype=float)
    for fold in range(FOLDS):
        train = [index for index, fold_id in enumerate(fold_ids) if fold_id != fold]
        test = [index for index, fold_id in enumerate(fold_ids) if fold_id == fold]
        vectorizer = DictVectorizer(sparse=True)
        train_x = vectorizer.fit_transform([feature_fn(examples[index]) for index in train])
        test_x = vectorizer.transform([feature_fn(examples[index]) for index in test])
        model = LogisticRegression(max_iter=3000, random_state=SEED, solver="lbfgs")
        model.fit(train_x, labels[train])
        fold_predictions = model.predict_proba(test_x)
        for column, observed_class in enumerate(model.classes_):
            predictions[test, int(observed_class)] = fold_predictions[:, column]
    predictions = np.clip(predictions, 1e-9, 1.0)
    predictions /= predictions.sum(axis=1, keepdims=True)
    return predictions, classes


def binary_losses(examples: Sequence[dict], target: str, predictions: np.ndarray) -> np.ndarray:
    labels = np.asarray([int(example[target]) for example in examples], dtype=float)
    return -(labels * np.log2(predictions) + (1 - labels) * np.log2(1 - predictions))


def multiclass_losses(examples: Sequence[dict], target: str, predictions: np.ndarray, classes: Sequence[str]) -> np.ndarray:
    class_index = {label: index for index, label in enumerate(classes)}
    labels = np.asarray([class_index[str(example[target])] for example in examples], dtype=int)
    return -np.log2(predictions[np.arange(len(labels)), labels])


def paired_cluster_ci(examples: Sequence[dict], improvements: np.ndarray, seed_offset: int = 0) -> list[float | None]:
    by_group: dict[str, list[int]] = defaultdict(list)
    for index, example in enumerate(examples):
        by_group[str(example["series"])].append(index)
    groups = sorted(by_group)
    if len(groups) < 2:
        return [None, None]
    rng = np.random.default_rng(SEED + seed_offset)
    estimates = []
    for _ in range(BOOTSTRAPS):
        picked = rng.integers(0, len(groups), len(groups))
        indices = [index for group_index in picked for index in by_group[groups[int(group_index)]]]
        estimates.append(float(np.mean(improvements[indices])))
    return [round4(float(np.percentile(estimates, 2.5))), round4(float(np.percentile(estimates, 97.5)))]


def comparison_summary(
    examples: Sequence[dict], fold_ids: Sequence[int], baseline_losses: np.ndarray, extended_losses: np.ndarray,
    *, seed_offset: int = 0
) -> dict:
    improvement = baseline_losses - extended_losses
    per_fold = []
    for fold in range(FOLDS):
        indices = [index for index, fold_id in enumerate(fold_ids) if fold_id == fold]
        per_fold.append(round4(float(np.mean(improvement[indices]))))
    return {
        "n": len(examples),
        "match_series": len({example["series"] for example in examples}),
        "baseline_log_loss_bits": round4(float(np.mean(baseline_losses))),
        "extended_log_loss_bits": round4(float(np.mean(extended_losses))),
        "improvement_bits": round4(float(np.mean(improvement))),
        "improvement_cluster_ci95": paired_cluster_ci(examples, improvement, seed_offset),
        "fold_improvement_bits": per_fold,
        "positive_folds": sum(value is not None and value > 0 for value in per_fold),
    }


def evaluate_binary_extension(
    examples: Sequence[dict], target: str, baseline_fn: Callable[[dict], dict], extended_fn: Callable[[dict], dict],
    *, seed_offset: int = 0
) -> tuple[dict, np.ndarray, np.ndarray, list[int]]:
    fold_ids, _ = group_folds(examples)
    baseline_predictions = oof_binary(examples, target, baseline_fn, fold_ids)
    extended_predictions = oof_binary(examples, target, extended_fn, fold_ids)
    baseline = binary_losses(examples, target, baseline_predictions)
    extended = binary_losses(examples, target, extended_predictions)
    summary = comparison_summary(examples, fold_ids, baseline, extended, seed_offset=seed_offset)
    labels = np.asarray([int(example[target]) for example in examples], dtype=float)
    summary.update({
        "target": target,
        "prevalence": round4(float(np.mean(labels))),
        "baseline_brier": round4(float(np.mean((baseline_predictions - labels) ** 2))),
        "extended_brier": round4(float(np.mean((extended_predictions - labels) ** 2))),
    })
    return summary, baseline, extended, fold_ids


def evaluate_multiclass_extension(
    examples: Sequence[dict], target: str, baseline_fn: Callable[[dict], dict], extended_fn: Callable[[dict], dict],
    *, seed_offset: int = 0
) -> tuple[dict, np.ndarray, np.ndarray, list[int]]:
    fold_ids, _ = group_folds(examples)
    baseline_predictions, classes = oof_multiclass(examples, target, baseline_fn, fold_ids)
    extended_predictions, extended_classes = oof_multiclass(examples, target, extended_fn, fold_ids)
    if classes != extended_classes:
        raise SystemExit("multiclass extension changed target classes")
    baseline = multiclass_losses(examples, target, baseline_predictions, classes)
    extended = multiclass_losses(examples, target, extended_predictions, classes)
    summary = comparison_summary(examples, fold_ids, baseline, extended, seed_offset=seed_offset)
    labels = np.asarray([classes.index(str(example[target])) for example in examples], dtype=int)
    summary.update({
        "target": target,
        "classes": classes,
        "class_support": dict(sorted(Counter(str(example[target]) for example in examples).items())),
        "baseline_accuracy": round4(float(np.mean(np.argmax(baseline_predictions, axis=1) == labels))),
        "extended_accuracy": round4(float(np.mean(np.argmax(extended_predictions, axis=1) == labels))),
    })
    return summary, baseline, extended, fold_ids


def aggregate_multilabel_extension(
    examples: Sequence[dict], baseline_fn: Callable[[dict], dict], extended_fn: Callable[[dict], dict], *, seed_offset: int
) -> tuple[dict, dict[str, dict], dict[str, tuple[np.ndarray, np.ndarray]]]:
    per_target: dict[str, dict] = {}
    loss_pairs: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    combined_examples: list[dict] = []
    combined_baseline: list[float] = []
    combined_extended: list[float] = []
    combined_fold_ids: list[int] = []
    for target_index, target in enumerate(UTILITY_TARGETS):
        cohort = [example for example in examples if target != "kit" or example["side"] == "ct"]
        summary, baseline, extended, fold_ids = evaluate_binary_extension(
            cohort, target, baseline_fn, extended_fn, seed_offset=seed_offset + target_index
        )
        per_target[target] = summary
        loss_pairs[target] = (baseline, extended)
        for example, base_loss, ext_loss, fold_id in zip(cohort, baseline, extended, fold_ids):
            combined_examples.append(example)
            combined_baseline.append(float(base_loss))
            combined_extended.append(float(ext_loss))
            combined_fold_ids.append(fold_id)
    aggregate = comparison_summary(
        combined_examples,
        combined_fold_ids,
        np.asarray(combined_baseline),
        np.asarray(combined_extended),
        seed_offset=seed_offset + 20,
    )
    aggregate["target"] = "macro utility item allocation"
    aggregate["target_observations"] = len(combined_examples)
    return aggregate, per_target, loss_pairs


def fresh_surface(examples: Sequence[dict], *, include_mode: bool) -> list[dict]:
    fresh = [
        example for example in examples
        if example["retained_grenade_count"] == 0 and example["retained_kit"] == 0
    ]
    groups: dict[tuple[str, ...], list[dict]] = defaultdict(list)
    for example in fresh:
        key = [example["side"]]
        if include_mode:
            key.append(example["economic_mode"])
        key.append(example["utility_budget_band"])
        groups[tuple(key)].append(example)
    result = []
    for key, group in sorted(groups.items()):
        series = {example["series"] for example in group}
        if len(group) < MIN_CELL or len(series) < 10:
            continue
        record = {
            "side": key[0],
            "economic_mode": key[1] if include_mode else "ALL",
            "utility_budget_band": key[-1],
            "n": len(group),
            "match_series": len(series),
            "primary_family_support": dict(sorted(Counter(example["resulting_primary_family"] for example in group).items())),
            "armor_state_support": dict(sorted(Counter(example["resulting_armor_state"] for example in group).items())),
            "probabilities": {},
        }
        for target in UTILITY_TARGETS:
            if target == "kit" and key[0] != "ct":
                continue
            successes = sum(int(example[target]) for example in group)
            record["probabilities"][target] = {
                "rate": round4(successes / len(group)),
                "wilson_ci95": wilson_interval(successes, len(group)),
            }
        result.append(record)
    return result


def he_vs_second_flash(examples: Sequence[dict]) -> list[dict]:
    result = []
    for side in ("ct", "t"):
        cohort = []
        for example in examples:
            if example["side"] != side:
                continue
            grenades = example["grenades"]
            if len(grenades) != 4 or "decoy" in grenades:
                continue
            has_core = (
                "smoke" in grenades
                and ("molotov" in grenades or "incendiary" in grenades)
                and grenades.count("flashbang") >= 1
            )
            he = "hegrenade" in grenades
            flash2 = grenades.count("flashbang") >= 2
            if has_core and he != flash2:
                copy = dict(example)
                copy["choice_he"] = int(he)
                cohort.append(copy)
        he_count = sum(example["choice_he"] for example in cohort)
        result.append({
            "side": side,
            "definition": "four-slot final grenade bundle with smoke + fire + flash1; XOR HE vs flash2",
            "n": len(cohort),
            "match_series": len({example["series"] for example in cohort}),
            "maps": len({example["map"] for example in cohort}),
            "he_rate": round4(he_count / len(cohort)) if cohort else None,
            "he_wilson_ci95": wilson_interval(he_count, len(cohort)),
            "he_cluster_ci95": cluster_bootstrap_mean_ci(cohort, lambda example: float(example["choice_he"]), seed_offset=80 if side == "ct" else 81),
            "flash2_rate": round4(1 - he_count / len(cohort)) if cohort else None,
            "per_map": [
                {
                    "map": map_name,
                    "n": len(group),
                    "he_rate": round4(sum(example["choice_he"] for example in group) / len(group)),
                }
                for map_name, group in sorted(
                    (name, [example for example in cohort if example["map_name"] == name])
                    for name in {example["map_name"] for example in cohort}
                )
            ],
        })
    return result


def utility_map_analysis(examples: Sequence[dict]) -> dict:
    baseline_fn = lambda example: current_features(example, "utility")
    map_fn = lambda example: current_features(example, "utility", include_map=True)
    aggregate, per_target, loss_pairs = aggregate_multilabel_extension(
        examples, baseline_fn, map_fn, seed_offset=100
    )

    per_map = []
    for map_name in sorted({example["map_name"] for example in examples}):
        target_deltas = {}
        combined = []
        support = 0
        series = set()
        for target, (baseline, extended) in loss_pairs.items():
            cohort = [example for example in examples if target != "kit" or example["side"] == "ct"]
            indices = [index for index, example in enumerate(cohort) if example["map_name"] == map_name]
            if not indices:
                continue
            deltas = baseline[indices] - extended[indices]
            target_deltas[target] = round4(float(np.mean(deltas)))
            combined.extend(float(value) for value in deltas)
            support += len(indices)
            series.update(cohort[index]["series"] for index in indices)
        per_map.append({
            "map": map_name,
            "player_rows": sum(example["map_name"] == map_name for example in examples),
            "target_observations": support,
            "match_series": len(series),
            "mean_improvement_bits": round4(float(np.mean(combined))) if combined else None,
            "target_improvement_bits": target_deltas,
        })

    ci = aggregate["improvement_cluster_ci95"]
    supported_maps = [row for row in per_map if row["player_rows"] >= 500 and row["match_series"] >= 20]
    positive_maps = sum((row["mean_improvement_bits"] or 0) > 0 for row in supported_maps)
    gate = (
        (aggregate["improvement_bits"] or 0) >= MAP_GO_MIN_BITS
        and ci[0] is not None and ci[0] > 0
        and aggregate["positive_folds"] >= 4
        and positive_maps >= 5
    )
    return {
        "feature_boundary": {
            "map_name": "OBSERVED in ordinary normal-player GSI map.name",
            "position_or_role": "FORBIDDEN_ORACLE",
        },
        "held_out_map_ablation": {
            "grouping": f"{FOLDS}-fold held out by match series",
            "base_state": "side + utility budget + retained utility + mode + selected primary family + selected armor + round/score/loss context",
            "extension": "base + ordinary GSI map.name",
            "aggregate": aggregate,
            "per_target": per_target,
            "per_map": per_map,
            "gate": {
                "minimum_mean_improvement_bits": MAP_GO_MIN_BITS,
                "requires_ci_above_zero": True,
                "requires_positive_folds": 4,
                "requires_positive_supported_maps": 5,
                "supported_maps": len(supported_maps),
                "positive_supported_maps": positive_maps,
                "decision": "GO" if gate else "NO_GO",
            },
        },
        "fresh_budget_surface": fresh_surface(examples, include_mode=False),
        "fresh_mode_budget_surface": fresh_surface(examples, include_mode=True),
        "he_vs_second_flash": he_vs_second_flash(examples),
        "chronology": {
            "recoverable": False,
            "claim_scope": "bundle allocation and marginal opportunity-cost preference only",
        },
    }


def subset_comparison(
    examples: Sequence[dict], baseline: np.ndarray, extended: np.ndarray, fold_ids: Sequence[int], predicate: Callable[[dict], bool]
) -> dict:
    indices = [index for index, example in enumerate(examples) if predicate(example)]
    if not indices:
        return {"n": 0}
    improvement = baseline[indices] - extended[indices]
    subset_examples = [examples[index] for index in indices]
    return {
        "n": len(indices),
        "match_series": len({examples[index]["series"] for index in indices}),
        "baseline_log_loss_bits": round4(float(np.mean(baseline[indices]))),
        "extended_log_loss_bits": round4(float(np.mean(extended[indices]))),
        "improvement_bits": round4(float(np.mean(improvement))),
        "improvement_cluster_ci95": paired_cluster_ci(subset_examples, improvement, seed_offset=260),
        "positive_folds": sum(
            float(np.mean([improvement[position] for position, index in enumerate(indices) if fold_ids[index] == fold])) > 0
            for fold in range(FOLDS)
            if any(fold_ids[index] == fold for index in indices)
        ),
    }


def regulation_trajectory_analysis(examples: Sequence[dict]) -> dict:
    mode_base = lambda example: current_features(example, "mode")
    mode_history = lambda example: current_features(example, "mode", include_history=True)
    mode_summary, mode_losses, mode_history_losses, mode_folds = evaluate_multiclass_extension(
        examples, "economic_mode", mode_base, mode_history, seed_offset=200
    )

    major_base = lambda example: current_features(example, "major")
    major_history = lambda example: current_features(example, "major", include_history=True)
    major_summary, major_losses, major_history_losses, major_folds = evaluate_multiclass_extension(
        examples, "resulting_primary_family", major_base, major_history, seed_offset=210
    )

    utility_base = lambda example: current_features(example, "utility")
    utility_history = lambda example: current_features(example, "utility", include_history=True)
    utility_summary, utility_targets, _ = aggregate_multilabel_extension(
        examples, utility_base, utility_history, seed_offset=220
    )

    targets = {
        "economic_mode": mode_summary,
        "major_primary_family": major_summary,
        "utility_allocation": utility_summary,
    }
    passing = []
    for name, summary in targets.items():
        ci = summary["improvement_cluster_ci95"]
        if (
            (summary["improvement_bits"] or 0) >= HISTORY_GO_MIN_BITS
            and ci[0] is not None and ci[0] > 0
            and summary["positive_folds"] >= 4
        ):
            passing.append(name)

    context_diagnostics = {
        "economic_mode": {
            context: subset_comparison(
                examples, mode_losses, mode_history_losses, mode_folds,
                lambda example, context=context: example["context"] == context,
            )
            for context in ("POST_PISTOL", "NORMAL")
        },
        "major_primary_family": {
            context: subset_comparison(
                examples, major_losses, major_history_losses, major_folds,
                lambda example, context=context: example["context"] == context,
            )
            for context in ("POST_PISTOL", "NORMAL")
        },
    }

    post_pistol = [example for example in examples if example["context"] == "POST_PISTOL"]
    post_base = lambda example: current_features(example, "mode")
    post_outcome = lambda example: {
        **current_features(example, "mode"),
        "post_pistol_outcome_context": f"{example['side']}:{example['history_last1']}",
    }
    post_outcome_plant = lambda example: {
        **post_outcome(example),
        "history_previous_t_plant": str(example["history_previous_t_plant"]),
    }
    post_outcome_summary, _, _, _ = evaluate_multiclass_extension(
        post_pistol, "economic_mode", post_base, post_outcome, seed_offset=235
    )
    post_minimal_summary, _, _, _ = evaluate_multiclass_extension(
        post_pistol, "economic_mode", post_base, post_outcome_plant, seed_offset=236
    )
    post_side_diagnostics = {}
    for side_index, side in enumerate(("ct", "t")):
        cohort = [example for example in post_pistol if example["side"] == side]
        summary, _, _, _ = evaluate_multiclass_extension(
            cohort, "economic_mode", post_base, post_outcome, seed_offset=237 + side_index
        )
        post_side_diagnostics[side] = summary

    # A targeted post-pistol check mirrors the frozen finding: previous T
    # plant is tested only after current money/context are already present.
    post_t = [example for example in examples if example["side"] == "t" and example["context"] == "POST_PISTOL"]
    post_t_plant = None
    if post_t:
        base = lambda example: current_features(example, "mode")
        plus_plant = lambda example: {
            **current_features(example, "mode"),
            "history_previous_t_plant": str(example["history_previous_t_plant"]),
        }
        post_t_plant, _, _, _ = evaluate_multiclass_extension(
            post_t, "economic_mode", base, plus_plant, seed_offset=240
        )

    minimal_ci = post_outcome_summary["improvement_cluster_ci95"]
    minimal_post_pistol_pass = (
        (post_outcome_summary["improvement_bits"] or 0) >= HISTORY_GO_MIN_BITS
        and minimal_ci[0] is not None and minimal_ci[0] > 0
        and post_outcome_summary["positive_folds"] >= 4
    )
    if minimal_post_pistol_pass:
        passing.append("economic_mode:POST_PISTOL_PREVIOUS_OUTCOME")

    return {
        "feature_boundary": {
            "current": "only normal-player direct state plus POST_PISTOL/NORMAL context",
            "history": "last 1-3 W/L outcomes and witnessed T plant; no kills/survivors/spend/identity",
        },
        "held_out": {
            "grouping": f"{FOLDS}-fold held out by match series",
            "targets": targets,
            "utility_per_target": utility_targets,
            "context_diagnostics": context_diagnostics,
            "post_pistol_minimal_context": {
                "previous_outcome": post_outcome_summary,
                "previous_outcome_plus_witnessed_plant": post_minimal_summary,
                "by_side_previous_outcome": post_side_diagnostics,
            },
            "t_post_pistol_previous_plant": post_t_plant,
        },
        "gate": {
            "minimum_mean_improvement_bits": HISTORY_GO_MIN_BITS,
            "requires_ci_above_zero": True,
            "requires_positive_folds": 4,
            "passing_targets": passing,
            "decision": "GO" if passing else "NO_GO",
            "minimal_state_if_go": (
                "previousRoundOutcome only when round.context == POST_PISTOL"
                if minimal_post_pistol_pass
                else None
            ),
        },
    }


def validate_artifact(result: dict) -> None:
    if result["inputs"]["corpus"]["sha256"] != EXPECTED_CORPUS_SHA256:
        raise SystemExit("artifact corpus hash mismatch")
    if result["inputs"]["corpus"]["raw_player_rows"] != 43620:
        raise SystemExit("raw corpus invariant failed")
    if result["overtime"]["audit"]["player_rows"] != 1680:
        raise SystemExit("overtime invariant failed")
    if result["regulation"]["audit"]["strict_player_rows"] != 25986:
        raise SystemExit("strict regulation invariant failed")
    paths = {(row["side"], row["path"]) for row in result["overtime"]["path_summaries"]}
    for side in ("ct", "t"):
        for path in ("START", "W", "L", "WW", "WL", "LW", "LL"):
            if (side, path) not in paths:
                raise SystemExit(f"missing supported overtime path: {side} {path}")
    if result["utility"]["chronology"]["recoverable"] is not False:
        raise SystemExit("chronology must remain unavailable")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=Path(rc.BASE) / "player-rounds.json")
    parser.add_argument("--maps-dir", type=Path, default=Path(rc.BASE) / "maps")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent / "results" / "cologne-2026" / "purchase-policy-final-diagnostic.json",
    )
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    corpus_hash = sha256(args.corpus)
    if corpus_hash != EXPECTED_CORPUS_SHA256:
        raise SystemExit(f"corpus hash mismatch: expected {EXPECTED_CORPUS_SHA256}, got {corpus_hash}")

    rows = json.loads(args.corpus.read_text(encoding="utf-8"))
    strict, families = rc.build_dataset(rows)
    regulation_examples, regulation_audit = build_regulation_examples(strict, rows, families, args.maps_dir)
    result = {
        "schema_version": 1,
        "study": "RoundSense Policy V3 final purchase-policy diagnostic",
        "scope": "bounded observational diagnostic; professional behavior is not optimal truth",
        "inputs": {
            "parent_commit": PARENT_COMMIT,
            "frozen_economy_commit": FROZEN_ECONOMY_COMMIT,
            "frozen_post_pistol_commit": FROZEN_POST_PISTOL_COMMIT,
            "corpus": {
                "path": str(args.corpus),
                "sha256": corpus_hash,
                "raw_player_rows": len(rows),
            },
            "maps_dir": str(args.maps_dir),
            "random_seed": SEED,
            "folds": FOLDS,
            "cluster_bootstraps": BOOTSTRAPS,
        },
        "overtime": overtime_analysis(rows, families, repo_root, args.maps_dir),
        "regulation": {
            "audit": regulation_audit,
            "trajectory": regulation_trajectory_analysis(regulation_examples),
        },
        "utility": utility_map_analysis(regulation_examples),
        "production_boundary": {
            "allowed": [
                "own current money/inventory/side",
                "map.name and round/score/loss counters",
                "bounded complete W/L and witnessed-plant history",
            ],
            "forbidden": [
                "opponent exact money/loadout",
                "survivors/kills/spend",
                "player/team identity",
                "current-round result",
                "map position or professional role",
            ],
        },
    }
    result["artifact_sha256"] = stable_hash({key: value for key, value in result.items() if key != "artifact_sha256"})
    validate_artifact(result)
    write_json(args.output, result)
    print(f"wrote {args.output}")
    print(f"artifact_sha256={result['artifact_sha256']}")


if __name__ == "__main__":
    main()
