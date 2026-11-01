# Real-hand results

Aggregate results from the scripts in [`research/real-hands/`](../../research/real-hands/),
computed from hand histories that are not in this repository.

- `q1q2/`: tails and carry-over of one player's 100-hand results. Contains
  `results.json`, CSV tables, `ruin_calibrated.json` and figures 1–4.
- `q3/`: how far apart players' true win rates are, and case study §2 under the
  fitted priors. Contains `results.json`, `population.csv`, `chapter2.csv` and
  figures 5–6.

Each `results.json` records its provenance: the sha256 of the derived tables and
of the script that made it, the dataset commit, the repository commit and the
package versions. There are no player IDs, hand IDs or table names here, only
statistics over players.

**Source.** These are statistics derived from the
[PHH dataset](https://zenodo.org/doi/10.5281/zenodo.10796885): Kim (2024),
*Recording and Describing Poker Hands*, arXiv:2312.11753. They use its HandHQ
logs for PartyPoker and Ongame no-limit hold'em, $2/$4, 1–23 July 2009. The
dataset is licensed under CC BY 4.0, and these results are a modified, aggregated
form of it.
