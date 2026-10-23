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

## 2026-10-23 — two routes, and the investigation up front

- **Case study.** A short preview of "Checking a misleading result" now sits
  right after the short answer: the 7.85% → 6.35% drop at seed 42, why it was
  sampling, and the 40-seed averages (endpoint-only 6.76%, bridge 7.12%, s.e.
  0.08 points, exact 7.17%) with their conditions and a link to the full
  section. The numbers are filled in from
  `checks/calculation-change-2026-10-21/results.json` at build time, and
  `scripts/test_case_study_build.js` checks them. The README's main finding
  adds one sentence on the same check.
- **Tabs.** Risk Lab, Bankroll Risk, Hand Equity and Pot Odds & EV come first;
  Preflop (with the Kuhn poker demo) and About sit to the right as secondary
  tabs. The header line names the two routes.
- **"What changed" on both routes.** Bankroll Risk and Pot Odds & EV compare
  each new result with the one shown when the edit began (when a control was
  focused or pressed): which inputs differ, the main numbers before and now,
  and why they moved. A reason states a direction only where it holds by
  construction, for example a stricter risk limit or a lower win rate needing
  more bankroll, or EV moving by the equity change × (pot + call). Where the
  volatility changes, which moves both the win-rate estimate and the risk at
  each win rate, it names both without a direction. When inputs from more than
  one group changed, it says the comparison cannot tell which one moved the
  answer. `standalone/test_ui_logic.js` checks every stated direction against
  the computed numbers.
- **`site/DEPLOY.md`** said the page works by double-click and on Netlify Drop
  or GitHub Pages, and listed a "GTO Trainer" tab. The app needs its Node
  server for every calculation, so a static copy loads but cannot calculate.
  It now describes the server deployment, the static case-study pages and the
  current tabs. The README's tool list follows the new tab order and folds the
  Kuhn demo into Preflop.

## 2026-10-23 — findings stated within what was checked

- **Uncertainty does not always raise risk.** `src/bayes.py`,
  `docs/methodology.md` and the application summary said ruin risk is convex in
  the win rate, so averaging over the posterior raises it. Finite-horizon risk
  is not convex everywhere: for a posterior N(−3, 2²) bb/100 with 90 bb/100,
  3,000 bb and 100,000 hands, the plug-in risk is 66.16% and the averaged risk
  63.79% (quadrature; Gauss–Hermite agrees). A new test,
  `test_posterior_integrated_risk_can_fall_below_plug_in`, checks both numbers
  and the 20,000-draw estimate. The docs now give 27.3% → 36.5% as the
  reference scenario's result and say the direction and size depend on the
  posterior and model settings. No calculation changed.
- **Benchmarks scoped to the baseline model.** "Every Monte Carlo result is
  cross-checked against analytical and Markov-chain benchmarks" now reads that
  the baseline simulator was checked against them and that separate
  experiments examined heavy tails, shocks, regime switching and dependence.
- **Quick-run numbers out of the summaries.** The 8.2% endpoint bias, the
  "< 1%" bridge error and the −0.55 slope came from 2026-07 quick runs. The
  application summary, the case-study and portfolio-prompt docs, the Risk Lab
  research view and `standalone/bankroll-risk-lab.html` now quote the
  CI-checked result instead: at +3 bb/100 with 100-hand steps, endpoint-only
  6.76%, bridge-corrected 7.12% (s.e. 0.08 points), analytical 7.17%
  (`checks/calculation-change-2026-10-21/`). They also say that
  `tests/test_bridge.py` checks the bridge at 100-, 500- and 2,000-hand steps.
  The convergence study is described without a slope. The quick runs remain
  in the summary's source table as research records. The legacy page also
  still quoted AR(1) ×1.44 and regimes ×1.20 "at a fixed edge and variance"
  and 108 tests; it now matches the case study (×2.87, ×1.65 with wider steps)
  and 131 Python tests.
- **Bankroll page: assumptions folded.** The session checks and group
  comparison sit under "Inspect assumptions", whose summary says how many
  checks flag a problem; it opens by itself when one starts flagging. The
  detailed sensitivity tables fold the same way. Inputs, the bankroll needed,
  its definition, the three readings and the risk ranges stay open.
