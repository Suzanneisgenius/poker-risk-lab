# Changelog

## Read this first: the bankroll numbers changed (calculation engine 2026-10-21)

The calculation engine changed two things at once, so the same settings and
seed now give different numbers than earlier versions. Nothing the user
entered changed.

1. **Ruin monitoring.** A Brownian-bridge correction also counts paths that
   touch the ruin threshold *between* the 100-hand checkpoints.
2. **Random-number streams.** The web engine gives every simulated path its
   own sfc32 stream, seeded from (seed, path index). It previously drew all
   paths from one mulberry32 stream.

Same inputs in both versions (30 BI, threshold 0, 90 bb/100 swings, 100,000
hands, 2,000 paths, seed 42), called directly through the calculation function:

| Win rate | functional-fix (2026-10-05) | Engine 2026-10-21 | Change |
|---|---:|---:|---:|
| 0 bb/100 | 27.75% | 28.90% | +1.15 pp |
| +3 bb/100 | 7.85% | 6.35% | −1.50 pp |

How each change splits up at the same seed:

| Win rate | functional-fix | new streams, ruin checked only at step ends | + bridge correction |
|---|---:|---:|---:|
| 0 bb/100 | 27.75% | 28.00% (+0.25 pp) | 28.90% (+0.90 pp) |
| +3 bb/100 | 7.85% | 6.00% (−1.85 pp) | 6.35% (+0.35 pp) |

- **Do not read 7.85% → 6.35% as lower risk.** The drop comes from the
  different random sample, not from the bridge correction, which raised the
  number. With 2,000 paths a single run at this level has a 95% Monte Carlo
  interval of about ±1 percentage point (±2 at 0 bb/100), and one run with a
  different stream cannot show that either stream is more accurate.
- **Over 40 seeds (0–39, 2,000 paths each)** the bridge correction raised
  risk for every seed: on average +0.355 pp at +3 bb/100 (7.11625%, analytical
  7.16915%) and +0.790 pp at 0 bb/100 (29.20875%, analytical 29.18406%).
  Agreement with the analytical value checks the simulation against its own
  model; it does not show that the model describes real games.
- Neither the difference between versions nor its parts are a change in
  real-world risk or an effect of anything a user did. A/B comparisons inside
  the page always use one engine version.
- Settings, seeds, the run command and every seed's output are archived in
  [`checks/calculation-change-2026-10-21/`](checks/calculation-change-2026-10-21/README.md);
  `node checks/calculation-change-2026-10-21/run.js --check` reproduces them.
  An earlier version of this note quoted 7.14%, +0.36 pp and +0.84 pp without a
  seed list; those came from seeds 7919 × 1–40 and are reproducible too (see
  that README).
- Every bankroll result now carries `model.version` (currently `2026-10-21`),
  and saved or exported comparisons record it; the page calls it the
  calculation engine version. Bump it whenever the same inputs and seed would
  give different numbers, and add a line to `ENGINE_UPDATES` in
  `standalone/build/app.js` saying what changed.
- The Python engine (`src/simulation.py`) applies the same correction by default
  (`bridge=True`); `bridge=False` reproduces its earlier results exactly.
- The saved research outputs in `reports/` were **not** regenerated. The Monte
  Carlo convergence experiment keeps endpoint-only monitoring on purpose,
  because that is its estimand.

## 2026-10-22 — `src/inference.py`: the page's stability check instead of lag-1

- **`estimate_edge` widens the standard error the way the page does.** The
  blocks, in time order, are cut into up to 10 consecutive groups and their
  win rates compared (chi-square, flagged at p < 0.05). When the check flags,
  the SE becomes the between-group one (×1 to ×10). It replaces the lag-1
  autocorrelation adjustment, which `checks/session-lengths/` showed rarely
  noticed a drifting win rate (5–14% of drifting histories, against 20–40%)
  and barely helped when it did. `widen=None` follows the check, `True`
  always widens, `False` never. New fields: `stability_groups`,
  `stability_q`, `stability_p`, `stability_flag`, `se_between_groups`,
  `stability_multiplier`, `se_multiplier`; `lag1_autocorr` and
  `effective_n_blocks` are gone. Fewer than 20 blocks: no check, and a warning.
- **Same check on both sides.** `checks/session-import-python/` now takes the
  stability numbers from `estimate_edge` itself, not from its own copy; the
  same 5,600 numbers agree as before.
