# Calculation change check — model 2026-10-21

Reproduces every number in the "Read this first" section of `CHANGELOG.md`.
`results.json` is the saved output, including each seed's ruin counts.

```bash
node checks/calculation-change-2026-10-21/run.js            # print
node checks/calculation-change-2026-10-21/run.js --check    # compare with results.json
node checks/calculation-change-2026-10-21/run.js --write    # overwrite results.json
```

The run is deterministic and takes about 7 seconds (Node 24). CI runs `--check`.

## Settings

30 BI (3,000 bb) bankroll, ruin threshold 0, 90 bb/100 standard deviation,
100,000 hands in 100-hand steps, 2,000 paths, win rates 0 and +3 bb/100.

- **Single seed:** seed 42, three ways: the functional-fix engine (its random
  stream and ruin check are copied into `run.js` from commit `6c9a151`), the
  current engine with the bridge correction off, and the current engine as
  shipped.
- **Many seeds:** seeds 0–39 (`--first 0 --count 40 --stride 1`), 2,000 paths
  each, current engine with and without the bridge correction, compared with
  the finite-horizon Brownian value from `brownFinite`.

## Results

| Win rate | functional-fix, seed 42 | new streams, bridge off | model 2026-10-21 |
|---|---:|---:|---:|
| 0 bb/100 | 27.75% (555) | 28.00% (560) | 28.90% (578) |
| +3 bb/100 | 7.85% (157) | 6.00% (120) | 6.35% (127) |

Ruined paths out of 2,000 in brackets.

| Win rate | Mean, bridge off | Mean, bridge on | Bridge effect (range over seeds) | Analytical |
|---|---:|---:|---:|---:|
| 0 bb/100 | 28.41875% | 29.20875% (s.e. 0.17 pp) | +0.790 pp (+0.40 to +1.15) | 29.18406% |
| +3 bb/100 | 6.76125% | 7.11625% (s.e. 0.08 pp) | +0.355 pp (+0.15 to +0.65) | 7.16915% |

## Reading it

- The two runs for one seed are paired: they share every path's random numbers,
  so the bridge run ruins every path the endpoint-only run ruins, plus the paths
  that dipped to the threshold between checkpoints. The bridge therefore never
  lowers risk for a given seed.
- The 7.85% → 6.35% drop at +3 bb/100 comes from the random-stream change
  (−1.85 pp). One run with a different stream cannot show that either stream
  is more accurate; the three single-seed 95% intervals overlap.
- The agreement between the bridge mean and the analytical value checks the
  simulation against its own model (normal increments, a fixed win rate). It
  does not show that the model describes real games.

## Earlier figures

The first version of the CHANGELOG quoted 7.14%, +0.36 pp and +0.84 pp without
a seed list. They came from seeds 7919, 15838, …, 316760 (7919 × 1–40), 2,000
paths each, and reproduce with:

```bash
node checks/calculation-change-2026-10-21/run.js --first 7919 --count 40 --stride 7919
```

That run gives 7.14% (+0.359 pp) at +3 bb/100 and 29.21% (+0.844 pp) at
0 bb/100. Both seed sets point the same way; the CHANGELOG now quotes seeds 0–39.
