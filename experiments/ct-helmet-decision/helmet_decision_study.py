#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy==2.5.1", "scipy==1.18.0", "scikit-learn==1.9.0"]
# ///
"""Targeted observational study of professional CT helmet decisions.

The live-predictor feature ladders use only the player's pre-purchase state and
the normal-player GSI boundary locked in docs/policy-v3-architecture.md. Current
opponent loadouts are demo-oracle labels/explanations only.

Primary cohort:
  CT, regulation non-pistol round, pre-decision no armor/no helmet, at least
  $1000 start money, clean frozen row. The complete choice surface is
  no_armor/kevlar/vesthelm; the binary helmet target is restricted to players
  who actually bought armor (kevlar vs vesthelm).

Secondary cohort:
  CT, pre-decision full (100) armor/no helmet, at least $350 start money. The
  exact pre-decision armor value is minimally extracted from the previous
  round's final replay frame; the frozen boolean retainedArmor is not treated
  as proof of a $350 upgrade.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import statistics
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Callable, Iterable


EXPECTED_CORPUS_SHA256 = "33f29c35fb124a4e45d38a00be8f389d32403c0762576b607db7a9a37fe0d9e6"
EXPECTED_WEAPON_NAMES_SHA256 = "c08ff5380cab5267cb4c3175be9abcd19c5453616ef5ebd2db4e74305506b2cb"
EXPECTED_VDATA_SHA256 = "fbd0d6f754c234efb24ec5c6b8c335f190e67f17ac7ec98dc2cd2ea2ddb4037e"
EXPECTED_UPGRADE_EXTRACTION_SHA256 = "7ff65e6127688b3560983d15e497e1b0d62d6e7ebda5c7140224a5980c48bd89"
VDATA_COMMIT = "2e606a0bc54f619bc96689ae29cddc337cbde60a"
FOLDS = 5
SEED = 42
LOW_THRESHOLD = 0.20
HIGH_THRESHOLD = 0.80
DEFAULT_CT_PISTOLS = {"USP-S", "P2000"}
GRENADE_PRICES = {
    "smoke": 300,
    "flashbang": 200,
    "hegrenade": 300,
    "molotov": 400,
    "incendiary": 600,
    "decoy": 50,
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def stable_hash(value: object) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def assert_hash(path: Path, expected: str) -> str:
    actual = sha256(path)
    if actual != expected:
        raise SystemExit(f"input hash mismatch for {path}: expected {expected}, got {actual}")
    return actual


def round4(value: float | None) -> float | None:
    if value is None or math.isnan(value):
        return None
    return round(float(value), 4)


def series_of_map(map_key: str) -> str:
    return re.sub(r"-m\d+-de_[a-z0-9_]+$", "", map_key)


def round_in_half(round_number: int) -> int:
    return round_number if round_number <= 12 else round_number - 12


def one_hot(value: object, values: Iterable[object]) -> list[float]:
    return [1.0 if value == candidate else 0.0 for candidate in values]


def parse_grenades(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value]
    parsed = json.loads(str(value))
    if not isinstance(parsed, list):
        raise SystemExit("grenades field did not decode to a list")
    return [str(item) for item in parsed]


def parse_weapon_names(path: Path) -> tuple[dict[str, str], dict[str, str]]:
    """Return normalized key -> display name and display name -> family."""
    key_to_display: dict[str, str] = {}
    display_to_family: dict[str, str] = {}
    family = None
    headings = {
        "Rifles": "rifle",
        "Snipers": "sniper",
        "Pistols": "pistol",
        "冲锋枪": "smg",
        "Heavy": "heavy",
        "Equipment / utility": "equipment",
    }
    for line in path.read_text(encoding="utf-8").splitlines():
        comment = re.match(r"\s*//\s*(.+)$", line)
        if comment:
            family = headings.get(comment.group(1).strip(), family)
            continue
        item = re.match(r'\s*(\w+):\s*"([^"]+)"', line)
        if item and family:
            key, display = item.groups()
            key_to_display[key] = display
            display_to_family.setdefault(display, family)
    required = {"AK-47": "rifle", "M4A4": "rifle", "AWP": "sniper", "MAC-10": "smg"}
    for weapon, expected in required.items():
        if display_to_family.get(weapon) != expected:
            raise SystemExit(f"canonical weapon family missing: {weapon} -> {display_to_family.get(weapon)}")
    return key_to_display, display_to_family


def top_level_vdata_blocks(text: str) -> dict[str, str]:
    lines = text.splitlines()
    blocks: dict[str, str] = {}
    index = 0
    while index < len(lines):
        match = re.match(r"^\t([A-Za-z0-9_]+)\s*=\s*$", lines[index])
        if not match or index + 1 >= len(lines) or lines[index + 1].strip() != "{":
            index += 1
            continue
        start = index + 1
        depth = 0
        end = start
        while end < len(lines):
            depth += lines[end].count("{") - lines[end].count("}")
            if depth == 0:
                break
            end += 1
        blocks[match.group(1)] = "\n".join(lines[start : end + 1])
        index = end + 1
    return blocks


def direct_numeric(block: str, field: str) -> float:
    match = re.search(rf"^\t\t{re.escape(field)}\s*=\s*(-?[0-9]+(?:\.[0-9]+)?)\s*$", block, re.M)
    if not match:
        raise SystemExit(f"{field} missing from vdata prefab")
    return float(match.group(1))


def build_mechanics_artifact(
    vdata_path: Path,
    corpus_path: Path,
    weapon_names_path: Path,
    weapon_rules_path: Path,
) -> dict:
    assert_hash(vdata_path, EXPECTED_VDATA_SHA256)
    assert_hash(corpus_path, EXPECTED_CORPUS_SHA256)
    assert_hash(weapon_names_path, EXPECTED_WEAPON_NAMES_SHA256)
    rows = json.loads(corpus_path.read_text(encoding="utf-8"))
    key_to_display, _ = parse_weapon_names(weapon_names_path)
    rules = json.loads(weapon_rules_path.read_text(encoding="utf-8"))
    aliases = rules["weaponAliases"]
    observed = sorted(
        {str(row[field]) for row in rows for field in ("primary", "secondary") if row.get(field)}
    )
    display_to_internal: dict[str, str] = {}
    for key, display in key_to_display.items():
        if display not in observed:
            continue
        internal = aliases.get(key)
        if internal:
            existing = display_to_internal.get(display)
            if existing and existing != internal:
                raise SystemExit(f"ambiguous display mapping: {display}: {existing}, {internal}")
            display_to_internal[display] = internal

    blocks = top_level_vdata_blocks(vdata_path.read_text(encoding="utf-8"))
    weapons: dict[str, dict] = {}
    for display in observed:
        internal = display_to_internal.get(display)
        if not internal:
            raise SystemExit(f"no canonical internal id for observed weapon {display}")
        prefab = blocks.get(f"{internal}_prefab")
        if prefab is None:
            raise SystemExit(f"no vdata prefab for {display} ({internal})")
        damage = direct_numeric(prefab, "m_nDamage")
        headshot_multiplier = direct_numeric(prefab, "m_flHeadshotMultiplier")
        armor_ratio = direct_numeric(prefab, "m_flArmorRatio")
        range_modifier = direct_numeric(prefab, "m_flRangeModifier")
        projectiles = int(direct_numeric(prefab, "m_nNumBullets"))
        raw_head_damage = damage * headshot_multiplier
        armored_head_damage = raw_head_damage * armor_ratio / 2.0
        if projectiles != 1:
            status = "MULTI_PROJECTILE_UNKNOWN"
            sensitive = None
        else:
            status = "CLASSIFIED"
            sensitive = raw_head_damage >= 100.0 and armored_head_damage < 100.0
        weapons[display] = {
            "internal_id": internal,
            "base_damage": damage,
            "headshot_multiplier": headshot_multiplier,
            "armor_ratio": armor_ratio,
            "range_modifier": range_modifier,
            "projectiles": projectiles,
            "zero_range_unhelmeted_head_damage": round(raw_head_damage, 4),
            "zero_range_helmeted_head_damage": round(armored_head_damage, 4),
            "classification_status": status,
            "helmet_sensitive": sensitive,
        }
    return {
        "schema_version": 1,
        "definition": (
            "single-projectile firearm whose zero-range headshot is lethal at 100 HP "
            "without a helmet and non-lethal with a helmet"
        ),
        "formula": {
            "unhelmeted": "m_nDamage * m_flHeadshotMultiplier",
            "helmeted": "unhelmeted * m_flArmorRatio / 2",
            "scope": "zero range; multi-projectile weapons remain UNKNOWN",
        },
        "source": {
            "repo": "SteamTracking/GameTracking-CS2",
            "commit": VDATA_COMMIT,
            "path": "game/csgo/pak01_dir/scripts/weapons.vdata",
            "sha256": EXPECTED_VDATA_SHA256,
            "canonical_display_names_sha256": EXPECTED_WEAPON_NAMES_SHA256,
        },
        "weapons": weapons,
    }


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def aggregate_team_rounds(rows: list[dict]) -> dict[tuple[str, int, str], dict]:
    groups: dict[tuple[str, int, str], list[dict]] = defaultdict(list)
    for row in rows:
        groups[(row["map"], int(row["roundNumber"]), row["teamKey"])].append(row)
    result = {}
    for key, players in groups.items():
        if len(players) != 5:
            raise SystemExit(f"team-round {key} has {len(players)} players")
        first = players[0]
        result[key] = {
            "map": first["map"],
            "round": int(first["roundNumber"]),
            "team_key": first["teamKey"],
            "side": first["side"],
            "score_ct": int(first["scoreCT"]),
            "score_t": int(first["scoreT"]),
            "winner_side": first["winnerSide"],
            "end_reason": first["endReason"],
            "loss_index": max(0, min(4, int(first["lossIndex"]))),
            "loss_index_ambiguous": any(bool(player["lossIndexAmbiguous"]) for player in players),
            "overtime": any(bool(player["overtime"]) for player in players),
            "players": players,
        }
    return result


def previous_win_streak(team_rounds: dict, current: dict) -> int:
    wins = 0
    for previous_round in range(current["round"] - 1, 0, -1):
        previous = team_rounds.get((current["map"], previous_round, current["team_key"]))
        if previous is None or previous["winner_side"] != previous["side"]:
            break
        wins += 1
        if round_in_half(previous_round) == 1:
            break
    return min(wins, 3)


def opponent_round(team_rounds: dict, current: dict) -> dict | None:
    opponent_side = "t" if current["side"] == "ct" else "ct"
    candidates = [
        team_round
        for (map_key, round_number, _), team_round in team_rounds.items()
        if map_key == current["map"] and round_number == current["round"] and team_round["side"] == opponent_side
    ]
    if len(candidates) != 1:
        return None
    return candidates[0]


def corrected_retained_primary(row: dict, row_index: dict[tuple[str, int, int], dict]) -> str | None:
    retained = row.get("retainedPrimary")
    if int(row["roundNumber"]) == 13:
        return None
    if retained and row.get("primary") is None and 200 <= int(row["moneySpent"]) <= 800:
        previous = row_index.get((row["map"], int(row["roundNumber"]) - 1, int(row["playerIndex"])))
        if previous and previous.get("primary"):
            return "UNKNOWN"
    return retained


def firearm_for_player(player: dict) -> str | None:
    return player.get("primary") or player.get("secondary")


def oracle_mix(team_round: dict, mechanics: dict, families: dict[str, str]) -> dict:
    weapons = [firearm_for_player(player) for player in team_round["players"]]
    weapons = [weapon for weapon in weapons if weapon]
    sensitive = 0
    unknown = 0
    for weapon in weapons:
        record = mechanics["weapons"].get(weapon)
        if not record or record["helmet_sensitive"] is None:
            unknown += 1
        elif record["helmet_sensitive"]:
            sensitive += 1
    established_count = sum(
        player.get("primary") is not None
        and families.get(str(player.get("primary"))) in {"rifle", "sniper"}
        for player in team_round["players"]
    )
    return {
        "weapons": weapons,
        "helmet_sensitive_count": sensitive,
        "unknown_count": unknown,
        "established_count": established_count,
        "established": int(established_count >= 3),
    }


def context_for_player(
    row: dict,
    team_rounds: dict,
    mechanics: dict,
    families: dict[str, str],
) -> tuple[dict | None, str | None]:
    key = (row["map"], int(row["roundNumber"]), row["teamKey"])
    own = team_rounds.get(key)
    if own is None:
        return None, "missing_own_team_round"
    opponent = opponent_round(team_rounds, own)
    if opponent is None:
        return None, "missing_opponent_team_round"
    if own["loss_index_ambiguous"] or opponent["loss_index_ambiguous"]:
        return None, "loss_index_ambiguous"
    own_previous = team_rounds.get((own["map"], own["round"] - 1, own["team_key"]))
    opponent_previous = team_rounds.get(
        (opponent["map"], opponent["round"] - 1, opponent["team_key"])
    )
    if own_previous is None or opponent_previous is None:
        return None, "missing_previous_round"
    mix = oracle_mix(opponent, mechanics, families)
    return {
        "series": series_of_map(row["map"]),
        "map": row["map"],
        "round": int(row["roundNumber"]),
        "round_in_half": round_in_half(int(row["roundNumber"])),
        "score_diff": int(row["scoreCT"]) - int(row["scoreT"]),
        "own_loss_index": own["loss_index"],
        "own_previous_win": int(own_previous["winner_side"] == "ct"),
        "opponent_loss_index": opponent["loss_index"],
        "opponent_previous_win": int(opponent_previous["winner_side"] == "t"),
        "previous_plant": int(own_previous["end_reason"] in {"target_bombed", "bomb_defused"}),
        "opponent_previous_win_streak": previous_win_streak(team_rounds, opponent),
        "oracle": mix,
    }, None


def clean_base_row(row: dict) -> bool:
    return (
        row["side"] == "ct"
        and not row["overtime"]
        and int(row["roundNumber"]) not in {1, 13}
        and not row["dropGave"]
        and not row["dropReceived"]
        and not row["lossIndexAmbiguous"]
    )


def retained_family(weapon: str | None, families: dict[str, str]) -> str:
    if weapon is None:
        return "none"
    return families.get(weapon, "other")


def enrich_example(
    row: dict,
    context: dict,
    families: dict[str, str],
    row_index: dict[tuple[str, int, int], dict],
) -> dict:
    retained_primary = corrected_retained_primary(row, row_index)
    retained_grenades = parse_grenades(row["retainedGrenades"])
    grenades = parse_grenades(row["grenades"])
    return {
        **context,
        "player": row["name"],
        "start_money": int(row["startMoney"]),
        "money_spent": int(row["moneySpent"]),
        "money_remaining": int(row["startMoney"]) - int(row["moneySpent"]),
        "retained_primary": retained_primary,
        "retained_primary_family": retained_family(retained_primary, families),
        "retained_secondary": row.get("retainedSecondary"),
        "retained_kit": bool(row["retainedKit"]),
        "retained_grenades": retained_grenades,
        "resulting_primary": row.get("primary"),
        "resulting_secondary": row.get("secondary"),
        "resulting_kit": bool(row["hasDefuseKit"]),
        "resulting_grenades": grenades,
        "has_armor": bool(row["hasArmor"]),
        "has_helmet": bool(row["hasHelmet"]),
    }


def build_fresh_cohorts(rows: list[dict], team_rounds: dict, mechanics: dict, families: dict) -> tuple[list[dict], list[dict], dict]:
    row_index = {
        (row["map"], int(row["roundNumber"]), int(row["playerIndex"])): row for row in rows
    }
    eligible: list[dict] = []
    exclusions: Counter[str] = Counter()
    for row in rows:
        if not clean_base_row(row):
            continue
        if row["retainedArmor"] or row["retainedHelmet"] or int(row["startMoney"]) < 1000:
            continue
        if corrected_retained_primary(row, row_index) == "UNKNOWN":
            exclusions["retained_primary_unknown"] += 1
            continue
        context, reason = context_for_player(row, team_rounds, mechanics, families)
        if context is None:
            exclusions[reason or "context_unknown"] += 1
            continue
        example = enrich_example(row, context, families, row_index)
        if example["has_helmet"] and not example["has_armor"]:
            raise SystemExit("illegal resulting helmet without armor")
        example["fresh_choice"] = (
            "vesthelm" if example["has_helmet"] else "kevlar" if example["has_armor"] else "no_armor"
        )
        eligible.append(example)
    armor_buyers = [example for example in eligible if example["has_armor"]]
    return eligible, armor_buyers, dict(sorted(exclusions.items()))


def extract_previous_end_armor(candidates: list[dict], maps_dir: Path) -> tuple[dict[tuple[str, int, int], int], dict]:
    by_map: dict[str, list[dict]] = defaultdict(list)
    for row in candidates:
        by_map[row["map"]].append(row)
    values: dict[tuple[str, int, int], int] = {}
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
            previous = replay_rounds.get(int(row["roundNumber"]) - 1)
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
            if not track or not track.get("hp") or not track.get("armor") or not track.get("flags"):
                exclusions["missing_previous_player_track"] += 1
                continue
            hp = int(track["hp"][-1])
            armor = int(track["armor"][-1])
            alive = bool(int(track["flags"][-1]) & 1)
            if not alive:
                exclusions["previous_end_not_alive"] += 1
                continue
            key = (row["map"], int(row["roundNumber"]), int(row["playerIndex"]))
            values[key] = armor
            records.append({
                "map": key[0], "round": key[1], "player_index": key[2],
                "armor": armor, "hp": hp, "alive_flag": alive,
            })
    return values, {
        "exclusions": dict(sorted(exclusions.items())),
        "extracted_rows": len(records),
        "extraction_sha256": stable_hash(sorted(records, key=lambda record: (record["map"], record["round"], record["player_index"]))),
    }


def build_upgrade_cohort(rows: list[dict], team_rounds: dict, mechanics: dict, families: dict, maps_dir: Path) -> tuple[list[dict], dict]:
    row_index = {
        (row["map"], int(row["roundNumber"]), int(row["playerIndex"])): row for row in rows
    }
    candidates = [
        row
        for row in rows
        if clean_base_row(row)
        and row["retainedArmor"]
        and not row["retainedHelmet"]
        and row["survivedPrev"]
        and int(row["startMoney"]) >= 350
        and corrected_retained_primary(row, row_index) != "UNKNOWN"
    ]
    armor_values, extraction = extract_previous_end_armor(candidates, maps_dir)
    cohort = []
    exclusions: Counter[str] = Counter(extraction["exclusions"])
    for row in candidates:
        key = (row["map"], int(row["roundNumber"]), int(row["playerIndex"]))
        armor = armor_values.get(key)
        if armor is None:
            continue
        if armor != 100:
            exclusions["previous_end_armor_not_100"] += 1
            continue
        context, reason = context_for_player(row, team_rounds, mechanics, families)
        if context is None:
            exclusions[reason or "context_unknown"] += 1
            continue
        example = enrich_example(row, context, families, row_index)
        example["pre_decision_armor"] = armor
        cohort.append(example)
    extraction["candidate_rows"] = len(candidates)
    extraction["eligible_rows"] = len(cohort)
    extraction["cohort_exclusions"] = dict(sorted(exclusions.items()))
    return cohort, extraction


PRIMARY_FAMILIES = ["none", "rifle", "sniper", "smg", "heavy", "pistol", "other"]


def own_features(example: dict) -> list[float]:
    retained = Counter(example["retained_grenades"])
    money_band = min(int(example["start_money"]) // 500, 20)
    return [
        min(float(example["start_money"]), 10000.0) / 10000.0,
        *one_hot(money_band, range(1, 21)),
        *one_hot(example["retained_primary_family"], PRIMARY_FAMILIES),
        float(example["retained_secondary"] not in (None, *DEFAULT_CT_PISTOLS)),
        float(example["retained_kit"]),
        float(retained["smoke"] > 0),
        float(retained["hegrenade"] > 0),
        float(retained["molotov"] + retained["incendiary"] > 0),
        min(float(retained["flashbang"]), 2.0) / 2.0,
        min(sum(retained.values()), 4) / 4.0,
        *one_hot(example["own_loss_index"], range(5)),
        *one_hot(example["round_in_half"], range(2, 13)),
        max(-10.0, min(10.0, float(example["score_diff"]))) / 10.0,
        float(example["own_previous_win"]),
    ]


def own_feature_names() -> list[str]:
    return [
        "own.start_money_scaled",
        *[f"own.start_money_band_{band * 500}" for band in range(1, 21)],
        *[f"own.retained_primary_{family}" for family in PRIMARY_FAMILIES],
        "own.retained_paid_secondary",
        "own.retained_kit",
        "own.retained_smoke",
        "own.retained_he",
        "own.retained_fire",
        "own.retained_flash_scaled",
        "own.retained_grenade_count_scaled",
        *[f"own.loss_index_{index}" for index in range(5)],
        *[f"round.in_half_{index}" for index in range(2, 13)],
        "score.diff_scaled",
        "own.previous_win",
    ]


def deployable_opponent_features(example: dict) -> list[float]:
    return [
        *own_features(example),
        *one_hot(example["opponent_loss_index"], range(5)),
        float(example["opponent_previous_win"]),
        float(example["previous_plant"]),
        *one_hot(example["opponent_previous_win_streak"], range(4)),
        float(example["round_in_half"] == 2 and example["opponent_previous_win"]),
    ]


def deployable_feature_names() -> list[str]:
    return [
        *own_feature_names(),
        *[f"opponent.loss_index_{index}" for index in range(5)],
        "opponent.previous_win",
        "history.previous_plant",
        *[f"opponent.previous_win_streak_{index}" for index in range(4)],
        "opponent.post_pistol_previous_win",
    ]


def oracle_established_features(example: dict) -> list[float]:
    return [*own_features(example), float(example["oracle"]["established"])]


def oracle_threat_features(example: dict) -> list[float]:
    count = int(example["oracle"]["helmet_sensitive_count"])
    return [*own_features(example), *one_hot(count, range(6))]


def public_opponent_features(example: dict, tracked: bool) -> list[float]:
    direct = [
        *one_hot(example["round_in_half"], range(2, 13)),
        *one_hot(example["opponent_loss_index"], range(5)),
        max(-10.0, min(10.0, float(-example["score_diff"]))) / 10.0,
    ]
    if not tracked:
        return direct
    return [
        *direct,
        float(example["opponent_previous_win"]),
        float(example["previous_plant"]),
        *one_hot(example["opponent_previous_win_streak"], range(4)),
        float(example["round_in_half"] == 2 and example["opponent_previous_win"]),
    ]


def group_folds(examples: list[dict], group_key: str) -> tuple[dict[str, int], list[int]]:
    counts: Counter[str] = Counter(str(example[group_key]) for example in examples)
    totals = [0] * FOLDS
    assignments: dict[str, int] = {}
    for group, count in sorted(counts.items(), key=lambda item: (-item[1], item[0])):
        fold = min(range(FOLDS), key=lambda index: (totals[index], index))
        assignments[group] = fold
        totals[fold] += count
    return assignments, totals


def oof_probabilities(
    examples: list[dict],
    labels: list[int],
    feature_fn: Callable[[dict], list[float]] | None,
    group_key: str,
) -> tuple[list[float], list[int]]:
    from sklearn.linear_model import LogisticRegression

    assignments, _ = group_folds(examples, group_key)
    probabilities = [math.nan] * len(examples)
    fold_ids = [assignments[str(example[group_key])] for example in examples]
    for fold in range(FOLDS):
        train_indices = [index for index, fold_id in enumerate(fold_ids) if fold_id != fold]
        test_indices = [index for index, fold_id in enumerate(fold_ids) if fold_id == fold]
        train_labels = [labels[index] for index in train_indices]
        if len(set(train_labels)) < 2 or feature_fn is None:
            probability = sum(train_labels) / len(train_labels)
            for index in test_indices:
                probabilities[index] = probability
            continue
        model = LogisticRegression(max_iter=3000, random_state=SEED, solver="lbfgs")
        model.fit([feature_fn(examples[index]) for index in train_indices], train_labels)
        predicted = model.predict_proba([feature_fn(examples[index]) for index in test_indices])[:, 1]
        for index, probability in zip(test_indices, predicted):
            probabilities[index] = float(probability)
    if any(math.isnan(probability) for probability in probabilities):
        raise SystemExit("OOF prediction coverage incomplete")
    return probabilities, fold_ids


FRESH_CLASSES = ["no_armor", "kevlar", "vesthelm"]


def oof_multiclass_probabilities(
    examples: list[dict],
    feature_fn: Callable[[dict], list[float]] | None,
    group_key: str,
) -> tuple[list[list[float]], list[int]]:
    from sklearn.linear_model import LogisticRegression

    assignments, _ = group_folds(examples, group_key)
    fold_ids = [assignments[str(example[group_key])] for example in examples]
    probabilities = [[math.nan] * len(FRESH_CLASSES) for _ in examples]
    labels = [FRESH_CLASSES.index(example["fresh_choice"]) for example in examples]
    for fold in range(FOLDS):
        train_indices = [index for index, fold_id in enumerate(fold_ids) if fold_id != fold]
        test_indices = [index for index, fold_id in enumerate(fold_ids) if fold_id == fold]
        if feature_fn is None:
            counts = Counter(labels[index] for index in train_indices)
            distribution = [counts[class_index] / len(train_indices) for class_index in range(len(FRESH_CLASSES))]
            for index in test_indices:
                probabilities[index] = distribution
            continue
        model = LogisticRegression(max_iter=3000, random_state=SEED, solver="lbfgs")
        model.fit([feature_fn(examples[index]) for index in train_indices], [labels[index] for index in train_indices])
        predicted = model.predict_proba([feature_fn(examples[index]) for index in test_indices])
        for index, row in zip(test_indices, predicted):
            mapped = [0.0] * len(FRESH_CLASSES)
            for class_index, probability in zip(model.classes_, row):
                mapped[int(class_index)] = float(probability)
            probabilities[index] = mapped
    if any(any(math.isnan(value) for value in row) for row in probabilities):
        raise SystemExit("multiclass OOF prediction coverage incomplete")
    return probabilities, fold_ids


def auc(labels: list[int], probabilities: list[float]) -> float:
    pairs = sorted(zip(probabilities, labels), key=lambda pair: pair[0])
    positive = sum(labels)
    negative = len(labels) - positive
    if positive == 0 or negative == 0:
        return math.nan
    rank_sum = 0.0
    index = 0
    while index < len(pairs):
        end = index + 1
        while end < len(pairs) and pairs[end][0] == pairs[index][0]:
            end += 1
        average_rank = (index + 1 + end) / 2.0
        rank_sum += average_rank * sum(label for _, label in pairs[index:end])
        index = end
    return (rank_sum - positive * (positive + 1) / 2.0) / (positive * negative)


def metric_summary(labels: list[int], probabilities: list[float], selective: bool = False) -> dict:
    clipped = [min(1 - 1e-9, max(1e-9, probability)) for probability in probabilities]
    result = {
        "n": len(labels),
        "positive_rate": round4(sum(labels) / len(labels)),
        "log_loss": round4(
            -sum(label * math.log(probability) + (1 - label) * math.log(1 - probability)
                 for label, probability in zip(labels, clipped)) / len(labels)
        ),
        "brier": round4(sum((probability - label) ** 2 for label, probability in zip(labels, probabilities)) / len(labels)),
        "auc": round4(auc(labels, probabilities)),
        "accuracy_at_0_5": round4(
            sum(label == int(probability >= 0.5) for label, probability in zip(labels, probabilities)) / len(labels)
        ),
    }
    if selective:
        selected = [
            (label, probability >= HIGH_THRESHOLD)
            for label, probability in zip(labels, probabilities)
            if probability <= LOW_THRESHOLD or probability >= HIGH_THRESHOLD
        ]
        high = [(label, prediction) for label, prediction in selected if prediction]
        low = [(label, prediction) for label, prediction in selected if not prediction]
        accuracy = lambda values: sum(label == int(prediction) for label, prediction in values) / len(values) if values else None
        result["selective"] = {
            "thresholds": {"low_max": LOW_THRESHOLD, "high_min": HIGH_THRESHOLD},
            "coverage": round4(len(selected) / len(labels)),
            "accuracy": round4(accuracy(selected)),
            "high_n": len(high),
            "high_precision": round4(accuracy(high)),
            "low_n": len(low),
            "low_precision": round4(accuracy(low)),
        }
    return result


def multiclass_metric_summary(examples: list[dict], probabilities: list[list[float]]) -> dict:
    from sklearn.metrics import f1_score

    labels = [FRESH_CLASSES.index(example["fresh_choice"]) for example in examples]
    predicted = [max(range(len(row)), key=lambda index: row[index]) for row in probabilities]
    clipped = [[min(1 - 1e-9, max(1e-9, value)) for value in row] for row in probabilities]
    return {
        "n": len(examples),
        "class_distribution": dict(sorted(Counter(example["fresh_choice"] for example in examples).items())),
        "log_loss": round4(-sum(math.log(row[label]) for row, label in zip(clipped, labels)) / len(labels)),
        "brier": round4(
            sum(
                sum((probability - int(class_index == label)) ** 2 for class_index, probability in enumerate(row))
                for row, label in zip(probabilities, labels)
            ) / len(labels)
        ),
        "accuracy": round4(sum(prediction == label for prediction, label in zip(predicted, labels)) / len(labels)),
        "macro_f1": round4(float(f1_score(labels, predicted, average="macro"))),
    }


def paired_multiclass_bootstrap(
    examples: list[dict], first: list[list[float]], second: list[list[float]], iterations: int = 1000
) -> dict:
    import numpy as np

    groups: dict[str, list[int]] = defaultdict(list)
    for index, example in enumerate(examples):
        groups[example["series"]].append(index)
    keys = sorted(groups)
    rng = np.random.default_rng(SEED)
    samples = {"log_loss_delta": [], "brier_delta": [], "accuracy_delta": []}
    for _ in range(iterations):
        picked = rng.integers(0, len(keys), size=len(keys))
        indices = [index for picked_index in picked for index in groups[keys[int(picked_index)]]]
        sample_examples = [examples[index] for index in indices]
        first_metric = multiclass_metric_summary(sample_examples, [first[index] for index in indices])
        second_metric = multiclass_metric_summary(sample_examples, [second[index] for index in indices])
        for output_key, metric_key in [("log_loss_delta", "log_loss"), ("brier_delta", "brier"), ("accuracy_delta", "accuracy")]:
            samples[output_key].append(second_metric[metric_key] - first_metric[metric_key])
    first_metric = multiclass_metric_summary(examples, first)
    second_metric = multiclass_metric_summary(examples, second)
    return {
        output_key: {
            "estimate": round4(second_metric[metric_key] - first_metric[metric_key]),
            "ci95": [round4(float(np.quantile(samples[output_key], 0.025))), round4(float(np.quantile(samples[output_key], 0.975)))],
        }
        for output_key, metric_key in [("log_loss_delta", "log_loss"), ("brier_delta", "brier"), ("accuracy_delta", "accuracy")]
    }


def paired_cluster_bootstrap(
    examples: list[dict], labels: list[int], first: list[float], second: list[float], iterations: int = 1000
) -> dict:
    import numpy as np

    groups: dict[str, list[int]] = defaultdict(list)
    for index, example in enumerate(examples):
        groups[example["series"]].append(index)
    keys = sorted(groups)
    rng = np.random.default_rng(SEED)
    values = {"auc_delta": [], "brier_delta": [], "log_loss_delta": []}
    for _ in range(iterations):
        picked = rng.integers(0, len(keys), size=len(keys))
        indices = [index for picked_index in picked for index in groups[keys[int(picked_index)]]]
        y = [labels[index] for index in indices]
        p1 = [first[index] for index in indices]
        p2 = [second[index] for index in indices]
        if len(set(y)) < 2:
            continue
        m1 = metric_summary(y, p1)
        m2 = metric_summary(y, p2)
        values["auc_delta"].append(m2["auc"] - m1["auc"])
        values["brier_delta"].append(m2["brier"] - m1["brier"])
        values["log_loss_delta"].append(m2["log_loss"] - m1["log_loss"])
    return {
        key: {
            "estimate": round4((metric_summary(labels, second)[metric] - metric_summary(labels, first)[metric])),
            "ci95": [round4(float(np.quantile(samples, 0.025))), round4(float(np.quantile(samples, 0.975)))],
        }
        for key, samples, metric in [
            ("auc_delta", values["auc_delta"], "auc"),
            ("brier_delta", values["brier_delta"], "brier"),
            ("log_loss_delta", values["log_loss_delta"], "log_loss"),
        ]
    }


def subgroup_metrics(examples: list[dict], labels: list[int], first: list[float], second: list[float]) -> list[dict]:
    groups = {
        "post_pistol": lambda example: example["round_in_half"] == 2,
        "early_3_5": lambda example: 3 <= example["round_in_half"] <= 5,
        "later_6_12": lambda example: example["round_in_half"] >= 6,
        "money_lt_2500": lambda example: example["start_money"] < 2500,
        "money_2500_3999": lambda example: 2500 <= example["start_money"] < 4000,
        "money_ge_4000": lambda example: example["start_money"] >= 4000,
        "retained_primary_none": lambda example: example["retained_primary_family"] == "none",
        "retained_primary_rifle": lambda example: example["retained_primary_family"] == "rifle",
        "retained_primary_other": lambda example: example["retained_primary_family"] not in {"none", "rifle"},
    }
    output = []
    for name, predicate in groups.items():
        indices = [index for index, example in enumerate(examples) if predicate(example)]
        if len(indices) < 20:
            continue
        y = [labels[index] for index in indices]
        if len(set(y)) < 2:
            continue
        m1 = metric_summary(y, [first[index] for index in indices])
        m2 = metric_summary(y, [second[index] for index in indices])
        output.append({
            "subgroup": name,
            "n": len(indices),
            "helmet_rate": round4(sum(y) / len(y)),
            "own_auc": m1["auc"],
            "plus_opponent_auc": m2["auc"],
            "auc_delta": round4(m2["auc"] - m1["auc"]),
            "brier_delta": round4(m2["brier"] - m1["brier"]),
        })
    return output


def full_model_opponent_coefficients(examples: list[dict], labels: list[int]) -> list[dict]:
    from sklearn.linear_model import LogisticRegression

    names = deployable_feature_names()
    model = LogisticRegression(max_iter=3000, random_state=SEED, solver="lbfgs")
    model.fit([deployable_opponent_features(example) for example in examples], labels)
    opponent = [
        {"feature": name, "coefficient": round4(float(coefficient))}
        for name, coefficient in zip(names, model.coef_[0])
        if name.startswith("opponent.") or name.startswith("history.")
    ]
    return sorted(opponent, key=lambda row: (-abs(row["coefficient"]), row["feature"]))


def evaluate_choice_model(examples: list[dict], label_key: str) -> dict:
    labels = [int(example[label_key]) for example in examples]
    baseline, _ = oof_probabilities(examples, labels, None, "series")
    own, fold_ids = oof_probabilities(examples, labels, own_features, "series")
    plus, _ = oof_probabilities(examples, labels, deployable_opponent_features, "series")
    own_player, _ = oof_probabilities(examples, labels, own_features, "player")
    plus_player, _ = oof_probabilities(examples, labels, deployable_opponent_features, "player")
    fold_metrics = []
    for fold in range(FOLDS):
        indices = [index for index, fold_id in enumerate(fold_ids) if fold_id == fold]
        y = [labels[index] for index in indices]
        m1 = metric_summary(y, [own[index] for index in indices])
        m2 = metric_summary(y, [plus[index] for index in indices])
        fold_metrics.append({
            "fold": fold,
            "n": len(indices),
            "positive_rate": round4(sum(y) / len(y)),
            "own_auc": m1["auc"],
            "plus_opponent_auc": m2["auc"],
            "auc_delta": round4(m2["auc"] - m1["auc"]),
            "brier_delta": round4(m2["brier"] - m1["brier"]),
        })
    return {
        "validation": {
            "primary": f"{FOLDS}-fold held-out by match series",
            "sensitivity": f"{FOLDS}-fold held-out by player",
            "identity_features": "forbidden",
        },
        "series_held_out": {
            "prevalence_only": metric_summary(labels, baseline),
            "own_state_only": metric_summary(labels, own),
            "own_plus_deployable_opponent": metric_summary(labels, plus),
            "paired_cluster_bootstrap": paired_cluster_bootstrap(examples, labels, own, plus),
            "fold_stability": fold_metrics,
            "subgroups": subgroup_metrics(examples, labels, own, plus),
        },
        "player_held_out_sensitivity": {
            "own_state_only": metric_summary(labels, own_player),
            "own_plus_deployable_opponent": metric_summary(labels, plus_player),
        },
        "opponent_coefficients_full_fit": full_model_opponent_coefficients(examples, labels),
    }


def evaluate_fresh_three_way(examples: list[dict]) -> dict:
    baseline, _ = oof_multiclass_probabilities(examples, None, "series")
    own, fold_ids = oof_multiclass_probabilities(examples, own_features, "series")
    plus, _ = oof_multiclass_probabilities(examples, deployable_opponent_features, "series")
    own_player, _ = oof_multiclass_probabilities(examples, own_features, "player")
    plus_player, _ = oof_multiclass_probabilities(examples, deployable_opponent_features, "player")
    folds = []
    for fold in range(FOLDS):
        indices = [index for index, fold_id in enumerate(fold_ids) if fold_id == fold]
        fold_examples = [examples[index] for index in indices]
        own_metric = multiclass_metric_summary(fold_examples, [own[index] for index in indices])
        plus_metric = multiclass_metric_summary(fold_examples, [plus[index] for index in indices])
        folds.append({
            "fold": fold,
            "n": len(indices),
            "own_log_loss": own_metric["log_loss"],
            "plus_opponent_log_loss": plus_metric["log_loss"],
            "log_loss_delta": round4(plus_metric["log_loss"] - own_metric["log_loss"]),
            "accuracy_delta": round4(plus_metric["accuracy"] - own_metric["accuracy"]),
        })
    return {
        "target": "no_armor | kevlar | vesthelm",
        "series_held_out": {
            "prevalence_only": multiclass_metric_summary(examples, baseline),
            "own_state_only": multiclass_metric_summary(examples, own),
            "own_plus_deployable_opponent": multiclass_metric_summary(examples, plus),
            "paired_cluster_bootstrap": paired_multiclass_bootstrap(examples, own, plus),
            "fold_stability": folds,
        },
        "player_held_out_sensitivity": {
            "own_state_only": multiclass_metric_summary(examples, own_player),
            "own_plus_deployable_opponent": multiclass_metric_summary(examples, plus_player),
        },
    }


def summarize_counts(examples: list[dict], key_fn: Callable[[dict], object], label_key: str) -> list[dict]:
    groups: dict[object, list[dict]] = defaultdict(list)
    for example in examples:
        groups[key_fn(example)].append(example)
    return [
        {
            "group": key,
            "n": len(group),
            "helmet_rate": round4(sum(int(example[label_key]) for example in group) / len(group)),
            "skip_rate": round4(1 - sum(int(example[label_key]) for example in group) / len(group)),
        }
        for key, group in sorted(groups.items(), key=lambda item: str(item[0]))
    ]


def oracle_analysis(examples: list[dict], label_key: str) -> dict:
    known = [example for example in examples if example["oracle"]["unknown_count"] == 0]
    labels = [int(example[label_key]) for example in known]
    own, _ = oof_probabilities(known, labels, own_features, "series")
    established, _ = oof_probabilities(known, labels, oracle_established_features, "series")
    threat, _ = oof_probabilities(known, labels, oracle_threat_features, "series")
    return {
        "scope": {
            "all_rows": len(examples),
            "known_single_projectile_mix_rows": len(known),
            "excluded_multi_projectile_or_unmapped_rows": len(examples) - len(known),
        },
        "threat_count": summarize_counts(known, lambda example: example["oracle"]["helmet_sensitive_count"], label_key),
        "threat_present": summarize_counts(known, lambda example: int(example["oracle"]["helmet_sensitive_count"] >= 1), label_key),
        "established_rifle": summarize_counts(known, lambda example: example["oracle"]["established"], label_key),
        "cross_tab": summarize_counts(
            known,
            lambda example: f"established={example['oracle']['established']},threat={int(example['oracle']['helmet_sensitive_count'] >= 1)}",
            label_key,
        ),
        "held_out_explanatory_ceiling": {
            "own_state_only": metric_summary(labels, own),
            "own_plus_established_rifle_oracle": metric_summary(labels, established),
            "own_plus_helmet_threat_count_oracle": metric_summary(labels, threat),
            "threat_vs_own_bootstrap": paired_cluster_bootstrap(known, labels, own, threat),
        },
        "top_weapon_mixes": [
            {"weapons": list(weapons), "n": count}
            for weapons, count in Counter(tuple(sorted(example["oracle"]["weapons"])) for example in known).most_common(15)
        ],
    }


def delta_purchases(example: dict, weapon_prices: dict[str, int]) -> dict:
    retained_grenades = Counter(example["retained_grenades"])
    resulting_grenades = Counter(example["resulting_grenades"])
    bought_grenades = {
        grenade: max(0, resulting_grenades[grenade] - retained_grenades[grenade])
        for grenade in set(retained_grenades) | set(resulting_grenades)
    }
    grenade_cost = sum(GRENADE_PRICES.get(grenade, 0) * count for grenade, count in bought_grenades.items())
    bought_primary = bool(
        example["resulting_primary"]
        and example["resulting_primary"] != example["retained_primary"]
    )
    bought_secondary = bool(
        example["resulting_secondary"]
        and example["resulting_secondary"] != example["retained_secondary"]
        and example["resulting_secondary"] not in DEFAULT_CT_PISTOLS
    )
    return {
        "smoke": bought_grenades.get("smoke", 0) > 0,
        "fire": bought_grenades.get("molotov", 0) + bought_grenades.get("incendiary", 0) > 0,
        "he": bought_grenades.get("hegrenade", 0) > 0,
        "flash": bought_grenades.get("flashbang", 0) > 0,
        "kit": example["resulting_kit"] and not example["retained_kit"],
        "primary": bought_primary,
        "paid_secondary": bought_secondary,
        "grenade_cost": grenade_cost,
        "known_weapon_cost": (
            weapon_prices.get(example["resulting_primary"], 0) if bought_primary else 0
        ) + (weapon_prices.get(example["resulting_secondary"], 0) if bought_secondary else 0),
    }


def opportunity_cost_analysis(examples: list[dict], label_key: str, weapon_prices: dict[str, int], helmet_cost: int) -> dict:
    for example in examples:
        example["_delta"] = delta_purchases(example, weapon_prices)
    output = {}
    for label, name in [(0, "skip_helmet"), (1, "buy_helmet")]:
        group = [example for example in examples if int(example[label_key]) == label]
        remaining = [example["money_remaining"] for example in group]
        output[name] = {
            "n": len(group),
            "start_money_median": statistics.median(example["start_money"] for example in group),
            "money_spent_median": statistics.median(example["money_spent"] for example in group),
            "money_remaining_median": statistics.median(remaining),
            "remaining_below_helmet_cost_rate": round4(sum(value < helmet_cost for value in remaining) / len(group)),
            "concurrent_purchase_rates": {
                item: round4(sum(bool(example["_delta"][item]) for example in group) / len(group))
                for item in ["smoke", "fire", "he", "flash", "kit", "primary", "paid_secondary"]
            },
            "grenade_cost_mean": round4(sum(example["_delta"]["grenade_cost"] for example in group) / len(group)),
        }
    binding_skip = [
        example for example in examples
        if not int(example[label_key]) and example["money_remaining"] < helmet_cost
    ]
    output["binding_skip_signature"] = {
        "n": len(binding_skip),
        "share_of_skip": round4(len(binding_skip) / sum(not int(example[label_key]) for example in examples)),
        "any_smoke_fire_kit_rate": round4(
            sum(example["_delta"]["smoke"] or example["_delta"]["fire"] or example["_delta"]["kit"] for example in binding_skip)
            / len(binding_skip)
        ) if binding_skip else None,
        "any_weapon_or_critical_item_rate": round4(
            sum(
                example["_delta"]["primary"]
                or example["_delta"]["paid_secondary"]
                or example["_delta"]["smoke"]
                or example["_delta"]["fire"]
                or example["_delta"]["kit"]
                for example in binding_skip
            ) / len(binding_skip)
        ) if binding_skip else None,
    }
    output["choice_by_start_money_band"] = summarize_counts(
        examples, lambda example: f"{min(example['start_money'] // 500 * 500, 6000)}+" if example["start_money"] >= 6000 else str(example["start_money"] // 500 * 500), label_key
    )
    for example in examples:
        example.pop("_delta", None)
    return output


def fresh_three_way_purchase_context(examples: list[dict], weapon_prices: dict[str, int]) -> list[dict]:
    output = []
    for choice in FRESH_CLASSES:
        group = [example for example in examples if example["fresh_choice"] == choice]
        deltas = [delta_purchases(example, weapon_prices) for example in group]
        output.append({
            "choice": choice,
            "n": len(group),
            "start_money_median": statistics.median(example["start_money"] for example in group),
            "money_spent_median": statistics.median(example["money_spent"] for example in group),
            "money_remaining_median": statistics.median(example["money_remaining"] for example in group),
            "concurrent_purchase_rates": {
                item: round4(sum(bool(delta[item]) for delta in deltas) / len(deltas))
                for item in ["smoke", "fire", "he", "flash", "kit", "primary", "paid_secondary"]
            },
            "grenade_cost_mean": round4(sum(delta["grenade_cost"] for delta in deltas) / len(deltas)),
        })
    return output


def build_team_round_inference_examples(team_rounds: dict, mechanics: dict, families: dict) -> list[dict]:
    output = []
    for current in sorted(team_rounds.values(), key=lambda row: (row["map"], row["round"], row["team_key"])):
        if current["side"] != "ct" or current["overtime"] or current["round"] in {1, 13}:
            continue
        opponent = opponent_round(team_rounds, current)
        if opponent is None or current["loss_index_ambiguous"] or opponent["loss_index_ambiguous"]:
            continue
        own_previous = team_rounds.get((current["map"], current["round"] - 1, current["team_key"]))
        opponent_previous = team_rounds.get((opponent["map"], opponent["round"] - 1, opponent["team_key"]))
        if own_previous is None or opponent_previous is None:
            continue
        mix = oracle_mix(opponent, mechanics, families)
        if mix["unknown_count"]:
            continue
        output.append({
            "series": series_of_map(current["map"]),
            "map": current["map"],
            "round": current["round"],
            "round_in_half": round_in_half(current["round"]),
            "score_diff": current["score_ct"] - current["score_t"],
            "opponent_loss_index": opponent["loss_index"],
            "opponent_previous_win": int(opponent_previous["winner_side"] == "t"),
            "previous_plant": int(own_previous["end_reason"] in {"target_bombed", "bomb_defused"}),
            "opponent_previous_win_streak": previous_win_streak(team_rounds, opponent),
            "target_threat_present": int(mix["helmet_sensitive_count"] >= 1),
            "target_established": mix["established"],
        })
    return output


def threat_inference_analysis(examples: list[dict]) -> tuple[dict, dict[tuple[str, int], str]]:
    result = {}
    established_classes: dict[tuple[str, int], str] = {}
    stored = {}
    for target in ["target_threat_present", "target_established"]:
        labels = [int(example[target]) for example in examples]
        prevalence, _ = oof_probabilities(examples, labels, None, "series")
        direct, _ = oof_probabilities(examples, labels, lambda example: public_opponent_features(example, False), "series")
        tracked, _ = oof_probabilities(examples, labels, lambda example: public_opponent_features(example, True), "series")
        result[target] = {
            "prevalence_only": metric_summary(labels, prevalence, selective=True),
            "direct_gsi": metric_summary(labels, direct, selective=True),
            "direct_plus_tracked_gsi": metric_summary(labels, tracked, selective=True),
            "tracked_subgroups": {
                "post_pistol": metric_summary(
                    [label for label, example in zip(labels, examples) if example["round_in_half"] == 2],
                    [probability for probability, example in zip(tracked, examples) if example["round_in_half"] == 2],
                    selective=True,
                ),
                "later_rounds": metric_summary(
                    [label for label, example in zip(labels, examples) if example["round_in_half"] >= 3],
                    [probability for probability, example in zip(tracked, examples) if example["round_in_half"] >= 3],
                    selective=True,
                ),
            },
        }
        stored[target] = tracked
    established_probabilities = stored["target_established"]
    threat_labels = [int(example["target_threat_present"]) for example in examples]
    relation: dict[str, list[int]] = defaultdict(list)
    for example, probability, threat in zip(examples, established_probabilities, threat_labels):
        classification = (
            "LIKELY_NOT_ESTABLISHED_RIFLE"
            if probability <= LOW_THRESHOLD
            else "LIKELY_ESTABLISHED_RIFLE"
            if probability >= HIGH_THRESHOLD
            else "UNKNOWN"
        )
        established_classes[(example["map"], example["round"])] = classification
        relation[classification].append(threat)
    result["established_class_vs_actual_helmet_threat"] = [
        {
            "class": classification,
            "n": len(labels),
            "actual_threat_present_rate": round4(sum(labels) / len(labels)),
            "actual_no_threat_rate": round4(1 - sum(labels) / len(labels)),
        }
        for classification, labels in sorted(relation.items())
    ]
    return result, established_classes


def inferred_class_choice(examples: list[dict], label_key: str, classes: dict[tuple[str, int], str]) -> list[dict]:
    grouped: dict[str, list[int]] = defaultdict(list)
    for example in examples:
        classification = classes.get((example["map"], example["round"]), "UNKNOWN")
        grouped[classification].append(int(example[label_key]))
    return [
        {
            "class": classification,
            "n": len(labels),
            "helmet_rate": round4(sum(labels) / len(labels)),
            "skip_rate": round4(1 - sum(labels) / len(labels)),
        }
        for classification, labels in sorted(grouped.items())
    ]


def weapon_price_map(rules: dict, key_to_display: dict[str, str]) -> dict[str, int]:
    output = {}
    aliases = rules["weaponAliases"]
    weapons = rules["weapons"]
    for key, display in key_to_display.items():
        internal = aliases.get(key)
        if internal and internal in weapons:
            output[display] = int(weapons[internal]["price"])
    return output


def cohort_summary(examples: list[dict], label_key: str) -> dict:
    return {
        "n": len(examples),
        "helmet_n": sum(int(example[label_key]) for example in examples),
        "skip_n": sum(not int(example[label_key]) for example in examples),
        "helmet_rate": round4(sum(int(example[label_key]) for example in examples) / len(examples)),
        "match_series": len({example["series"] for example in examples}),
        "maps": len({example["map"] for example in examples}),
        "players": len({example["player"] for example in examples}),
    }


def audit_invariants(
    rows: list[dict],
    fresh_eligible: list[dict],
    fresh_armor_buyers: list[dict],
    upgrade: list[dict],
    upgrade_extraction: dict,
    team_inference_examples: list[dict],
) -> None:
    if len(rows) != 43620:
        raise SystemExit(f"raw corpus row invariant failed: {len(rows)}")
    if Counter(example["fresh_choice"] for example in fresh_eligible) != Counter(
        {"no_armor": 848, "kevlar": 2558, "vesthelm": 3281}
    ):
        raise SystemExit("fresh three-way cohort invariant failed")
    if len(fresh_armor_buyers) != 5839 or sum(example["has_helmet"] for example in fresh_armor_buyers) != 3281:
        raise SystemExit("fresh armor-buyer cohort invariant failed")
    if len(upgrade) != 543 or sum(example["has_helmet"] for example in upgrade) != 396:
        raise SystemExit("full-armor upgrade cohort invariant failed")
    if upgrade_extraction["extraction_sha256"] != EXPECTED_UPGRADE_EXTRACTION_SHA256:
        raise SystemExit("full-armor replay extraction hash invariant failed")
    if len(team_inference_examples) != 3790:
        raise SystemExit("CT team-round inference cohort invariant failed")
    if len({(example["map"], example["round"]) for example in team_inference_examples}) != len(team_inference_examples):
        raise SystemExit("CT team-round inference cohort contains duplicates")
    if any(example["oracle"]["unknown_count"] for example in fresh_eligible + upgrade):
        raise SystemExit("primary/secondary cohort contains unresolved oracle weapon mechanics")
    if len(own_features(fresh_eligible[0])) != len(own_feature_names()):
        raise SystemExit("own feature/name contract length mismatch")
    if len(deployable_opponent_features(fresh_eligible[0])) != len(deployable_feature_names()):
        raise SystemExit("deployable feature/name contract length mismatch")


def run_study(args: argparse.Namespace) -> dict:
    import numpy
    import scipy
    import sklearn

    corpus_hash = assert_hash(args.corpus, EXPECTED_CORPUS_SHA256)
    weapon_names_hash = assert_hash(args.weapon_names, EXPECTED_WEAPON_NAMES_SHA256)
    rows = json.loads(args.corpus.read_text(encoding="utf-8"))
    key_to_display, families = parse_weapon_names(args.weapon_names)
    rules = json.loads(args.weapon_rules.read_text(encoding="utf-8"))
    mechanics = json.loads(args.mechanics.read_text(encoding="utf-8"))
    if mechanics["source"]["sha256"] != EXPECTED_VDATA_SHA256:
        raise SystemExit("mechanics artifact does not reference the pinned vdata")
    team_rounds = aggregate_team_rounds(rows)
    fresh_eligible, fresh_armor_buyers, fresh_exclusions = build_fresh_cohorts(
        rows, team_rounds, mechanics, families
    )
    for example in fresh_armor_buyers:
        example["helmet_bought"] = int(example["has_helmet"])
    upgrade, upgrade_extraction = build_upgrade_cohort(
        rows, team_rounds, mechanics, families, args.maps_dir
    )
    for example in upgrade:
        example["helmet_bought"] = int(example["has_helmet"])

    team_inference_examples = build_team_round_inference_examples(team_rounds, mechanics, families)
    audit_invariants(
        rows, fresh_eligible, fresh_armor_buyers, upgrade, upgrade_extraction,
        team_inference_examples,
    )
    threat_inference, established_classes = threat_inference_analysis(team_inference_examples)
    prices = weapon_price_map(rules, key_to_display)

    fresh_choices = Counter(example["fresh_choice"] for example in fresh_eligible)
    result = {
        "schema_version": 1,
        "purpose": "CT helmet decision targeted observational study",
        "input": {
            "corpus_sha256": corpus_hash,
            "canonical_weapon_names_sha256": weapon_names_hash,
            "weapon_mechanics_artifact_sha256": sha256(args.mechanics),
            "raw_player_rounds": len(rows),
            "event_packages_dir": str(args.maps_dir),
            "runtime": {
                "python": sys.version.split()[0],
                "numpy": numpy.__version__,
                "scipy": scipy.__version__,
                "scikit_learn": sklearn.__version__,
            },
        },
        "feature_boundary": {
            "own_state": [
                "start money",
                "retained own primary family/secondary/utility/kit",
                "own loss index and previous result",
                "round in half and public score",
            ],
            "deployable_opponent_increment": [
                "opponent public loss index",
                "previous round winner",
                "previous witnessed plant",
                "opponent current-half prior win streak",
            ],
            "forbidden_live_inputs": [
                "opponent money/spend",
                "opponent retained/current/resulting weapons",
                "opponent survivors/kills",
                "team/player identity",
                "current-round result",
            ],
        },
        "cohorts": {
            "fresh_choice_eligible": {
                "definition": "CT; pre-decision no armor/no helmet; startMoney >= 1000; regulation non-pistol; clean row; complete deployable context",
                "n": len(fresh_eligible),
                "outcomes": dict(sorted(fresh_choices.items())),
                "match_series": len({example["series"] for example in fresh_eligible}),
                "players": len({example["player"] for example in fresh_eligible}),
                "exclusions_after_base_filter": fresh_exclusions,
            },
            "fresh_armor_purchase_primary": {
                "definition": "fresh-choice eligible and resulting armor=true; target vesthelm vs kevlar",
                **cohort_summary(fresh_armor_buyers, "helmet_bought"),
            },
            "full_armor_upgrade_secondary": {
                "definition": "CT; previous replay final frame alive with armor=100; no retained helmet; startMoney >= 350",
                **cohort_summary(upgrade, "helmet_bought"),
                "extraction_audit": upgrade_extraction,
            },
        },
        "fresh_primary": {
            "three_way_choice_model": evaluate_fresh_three_way(fresh_eligible),
            "three_way_purchase_context": fresh_three_way_purchase_context(fresh_eligible, prices),
            "choice_model": evaluate_choice_model(fresh_armor_buyers, "helmet_bought"),
            "oracle_weapon_mix": oracle_analysis(fresh_armor_buyers, "helmet_bought"),
            "opportunity_cost": opportunity_cost_analysis(
                fresh_armor_buyers, "helmet_bought", prices, 350
            ),
            "coarse_established_class_choice": inferred_class_choice(
                fresh_armor_buyers, "helmet_bought", established_classes
            ),
        },
        "upgrade_secondary": {
            "choice_model": evaluate_choice_model(upgrade, "helmet_bought"),
            "oracle_weapon_mix": oracle_analysis(upgrade, "helmet_bought"),
            "opportunity_cost": opportunity_cost_analysis(upgrade, "helmet_bought", prices, 350),
            "coarse_established_class_choice": inferred_class_choice(
                upgrade, "helmet_bought", established_classes
            ),
        },
        "deployable_threat_inference": {
            "unit": "unique regulation CT team-round perspective",
            "n": len(team_inference_examples),
            "match_series": len({example["series"] for example in team_inference_examples}),
            "models": threat_inference,
        },
        "interpretation_boundary": [
            "observational professional behavior, not causal or optimal truth",
            "demo weapon mix is explanatory/oracle only",
            "multi-projectile weapon rows are excluded from the primary mechanics class",
            "weapon definition is zero-range and does not claim all-distance equivalence",
        ],
    }
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=Path("/tmp/roundsense-cologne-policy/player-rounds.json"))
    parser.add_argument("--maps-dir", type=Path, default=Path("/tmp/roundsense-cologne-policy/maps"))
    parser.add_argument(
        "--weapon-names",
        type=Path,
        default=Path.home() / "GitHub/cs2-demo-analysis-kit/packages/presentation/src/weapons.ts",
    )
    parser.add_argument(
        "--weapon-rules",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "packages/economy-advisor/rules/weapons.v2026-08-06.json",
    )
    parser.add_argument(
        "--mechanics",
        type=Path,
        default=Path(__file__).resolve().parent / "data/weapon-headshot-mechanics.v2026-08-06.json",
    )
    parser.add_argument("--weapon-vdata", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent / "results/helmet-decision-study.json",
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    if args.weapon_vdata:
        artifact = build_mechanics_artifact(
            args.weapon_vdata, args.corpus, args.weapon_names, args.weapon_rules
        )
        write_json(args.mechanics, artifact)
    result = run_study(args)
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not args.output.exists():
            raise SystemExit(f"missing committed output: {args.output}")
        existing = args.output.read_text(encoding="utf-8")
        if existing != rendered:
            raise SystemExit("determinism check failed: regenerated output differs")
        print(f"PASS deterministic result: {args.output}")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
        print(f"wrote {args.output}")


if __name__ == "__main__":
    main()
