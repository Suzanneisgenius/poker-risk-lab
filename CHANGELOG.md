# Changelog

## Read this first: the bankroll numbers changed (model 2026-10-21)

Two things changed in the bankroll simulator at the same time, so the same
settings and seed now give different numbers than earlier versions:

1. **Ruin is monitored continuously.** A Brownian-bridge correction also counts
   paths that touch the ruin threshold *between* the 100-hand checkpoints.
2. **New random-number streams.** The web engine gives every simulated path its
   own sfc32 stream, seeded from (seed, path index). It previously drew all paths
   from one mulberry32 stream.

Same inputs in both versions, called directly through the calculation function
(30 BI, 90 bb/100 swings, 100,000 hands, 2,000 paths, seed 42):

| Win rate | functional-fix (2026-10-05) | Model 2026-10-21 | Change |
|---|---:|---:|---:|
| 0 bb/100 | 27.75% | 28.90% | +1.15 pp |
| +3 bb/100 | 7.85% | 6.35% | −1.50 pp |

How the +3 bb/100 change splits up, measured at the same seed:

| Step | Risk | Change |
|---|---:|---:|
| functional-fix engine | 7.85% | |
| new random streams, ruin still checked only at step ends | 6.00% | −1.85 pp (different random sample) |
| new random streams + bridge correction | 6.35% | +0.35 pp (bridge) |

- Most of this particular drop is sampling: with 2,000 paths a single run has a
  95% Monte Carlo interval of roughly ±1 percentage point. Over 40 seeds at the
  same settings the bridge correction *raises* risk on average (+0.36 pp at
  +3 bb/100, +0.84 pp at 0 bb/100) and brings the average in line with the
  finite-horizon Brownian benchmark (7.14% vs 7.17%; 29.21% vs 29.18%).
- Neither the difference between versions nor its parts are a change in
  real-world risk or an effect of anything a user did. A/B comparisons inside
  the page always use one model.
- Every bankroll result now carries `model.version` (currently `2026-10-21`),
  and saved or exported comparisons record it. Bump it whenever the same inputs
  and seed would give different numbers.
- The Python engine (`src/simulation.py`) applies the same correction by default
  (`bridge=True`); `bridge=False` reproduces its earlier results exactly.
- The saved research outputs in `reports/` were **not** regenerated. The Monte
  Carlo convergence experiment keeps endpoint-only monitoring on purpose,
  because that is its estimand.

## 2026-10-22 — interface

- **Result states.** Hand Equity, Pot Odds & EV and Bankroll Risk share one set
  of states (current result, calculating, previous calculation, update failed,
  no result yet). Shown numbers always name the inputs they were calculated
  for. The EV chart legend, hover text, reset button and chart description say
  "equity used" rather than "current".
- **Practice sets.** 10 / 20 questions or all 169 hands, a review with
  "Retry missed", frequency questions on mixed-strategy hands, and feedback that
  separates "in range" from "knows the mix". Each question records whether it
  came from the drawn set, from a retry, or was added from the Library, so the
  set note reads, for example, "Retrying 5 missed questions + 1 added from the
  Library (QJs)".
- **Practice progress is saved in this browser.** Returning offers "Continue
  this set" or "Start a new set"; the review of the previous set stays
  available after a retry or a new set.
- **Risk Lab guide.** Four steps (save A, change one assumption, compare, read
  B − A) with BI, bb/100 and P95 explained in place, and a note on the
  calculation change above.
- **Preflop matrix.** One Tab stop, arrow keys and Enter, and a hand search
  (A5s, AKo, 77, T9s) that shows a one-line summary with "View details" and
  "Show in matrix". On phones the scenario description starts folded.
- **Saved A/B comparisons.** Names, saving in this browser, JSON/CSV downloads
  with inputs, results, seeds and model versions, and JSON import. Each saved
  entry offers "View saved results" (the numbers as saved) and "Recompute in
  Risk Lab" (current model, saved seeds). A is restored from its snapshot only
  when it was saved under the current model; otherwise both sides are
  recomputed and compared with the saved values.

## 2026-10-21 — engines, server and CI

- **Hand evaluator rewritten** as a bitmask scorer. It agreed with an
  independent reference evaluator on 180,000 random 5/6/7-card hands in
  `standalone/engines/test_engines.js` (and on 2.1 million hands in a one-off
  development check), and reproduces the earlier seeded equity results exactly.
  This is evidence over the tested hands, not a proof over all hands. In a
  micro-benchmark on one development machine it went from about 77k to about
  10M seven-card evaluations per second; other machines will differ.
- Heads-up equity with a known opponent is now always enumerated exactly,
  preflop included.
- Finite-horizon Brownian reference computed in log space, so extreme inputs
  no longer report 100% ruin.
- Server: rate limiting keyed on the proxy-appended `X-Forwarded-For` entry
  (`TRUST_PROXY_HOPS`), work-based request cost, paths × hands ceiling, and a
  `ValidationError` type for 4xx responses.
- Added `.github/workflows/ci.yml` (build check, `npm test`, `pytest` on Python
  3.11 and 3.12). The workflow has not yet been observed running on GitHub.

## 2026-10-05 — functional-fix (imported)

Frontend revision: Risk Lab redesign with A/B comparison and the saved
uncertainty case, EV sensitivity, Trainer repairs and the Kuhn demo moved under
Preflop. See `docs/risklab-visual-update.md`,
`docs/scenario-uncertainty-ev-update.md`, `docs/kuhn-secondary-update.md` and
`checks/functionality-2026-10-05/README.md`.