- **"No change detected" is no longer a green tick.** Checks that find nothing
  show a neutral "i", and the Risk Lab's stability line now says no change was
  detected, which is no evidence the win rate was steady. Previously it said
  the win rate "does not differ".
- **Smaller fixes.** The volatility list in "How the risk range changes" showed
  an estimated volatility unrounded (101.75964230597266); it shows 101.8. The
  equity engine's comment on ties now says what the variance envelope implies
  and that the wrong-call rate is checked at 0%, 0.1% and 20% ties rather than
  assumed to fall as ties rise. The 2026-10-23 entry's tiny-share example is
  `QQ+, 22:0.0001` (0.005%); `QQ, 22:0.0001` gives 0.0100%.

## 2026-10-23 — review fixes: undated sessions, an F test, range evidence

- **Sessions without a date are no longer dropped.** As soon as a file had
  one dated session, the page set a month range, and the range left out every
  undated session with no way back: a three-row file (one dated) read "3
  sessions read" but "1 of 3 sessions selected" and could not be used. Now
  every session counts until "Only sessions from a range of months" is
  ticked; then a note says how many sessions the range leaves out (without a
  date, or outside the months), with "Use all dates" to undo it. Time order
  for the stability check follows the Python rule on both sides: by date
  when every session has one, otherwise file order (the page's sort had
  mixed the two). `checks/session-import-python/` gains a partly dated file
  (60 sessions): 6,028 numbers agree.
- **The stability check and group comparison are F tests.** Both compared
  the between-group spread B = Σ W_g (μ_g − μ̂)² with the volatility estimated
  from the same sessions and read B / σ̂² as chi-square(G − 1), which treats
  σ as known. The weighted residuals split exactly into B and the spread
  within groups E, and F = (B / (G − 1)) / (E / (n − G)) is F(G − 1, n − G)
  exactly under the model. Example (now a test in JS and Python): 20 sessions
  of 100 hands, block means −15, −5, 5, 15 with residuals −20…20 gave p =
  0.063 before and p = 0.046 now, matching `scipy.stats.f_oneway`. With 20
  sessions the old reading flagged 3.3% of steady histories instead of 5%;
  the F test flags 5.0% in 4,000 simulated ones. With every group a single
  session there is nothing to compare against, and the page says the groups
  were not tested. `EdgeEstimate.stability_q` is now `stability_f`.
  `checks/session-lengths/` (150 sessions, so F and chi-square are close):

  | | Before | Now |
  |---|---|---|
  | False alarms when the model holds | 4.0–5.1% | 4.5–5.7% |
  | Drifting win rate flagged | 20.0–39.5% | 21.3–41.3% |
  | Coverage, widened when flagged (drift) | 82.7–85.9% | 82.8–86.1% |

  The saved uncertainty case is not flagged either way (p 0.55 → 0.58,
  F = 0.84), so its estimates and risk numbers are unchanged.
- **No flag no longer reads as proof.** "The win rate looks steady … differ
  no more than chance allows" is now "No change in win rate detected …" with
  "Finding none does not show the win rate was steady"; the length check
  says "No difference detected" instead of "swing alike"; a group comparison
  without a flag says "no difference detected, though small groups can hide
  one". A p-value beside 5% gets enough decimals not to round across it
  (0.0461 shows as 0.046, not 0.05).
- **Range calls: evidence matched to the claim.** The tie check covered
  20% ties over 1–150 runs only. Computed exactly by recursion on the score
  (0, ½ or 1 a run), a hand at 50% is called ahead at most 2.49% of the time
  over 1–400 runs with no ties, 2.41% with 0.1% ties and 1.31% with 20% ties;
  over 15 true equities from 2% to 98%, with no ties or 20% ties, one hand's
  interval holds its equity at least 95.0% of the time. These hold for one
  hand: the page note now says the interval is approximate and that across
  many hands one may land on the wrong side by chance.
- **A sliver of a range shows as "<0.01%".** 22 at weight 0.0001 is
  0.005% of `QQ+, 22:0.0001` against AdKs and showed as 0.00%; shares below 0.01% now
  read "<0.01%" and above 99.99% read ">99.99%".