- **The saved uncertainty case changed** (`reports/tables/uncertainty_risk_demo.json`,
  the Risk Lab's "Uncertainty" reference, figures in `reports/figures/`).
  Its 50 blocks are steady (stability p = 0.55), so the SE is no longer
  widened: 4.37 → 3.98 bb/100 (lag-1 had widened it ×1.10 for a correlation
  of +0.09).

  | | Before | Now |
  |---|---|---|
  | SE used for the posterior | 4.37 | 3.98 |
  | 95% CI for the win rate | −6.92 to 10.63 | −6.14 to 9.86 |
  | Posterior mean / SD (bb/100) | 1.56 / 4.00 | 1.60 / 3.70 |
  | P(win rate > 0) | 65.2% | 66.8% |
  | Plug-in ruin risk | 27.3% | 27.3% (unchanged) |
  | Average ruin risk over the posterior | 37.4% | 36.5% |
  | Average ÷ plug-in | ×1.37 | ×1.34 |
  | Median ruin risk | 30.4% | 30.0% |
  | 95% posterior interval of ruin risk | 0.9%–97.3% | 1.2%–95.7% |
  | P(risk > 5% / 10% / 25%) | 85.9% / 75.5% / 55.3% | 87.6% / 76.8% / 55.2% |

  Before regenerating, the old code reproduced the saved file on this machine
  to the last digit or two of floating point, so the change comes from the
  check alone. Settings and seeds are unchanged; the provenance now records
  commit 6cc3626 and macOS with numpy 2.5.4 / scipy 1.18.1 (was Linux, numpy
  2.2.6 / scipy 1.15.3).

## 2026-10-22 — Bankroll Risk: import your sessions (CSV)

- **Import a CSV of sessions** instead of typing totals: one row per session
  with `hands` and `profit_bb` (profit in big blinds, after rake), and
  optionally `stake`, `game` and `date` (YYYY-MM-DD). Common column names are
  recognised (`Profit (bb)`, `net_bb`, …), as are semicolon exports with
  decimal commas, quoted cells and a Unicode minus. Rows that cannot be read
  are listed by line and left out; ambiguous dates such as 31/01/2026 are not
  guessed. The file is read in the browser; only the totals of the selection
  are sent to the calculator. A template and a simulated example file are
  included (`standalone/shared/sessions-example.csv`, clearly marked as not
  real results).
- **Weighted by hands.** The win rate is total profit over total hands; the
  volatility weights each session's squared deviation by its hands, so it is
  estimated from the sessions (with a 95% interval) instead of assumed. The
  interval's ends become extra rows in the volatility table.
- **Filter and compare.** Select stakes, games and a range of months; compare
  the selection's groups by stake, game, month, quarter or year, with a test
  of whether their win rates differ by more than chance.
- **Two checks of the model**, shown with the selection: do short and long
  sessions swing alike per 100 hands, and is the win rate steady over time
  (10 blocks of sessions in date order)? When the win rate is not steady the
  page suggests widening its interval by the spread between the blocks, and
  says that this only partly fixes it.
- **Checked by simulation for unequal lengths** (`checks/session-lengths/`, in
  CI): 16,000 histories per length pattern, sessions of 30 to 4,000 hands.
  When the model holds, the 95% interval covers 94.3–95.2% in every pattern
  and the weighted volatility averages 89.8–90.1 (truth 90). The plain average
  of session win rates is up to 2.9× as far off, and scaling the spread of
  session win rates to the average session gives up to 261. A drifting win
  rate is the weak point: coverage falls to 75.5–83.5%; the stability check
  flags 20–40% of those histories and widening when it flags gives 82.7–85.9%.
- **What the study changed.** The first versions of the two checks did not
  hold up: a lag-1 correlation test of session win rates (the rule in
  `src/inference.py`) flagged drift only 5–13.5% of the time and widening by it
  barely helped, and a variance-ratio F test raised about 16% false alarms
  with heavy-tailed sessions. The page uses a block-based stability check and
  a test on absolute deviations instead. (`src/inference.py` followed in
  the entry above.)
- **Checked against the Python research code** (`checks/session-import-python/`,
  internal, in CI): 5 synthetic files (1,040 sessions) read by pandas, with
  every selection and grouping recomputed by `estimate_edge` and scipy; 5,600
  numbers agree (largest difference 2 × 10⁻¹⁴ relative, 3.5 × 10⁻⁸ in a
  p-value). The normal helpers moved to `standalone/shared/stats.js`, shared by
  page and server, with chi-square, F and incomplete gamma/beta functions
  checked against scipy.

## 2026-10-22 — Bankroll Risk from your own results

- **Start from a results summary.** Hands played and net win rate (after rake,
  actual winnings), then the plan: bankroll, big blinds per buy-in, hands to
  play and a ruin threshold. The simulation with an assumed win rate is still
  there as the second mode.
- **Volatility is never passed off as an estimate.** A net win rate and a
  hand count cannot tell how much results swing, so the player either enters
  the standard deviation from a tracker or picks one of four labelled
  assumptions (70, 90, 120, 150 bb/100). Every result names which it is, and a
  table shows the answer under each assumption.
- **Results.** A Normal posterior for the win rate (95% interval, chance it is
  above 0, how much of the weight comes from the results), the average risk of
  ruin over that posterior, and the 95% posterior interval of the risk.
- **The question, defined.** “Risk below 5% with 80% confidence” means: given
  these results and this model, the posterior probability that the risk of
  ruin within the planned hands is below 5% is at least 80%. The page calls it
  the 80% posterior upper bound of model risk and shows the bankroll it needs
  next to two other readings: average risk below 5%, and risk below 5% with
  the observed win rate taken as exact (what a fixed-win-rate calculator
  gives). For 40,000 hands at +4 bb/100 with 90 bb/100 assumed, 30 buy-ins and
  100,000 hands, the last says 28 buy-ins are enough; the first needs 56.9.
- **Fast and exact for the model.** Risk falls as the win rate rises, so the
  80% bound is the risk at the posterior's 20th percentile, and the bankroll
  is one root of the Brownian formula: no simulation. The average risk over a
  Normal posterior has a closed form (`server/bankroll_posterior.js`), checked
  against numerical integration and against the path simulator with each
  path's win rate drawn from the posterior.
- **How the answer changes.** The same results under each volatility
  assumption, each prior (none, weakly informative Normal(0, 10²), skeptical
  Normal(0, 2²)) and a quarter, 4× and 16× as many hands at the same win rate.
  A short panel says which of these moves the risk most for the player's own
  numbers; in the case study's tested scenarios it was the uncertain win rate.
- **Sample size, with its assumptions.** Hands needed for a ±1 bb/100 interval
  (precision and level adjustable) from results alone, assuming the volatility
  shown, independent results and a stable win rate: about 3.84 million hands at
  95% and 100 bb/100.
- **Checked against the Python research code** (`checks/bankroll-posterior-python/`,
  internal): 2,612 numbers in 9 cases, every table row and chart point
  included, recomputed with `src/bayes.py`, `src/validation.py`, quadrature and
  Brent's method. Largest differences 7.6 × 10⁻⁸ in a probability and
  2.4 × 10⁻⁸ (relative) in a bankroll. Runs in CI: Node checks the page still
  gives `web.json`, pytest recomputes it.
- Session CSV import (hands and profit per session, grouped by stake, game
  and period) is the next step and is not in this version.

## 2026-10-22 — review fixes: ranges, Validation page, earlier findings

- **A weight keeps every combo.** `AKs:0.5` is all four AKs combos, each at
  half weight. The status now shows both counts (“4 combos, weighted 2”), the
  help text says so, and the context line after a calculation does too.
- **“Ahead of the range” is decided combo by combo.** It used to class each
  hand by its average over its combos: A♥K♥ against J2s on Q♥7♥2♣ read
  “ahead of 100%” while two of the three combos are ahead (66.7%). Exact
  results now count each combo against every runout on whole numbers, and a
  hand whose combos fall on both sides shows their range. Monte Carlo results
  say they decide hand by hand, and call a hand within 1.96 standard errors of
  50% too close to call. The equity itself was always right.
- **Weights are stored to 4 decimals** (0.0001 steps; 2 decimals for
  percentages), so the text written back by the chart or Top % reads back to
  exactly the same range. More decimals are rejected with a message instead of
  being rounded away (`AKs:0.0000001` used to become an empty range). The page
  re-reads what it writes, so the preview always matches what is sent.
- **The PokerKit range check covers more**: 28 range texts, including repeats,
  overrides and weights, compared combo by combo with their weights; 6 exact
  spots compared on the total, every hand's equity and share, and the ahead /
  even / behind shares, including the J2s spot above.
- **A failed check is shown as failed.** The Validation page's pass wording
  and colour were written into the template; the old PokerKit section and the
  new range section would both have shown a failed comparison in green. Pass
  or fail now comes from each check's saved numbers, the wording follows it,
  and `npm run build` stops with the names of the failed checks
  (`--allow-failures` keeps the pages, marked as failing).
  `scripts/test_case_study_build.js` injects failures in memory and checks both.
- **Risk Lab comparison files are checked before import**: probabilities in
  0–1, an interval in order that contains its estimate, survival equal to
  1 − risk, a non-negative drawdown and usable inputs. The list of changed
  inputs is recomputed from the inputs instead of read from the file. The
  hand-edited user-testing file is now a consistent edit, which only
  recomputing can catch.
- **Monitoring wording.** The case study no longer says checkpoint-only
  monitoring understates all five models alike: they are compared on the same
  100-hand checkpoints, which does not establish equal monitoring bias or give
  their continuously monitored risks.
- **The Risk Lab's robustness note** quoted ×1.44 and ×1.20 from an earlier
  quick scenario and said the variance was held fixed. It is now generated from
  the case study's saved results (AR(1) ×2.87, regimes ×1.65) and says that the
  regime model's steps are wider, so it does not hold the variance fixed.

## 2026-10-22 — opponent ranges in Hand Equity

- **Give one opponent a range** instead of two cards: type it (`TT+, AQs+,
  AKo`, `A5s-A2s`, `T9s-65s`, `AsKs`, weights such as `AKs:0.5`), tap hands
  in a 13×13 chart, or take the top X% of hands. The editor shows how many
  combos the range holds and how many are left after your cards and the
  board (card removal). Ranges are heads-up only.
- **Results per hand in the range.** Equity against each hand, toughest first,
  with its share of the range, and the share of the range you are ahead of
  (above 50% equity), even with or behind.
- **Exact where it is cheap.** On the flop, turn and river every live combo is
  run out on every board (at most 1,081 combos × 990 runouts on the flop).
  Before the flop it is Monte Carlo, stratified by hand: each hand gets trials
  in proportion to its share, so the shares carry no sampling noise and the
  reported standard error is the stratified one.
- **One parser for page and server** (`standalone/shared/range.js`). The page
  previews the range as it is typed; the server parses the text again and
  never trusts the preview.
- **Top %** ranks the 169 hands by all-in equity against one random hand (the
  PokerStove convention), simulated with 10 million trials per hand
  (`scripts/hand_order.js`, saved in `standalone/shared/hand-order.json`). AA
  85.2% and 32o 32.3% match the published values; 32 of 168 neighbouring
  pairs are within two standard errors of each other and may swap. Other
  tools order hands differently.
- **Checked against PokerKit** (`checks/range-equity-pokerkit/`): the same
  combos from all 20 range texts; equal exact equity (largest difference
  3 × 10⁻¹⁶) on 5 flop, turn and river spots, including all 1,081 hands left on
  a flop; and preflop exact values within 0.57 and 0.91 standard errors of
  320,000 independent deals ranked by PokerKit. PokerKit has no weights and
  rejects kicker ranges like `A5s-A2s`, so the script applies weights and
  spells those out.
- Tests: `standalone/shared/test_range.js` (notation, errors, a 300-range
  format round trip, card removal, Top %), engine checks against the weighted
  mean of exact heads-up results, and API checks for limits, costs and errors.

## 2026-10-22 — case study and validation pages

- **Case study** (`case-study/index.html`, also served at `/case-study/`): one
  question — how much should we trust a simulated risk estimate? — answered
  one source of uncertainty at a time for the Risk Lab default scenario:
  simulation noise (40 seeds at 500 / 2,000 / 20,000 paths), an uncertain win
  rate (risk intervals after 10k–1M hands of history), and five models of how
  results arrive (Wilson intervals). Each has one control, one chart, one
  explanation and its limits, plus a short account of how the misleading
  7.85% → 6.35% difference was checked.
- **Validation** (`case-study/validation.html`): each check with its
  benchmark, conditions, quantity and limits. New checks in `checks/`:
  - PokerKit 0.7.7 cross-check (independent): 0 disagreements in hand order
    over 20,000 random hands; identical win/tie/lose counts on 7 exactly
    enumerated spots, including two preflop spots; three-way Monte Carlo
    0.77 SE from PokerKit's exact value.
  - Equity error against time, exact versus Monte Carlo.
  - Evaluator benchmark with its conditions: earlier and current evaluator,
    same hands and machine, identical scores, ×134 median speed-up on one
    Apple M4 Max with Node 24.
  - Web and research bankroll engines agree within 0.91 SE at 200,000 paths;
    both match the exact value with the bridge correction.
- **Reproducibility.** `configs/case_study/*.yaml` and
  `python -m src.experiments.case_study --case all` regenerate every figure;
  outputs record the commit, whether code had changed since it, seeds, path
  counts and package versions. `npm run build` builds both pages from the
  saved outputs and fails if the README's main finding no longer matches them.
  Research figures need `requirements-research.txt` (adds Matplotlib and
  PyYAML).
- README opens with the question, main finding, links and limits, followed by
  an empty authorship section for the author to fill in.
- `docs/user-testing-plan.md` adds a task on reading a risk interval and a log
  template.

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
