# AWP Dependency & Economy Association (descriptive)

## Designated AWPer (role metadata, all_star_role == AWPer)

- AWP resulting rate: P(resulting primary == AWP) in financially viable rounds
  (startMoney >= $5400 = AWP + kevlar; >= $4000 = AWP only).
- AWP acquired rate: bought this round (retainedPrimary != AWP).
- AWP retained rate: carried in (retainedPrimary == AWP).
- dual-AWP: >= 2 players with resulting primary AWP in the same team-round (all regulation rounds).
- non-AWPer AWP: players with role != AWPer resulting with AWP in viable rounds.

## Association with post-pistol FORCE propensity

- awp_resulting_rate_5400 vs post_pistol_force_rate: rho=-0.2283, p=0.2522, n_teams=27 (Spearman, descriptive)
- awp_retained_rate_5400 vs post_pistol_force_rate: rho=-0.367, p=0.0597, n_teams=27 (Spearman, descriptive)

## AWPer economy behavior in the round BEFORE an AWP purchase

Sequential evidence only (previous-round row of the same player).
AWPer: rounds immediately before a bought AWP; non-AWPer: rounds before a bought rifle/SMG.

- AWPer: n=443, mean prev-round spent=847, median=500, eco-rate=0.447, action={'full': 144, 'semi': 99, 'eco': 198, 'force': 2}
- non-AWPer: n=6669, mean prev-round spent=1997, median=1300, eco-rate=0.296, action={'semi': 1329, 'full': 2821, 'eco': 1975, 'force': 544}

## Cautions

- All associations are observational (single event, small n per team).
- AWP dependency is confounded with team strength and map pool; no causal
  claim 'AWP-dependent teams ECO more' is supported by this table alone.
- 'because they need AWP they ECO' requires sequential evidence; the table
  above only describes the previous-round state, not the decision rule.