- **Application summary matched to its sources.** It still said 108 tests
  (now 130 Python tests plus the JavaScript checks) and that AR(1) and
  regime switching raise risk ×1.2–1.4 "holding edge and variance fixed".
  Those multipliers are from an earlier quick run in a different scenario;
  the case study gives AR(1) ×2.87 (same spread per step) and regimes ×1.65,
  whose steps are wider (SD about 101 instead of 90), so the variance is not
  held fixed. "≈1.4×" from uncertainty is ×1.34. "The bridge correction cuts
  the error to < 1%" was 1.08% at a 500-hand step; it now says the bridge
  estimate agrees within simulation error (at most 1.1%). A new table lists
  each number's file, settings and commit, and marks the quick runs of
  2026-07-13/14 (no commit recorded) as historical. The same barrier and
  slope fixes are in `docs/case_study_imperfect_information.md` and
  `docs/portfolio_page_prompt.md`.

## 2026-10-22 — review fixes: rare hands in ranges, bankroll rounding, wording

- **Rare hands in a Monte Carlo range run are no longer called on a few
  runs.** Each hand gets runs in proportion to its share, so a hand at weight
  0.0001 may get 3 of 30,000; three wins or three losses have no spread, and
  the old rule (average within 1.96 empirical standard errors of 50%) called
  such a hand ahead or behind with certainty. Hero A♦K♠ against
  `QQ, 22:0.0001` called 22 "ahead" (seed 10) or "behind" (seed 7); exactly,
  hero has 47.35% against it. A hand is now ahead or behind only when its
  95% Wilson score interval with continuity correction lies above or below
  50%; otherwise it is "not clear". The interval assumes the largest spread a
  score of 0, ½ or 1 can have, so it needs no estimate of the spread and ties
  make it more cautious; six straight wins are the fewest that call a hand
  ahead. Computed exactly, a hand at 50% is called ahead at most 2.49% of the
  time for 1–400 runs (with 20% ties, 1.23% over 1–150 runs, the range then
  tested; 1.31% over 1–400, see 2026-10-23). Each row shows its runs and
  interval, and says "too few runs to tell" when the interval is 20 points or
  wider. Exact runs are unchanged (J2s still 2/3 ahead, combo by combo).
  Two display fixes found while checking this case: a weighted count now
  shows up to four decimals (22 at 0.0001 is "weighted 0.0006", not
  "weighted 0"), and a share just under 100% shows two decimals (99.99%, not
  100.0% beside 0.01%). The longer row text widened the page on tablets and
  phones; the Hand Equity column now shrinks and the run note wraps.
- **A bankroll needed is rounded up.** 40,000 hands at +3, volatility 90,
  weak prior, 5% within 100,000 hands with 80% posterior probability needs
  64.0167 buy-ins: the page showed 64, and a player with 64 read "about 0
  more needed" and a probability of "80.0%" (it is 79.987%). Amounts needed
  are now rounded up at the precision shown (0.1 buy-in below 100, whole
  buy-ins above): 64.1, with 6,410 bb from the same amount, "0.1 more
  needed", and 79.99%. The same applies to the three readings, the
  sensitivity tables and the chart. Spare buy-ins round down. A probability
  or risk shown beside its target gets more decimals only where rounding
  would put it on or across the target. A test checks over 54 settings that
  typing in the amount shown meets the target.
- **Wording.** The panel comparing the win rate's interval with the volatility
  and prior choices is now "How the risk range changes under these settings":
  its three ranges are of different kinds, and the volatility and prior ones
  depend on which values are listed, so the widest is not a ranking of real
  uncertainty. The claim that a tracker's standard deviation "would remove
  most of it" is gone: the model treats any volatility as fixed and does not
  count its estimation error. The sample-size estimate is "a benchmark under
  idealized assumptions", not a lower bound. The model note says the page
  computes live and Python recomputed the fixed verification cases.

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
  commit 1c37f30 and macOS with numpy 2.5.4 / scipy 1.18.1 (was Linux, numpy
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
