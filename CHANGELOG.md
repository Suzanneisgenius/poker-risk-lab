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
