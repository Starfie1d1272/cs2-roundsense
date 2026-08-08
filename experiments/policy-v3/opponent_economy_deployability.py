#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy==2.5.1", "scipy==1.18.0", "scikit-learn==1.9.0"]
# ///
"""Held-out deployability gate for normal-player GSI opponent context.

The demo corpus is used only to construct the evaluation label. Predictor
features are restricted to fields directly visible in normal-player GSI or
reliably tracked from prior GSI observations. No opponent money, inventory,
survivor, kill, spend, player identity, or team identity enters the model.

The experiment deliberately uses a tiny dependency-free logistic baseline.
It is a deployability check, not an attempt to maximize offline accuracy.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Callable, Iterable


EXPECTED_CORPUS_SHA256 = "33f29c35fb124a4e45d38a00be8f389d32403c0762576b607db7a9a37fe0d9e6"
EXPECTED_WEAPONS_SHA256 = "c08ff5380cab5267cb4c3175be9abcd19c5453616ef5ebd2db4e74305506b2cb"
FOLDS = 5
LOW_THRESHOLD = 0.20
HIGH_THRESHOLD = 0.80


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def assert_input(path: Path, expected: str) -> str:
    actual = sha256(path)
    if actual != expected:
        raise SystemExit(
            f"input hash mismatch for {path}: expected {expected}, got {actual}"
        )
    return actual


def load_rifle_or_sniper_names(path: Path) -> set[str]:
    """Parse the same canonical DAK weapon-family source as frozen research."""
    family = None
    names: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        comment = re.match(r"\s*//\s*(.+)$", line)
        if comment:
            heading = comment.group(1).strip()
            if heading in {"Rifles", "Snipers", "Pistols", "冲锋枪", "Heavy", "Equipment / utility"}:
                family = heading
            continue
        item = re.match(r'\s*\w+:\s*"([^"]+)"', line)
        if item and family in {"Rifles", "Snipers"}:
            names.add(item.group(1))
    required = {"AK-47", "M4A4", "M4A1-S", "AWP", "SSG 08"}
    if not required <= names:
        raise SystemExit(f"canonical weapon parse incomplete: missing {sorted(required - names)}")
    return names


def series_of_map(map_key: str) -> str:
    return re.sub(r"-m\d+-de_[a-z0-9_]+$", "", map_key)


def round_in_half(round_number: int) -> int:
    return round_number if round_number <= 12 else round_number - 12


def score_for_side(row: dict, side: str) -> int:
    return int(row["scoreCT"] if side == "ct" else row["scoreT"])


def aggregate_team_rounds(rows: list[dict]) -> dict[tuple[str, int, str], dict]:
    groups: dict[tuple[str, int, str], list[dict]] = defaultdict(list)
    for row in rows:
        groups[(row["map"], int(row["roundNumber"]), row["teamKey"])].append(row)

    team_rounds: dict[tuple[str, int, str], dict] = {}
    for key, players in groups.items():
        if len(players) != 5:
            raise SystemExit(f"team-round {key} has {len(players)} players, expected 5")
        first = players[0]
        if any(player["side"] != first["side"] for player in players):
            raise SystemExit(f"team-round {key} mixes sides")
        team_rounds[key] = {
            "map": first["map"],
            "round": int(first["roundNumber"]),
            "team_key": first["teamKey"],
            "side": first["side"],
            "score_ct": int(first["scoreCT"]),
            "score_t": int(first["scoreT"]),
            "winner_side": first["winnerSide"],
            "end_reason": first["endReason"],
            "loss_index": int(first["lossIndex"]),
            "loss_index_ambiguous": any(bool(player["lossIndexAmbiguous"]) for player in players),
            "overtime": any(bool(player["overtime"]) for player in players),
            "players": players,
        }
    return team_rounds


def previous_win_streak(
    team_rounds: dict[tuple[str, int, str], dict],
    current: dict,
) -> int:
    """Wins immediately before this round, reset at the half boundary."""
    wins = 0
    for previous_round in range(current["round"] - 1, 0, -1):
        previous = team_rounds.get((current["map"], previous_round, current["team_key"]))
        if previous is None or previous["winner_side"] != previous["side"]:
            break
        wins += 1
        if round_in_half(previous_round) == 1:
            break
    return min(wins, 3)


def one_hot(value: int, values: Iterable[int]) -> list[float]:
    return [1.0 if value == candidate else 0.0 for candidate in values]


def direct_features(example: dict) -> list[float]:
    """Only current normal-player GSI fields at freezetime."""
    return [
        1.0 if example["side"] == "ct" else 0.0,
        *one_hot(example["round_in_half"], range(2, 13)),
        *one_hot(example["loss_index"], range(5)),
        max(-10.0, min(10.0, float(example["score_diff"]))) / 10.0,
    ]


def tracked_features(example: dict) -> list[float]:
    """Direct fields plus complete, prior-round-only GSI history."""
    direct = direct_features(example)
    post_pistol = 1.0 if example["round_in_half"] == 2 else 0.0
    previous_win = float(example["previous_win"])
    return [
        *direct,
        previous_win,
        float(example["previous_plant"]),
        *one_hot(example["previous_win_streak"], range(4)),
        post_pistol * (1.0 if example["side"] == "ct" else 0.0),
        post_pistol * previous_win,
    ]


def build_examples(rows: list[dict], rifle_or_sniper: set[str]) -> tuple[list[dict], dict[str, int]]:
    team_rounds = aggregate_team_rounds(rows)
    exclusions: dict[str, int] = defaultdict(int)
    examples: list[dict] = []
    for current in team_rounds.values():
        round_number = current["round"]
        if current["overtime"] or round_number > 24:
            exclusions["overtime"] += 1
            continue
        if round_number in {1, 13}:
            exclusions["pistol_round"] += 1
            continue
        if current["loss_index_ambiguous"]:
            # The offline reconstruction cannot faithfully emulate the direct
            # GSI loss counter for these rows, so they cannot enter the gate.
            exclusions["offline_loss_index_ambiguous"] += 1
            continue
        previous = team_rounds.get((current["map"], round_number - 1, current["team_key"]))
        if previous is None:
            exclusions["missing_previous_round"] += 1
            continue

        opponent_score = score_for_side(current["players"][0], "t" if current["side"] == "ct" else "ct")
        own_score = score_for_side(current["players"][0], current["side"])
        examples.append(
            {
                "series": series_of_map(current["map"]),
                "map": current["map"],
                "round": round_number,
                "side": current["side"],
                "round_in_half": round_in_half(round_number),
                "loss_index": max(0, min(4, current["loss_index"])),
                "score_diff": own_score - opponent_score,
                "previous_win": int(previous["winner_side"] == current["side"]),
                "previous_plant": int(previous["end_reason"] in {"target_bombed", "bomb_defused"}),
                "previous_win_streak": previous_win_streak(team_rounds, current),
                "target_established_rifle": int(
                    sum(player.get("primary") in rifle_or_sniper for player in current["players"]) >= 3
                ),
            }
        )
    return examples, dict(sorted(exclusions.items()))


def group_folds(examples: list[dict], folds: int) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for example in examples:
        counts[example["series"]] += 1
    totals = [0] * folds
    assignments: dict[str, int] = {}
    for series, count in sorted(counts.items(), key=lambda item: (-item[1], item[0])):
        fold = min(range(folds), key=lambda index: (totals[index], index))
        assignments[series] = fold
        totals[fold] += count
    return assignments


def oof_probabilities(
    examples: list[dict],
    feature_fn: Callable[[dict], list[float]] | None,
) -> list[float]:
    from sklearn.linear_model import LogisticRegression

    assignments = group_folds(examples, FOLDS)
    probabilities = [math.nan] * len(examples)
    for fold in range(FOLDS):
        train = [example for example in examples if assignments[example["series"]] != fold]
        test_indices = [
            index for index, example in enumerate(examples) if assignments[example["series"]] == fold
        ]
        labels = [int(example["target_established_rifle"]) for example in train]
        if feature_fn is None:
            probability = sum(labels) / len(labels)
            for index in test_indices:
                probabilities[index] = probability
            continue
        model = LogisticRegression(max_iter=2000, random_state=42, solver="lbfgs")
        model.fit([feature_fn(example) for example in train], labels)
        test_probabilities = model.predict_proba(
            [feature_fn(examples[index]) for index in test_indices]
        )[:, 1]
        for index, probability in zip(test_indices, test_probabilities):
            probabilities[index] = float(probability)
    if any(math.isnan(probability) for probability in probabilities):
        raise SystemExit("OOF prediction coverage is incomplete")
    return probabilities


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


def metric_summary(labels: list[int], probabilities: list[float]) -> dict:
    clipped = [min(1 - 1e-9, max(1e-9, probability)) for probability in probabilities]
    selected = [
        (label, probability >= HIGH_THRESHOLD)
        for label, probability in zip(labels, probabilities)
        if probability <= LOW_THRESHOLD or probability >= HIGH_THRESHOLD
    ]
    positive = [(label, prediction) for label, prediction in selected if prediction]
    negative = [(label, prediction) for label, prediction in selected if not prediction]

    def accuracy(rows: list[tuple[int, bool]]) -> float | None:
        return sum(label == int(prediction) for label, prediction in rows) / len(rows) if rows else None

    return {
        "n": len(labels),
        "base_rate": round(sum(labels) / len(labels), 4),
        "log_loss": round(
            -sum(label * math.log(probability) + (1 - label) * math.log(1 - probability)
                 for label, probability in zip(labels, clipped)) / len(labels),
            4,
        ),
        "brier": round(sum((probability - label) ** 2 for label, probability in zip(labels, probabilities)) / len(labels), 4),
        "auc": round(auc(labels, probabilities), 4),
        "accuracy_at_0_5": round(
            sum(label == int(probability >= 0.5) for label, probability in zip(labels, probabilities)) / len(labels),
            4,
        ),
        "selective": {
            "thresholds": {"likely_not_established_max": LOW_THRESHOLD, "likely_established_min": HIGH_THRESHOLD},
            "coverage": round(len(selected) / len(labels), 4),
            "unknown_rate": round(1 - len(selected) / len(labels), 4),
            "accuracy": round(accuracy(selected), 4) if selected else None,
            "likely_established_n": len(positive),
            "likely_established_precision": round(accuracy(positive), 4) if positive else None,
            "likely_not_established_n": len(negative),
            "likely_not_established_precision": round(accuracy(negative), 4) if negative else None,
        },
    }


def evaluate(examples: list[dict], probabilities: list[float], predicate: Callable[[dict], bool] | None = None) -> dict:
    indices = [index for index, example in enumerate(examples) if predicate is None or predicate(example)]
    labels = [int(examples[index]["target_established_rifle"]) for index in indices]
    selected_probabilities = [probabilities[index] for index in indices]
    return metric_summary(labels, selected_probabilities)


def model_report(examples: list[dict], feature_fn: Callable[[dict], list[float]] | None) -> dict:
    probabilities = oof_probabilities(examples, feature_fn)
    return {
        "overall": evaluate(examples, probabilities),
        "post_pistol": evaluate(examples, probabilities, lambda example: example["round_in_half"] == 2),
        "later_rounds": evaluate(examples, probabilities, lambda example: example["round_in_half"] >= 3),
        "opponent_ct": evaluate(examples, probabilities, lambda example: example["side"] == "ct"),
        "opponent_t": evaluate(examples, probabilities, lambda example: example["side"] == "t"),
    }


def main() -> None:
    import numpy
    import scipy
    import sklearn

    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=Path("/tmp/roundsense-cologne-policy/player-rounds.json"))
    parser.add_argument(
        "--weapons",
        type=Path,
        default=Path.home() / "GitHub/cs2-demo-analysis-kit/packages/presentation/src/weapons.ts",
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    corpus_hash = assert_input(args.corpus, EXPECTED_CORPUS_SHA256)
    weapons_hash = assert_input(args.weapons, EXPECTED_WEAPONS_SHA256)
    rows = json.loads(args.corpus.read_text(encoding="utf-8"))
    examples, exclusions = build_examples(rows, load_rifle_or_sniper_names(args.weapons))
    series = {example["series"] for example in examples}
    result = {
        "schema_version": 1,
        "purpose": "normal-player GSI-only opponent established-rifle deployability gate",
        "input": {
            "corpus_sha256": corpus_hash,
            "weapons_sha256": weapons_hash,
            "raw_player_rounds": len(rows),
            "runtime": {
                "python": sys.version.split()[0],
                "numpy": numpy.__version__,
                "scipy": scipy.__version__,
                "scikit_learn": sklearn.__version__,
            },
        },
        "evaluation": {
            "unit": "opponent team-round perspective",
            "label_demo_oracle_only": "current resulting rifle/sniper count >= 3",
            "folds": FOLDS,
            "held_out_group": "match series",
            "fold_assignment": "deterministic greedy balance by series row count",
            "series": len(series),
            "eligible_team_rounds": len(examples),
            "exclusions": exclusions,
            "classifier": {
                "type": "LogisticRegression",
                "solver": "lbfgs",
                "C": 1.0,
                "max_iter": 2000,
                "random_state": 42,
            },
            "probability_contract": {
                "p_le_0_20": "LIKELY_NOT_ESTABLISHED_RIFLE",
                "p_ge_0_80": "LIKELY_ESTABLISHED_RIFLE",
                "otherwise": "UNKNOWN",
            },
        },
        "feature_contract": {
            "direct_normal_gsi": [
                "opponent side inferred from player.team",
                "map.round / round-in-half",
                "map.team_ct.score and map.team_t.score",
                "opponent map.team_*.consecutive_round_losses",
            ],
            "tracked_prior_gsi": [
                "previous-round winner",
                "previous-round witnessed plant",
                "current-half consecutive prior wins",
            ],
            "forbidden_oracle_inputs": [
                "opponent exact/team/player money",
                "opponent retained weapons or AWP",
                "opponent survivors or kills",
                "opponent current spend or resulting loadout",
                "team/player identity",
                "current-round result",
            ],
        },
        "models": {
            "prevalence_only": model_report(examples, None),
            "direct_gsi": model_report(examples, direct_features),
            "direct_plus_tracked_gsi": model_report(examples, tracked_features),
        },
    }
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()
