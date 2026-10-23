# Application & Portfolio Summary

*Project: **Bankroll Risk Lab — Uncertainty-Aware Simulation and Validation of
Stochastic Ruin Models**.*

> A note on numbers. Every figure below comes from a seeded experiment, check or
> test in this repository, and §11 lists the file, settings and commit each one
> comes from. Two earlier quick runs (a barrier-resolution table and a
> convergence fit, 2026-07) are listed there as research records but are not
> quoted here; regenerate them with the high-precision configs
> (`configs/*.yaml`) before using their values. Do not round in a way that
> overstates an effect.

---

## 0. How to position this in a portfolio (strategy)

**Lead with the question, not the game.** The headline is *"How reliable is a
risk estimate when the model, the data, and the numerics are all imperfect?"* —
not "a poker calculator." Poker bankroll is the case study that makes the
abstract concrete; it is the second sentence, not the first.

**Two layers, clearly ranked.**
1. *Research layer (the headline):* Bankroll Risk Lab — the statistics and
   numerics. This is what earns a computational-science or statistics reader's
   attention.
2. *Product layer (supporting evidence of engineering breadth):* the interactive
   analytics suite. Mention it as proof you can ship a usable, tested product,
   but do not let it become the story — breadth there can dilute the research
   narrative.

**Show, don't tell.** Put three generated figures on the page: (a) the
barrier-resolution convergence, (b) the Monte Carlo O(N^-1/2) fit, (c) plug-in vs
uncertainty-integrated risk. Each has a one-line caption stating the finding.

**Make reproducibility visible.** A short "reproduce every result" command block
and the test suite (131 Python tests, plus the JavaScript checks run by
`npm test`) signal scientific-software maturity more than any adjective. A test
count says the code does what it was written to do, not that the model fits
real play.

**Tailor the one-liner to the program** (see §5–§6). Same project, different
emphasis: numerics/HPC for Harvard CSE; inference/uncertainty for Stanford
Statistics.

---

## 1. 25-word version (résumé header / site tagline)

> A reproducible Python framework quantifying when finite-horizon risk estimates
> can be trusted — under parameter uncertainty, heavy tails, dependence, and
> numerical resolution — using bankroll ruin as the case study.

---

## 2. Two résumé bullets

- Built a reproducible computational-statistics framework (Python, NumPy/SciPy,
  131 Python tests, config-driven experiments) that quantifies how
  finite-horizon **risk-of-ruin** estimates degrade under **parameter
  uncertainty, model misspecification, and discrete barrier monitoring**; in
  the reference scenario, propagating win-rate uncertainty raised modeled ruin
  risk from **27.3%** (plug-in) to **36.5%**, and a counterexample shows the
  direction depends on the posterior.
- Checked the baseline Monte Carlo simulator against **analytical (Brownian
  first-passage)** and **Markov-chain** benchmarks; ran a convergence study of
  Monte Carlo error against path count; implemented a **Brownian-bridge**
  barrier correction that brings 100-hand-step estimates onto the continuous
  benchmark (7.12% against 7.17%, from 6.76% uncorrected, over 40 seeds); and
  showed that **serial dependence raised ruin risk ×2.9** against an
  independent Gaussian baseline with the same edge and the same spread per
  step.

---

## 3. 100-word portfolio description

Bankroll Risk Lab is a reproducible computational-statistics framework that asks
a single question: when does a simulated risk estimate deserve to be trusted? Using
cash-game bankroll ruin as a concrete stochastic system with an absorbing
boundary, it estimates finite-horizon risk by Monte Carlo and studies how that
estimate changes with parameter uncertainty (Bayesian posterior propagation),
the model, and numerical resolution (discrete vs continuous barrier monitoring,
with a Brownian-bridge correction). The baseline simulator was checked against
analytical and Markov-chain benchmarks. Separate experiments examined
sensitivity to heavy tails, shocks, regime switching, and dependence. Every
result is reproducible from a fixed seed, and the code is covered by 131 Python
unit and statistical tests.

---

## 4. Core findings (only what the experiments produced)

- **Discretization bias is real and correctable.** Checking for ruin only at
  the end of each step misses paths that dip below the boundary and recover.
  At +3 bb/100 with 100-hand steps (40 seeds × 2,000 paths), endpoint-only
  monitoring gives 6.76% against an analytical 7.17%; the Brownian-bridge
  correction gives 7.12% (s.e. 0.08 points), at negligible cost. The tests
  check the corrected engine against the continuous benchmark at 100-, 500- and
  2,000-hand steps.
- **Parameter uncertainty changed the risk estimate.** With an observed
  1.86 bb/100 edge over 50k hands, the win rate's 95% CI still includes zero and
  P(edge > 0) ≈ 67%. In the reference scenario, propagating win-rate
  uncertainty increased modeled ruin risk from 27.3% to 36.5%, and puts the
  probability that true risk exceeds 25% at ≈55%. The direction and size of
  this difference depend on the posterior and model settings: for a posterior
  centred on a losing edge, N(−3, 2²) bb/100, averaging lowers risk from 66.2%
  to 63.8%. The stability check found no change in the reference history's win
  rate, so the interval was not widened.
- **Dependence, not marginal tails, is the dangerous misspecification.** At the
  same +3 bb/100 edge (30 buy-ins, 90 bb/100, 100k hands), AR(1) dependence
  with the same spread per step raised ruin risk ×2.87, because the total
  spread over many steps is wider. Regime switching raised it ×1.65, but its
  steps are also wider (SD about 101 instead of 90), so it does not hold the
  variance fixed. Heavy tails and shocks at the same spread per step were
  roughly neutral (×0.91 and ×1.04). An earlier quick run in a different
  scenario gave ×1.44 (AR(1)) and ×1.20 (regimes); those are not this
  scenario's results.
- **Method agreement is not correctness.** All analytical benchmarks share the
  Normal-increment assumption, so they can be jointly wrong; the value of the
  cross-checks is bounding *numerical* error, not validating the *model*.

---

## 5. Harvard CSE framing (computational science & engineering)

This project is a study in **computational modeling of a stochastic system with
an absorbing boundary** and the numerical questions that come with it. It builds
a vectorized, chunked Monte Carlo engine that scales to large path counts under a
bounded memory budget, and it treats simulation as a numerical method to be
*validated*, not trusted: the baseline simulator is cross-checked against a closed-form
Brownian first-passage solution and a sparse absorbing **Markov-chain**
discretization with reported truncation diagnostics. Central computational
contributions include an empirical **convergence-rate study** (fitted O(N^-1/2)
slope with a standard error, not an assumed exponent), a **barrier-crossing
algorithm** (Brownian-bridge correction) that quantifies and removes
discrete-monitoring bias, an explicit **accuracy–runtime trade-off** analysis,
and a reproducible experiment harness with seed-splitting (`SeedSequence`),
configuration files, and provenance capture. The emphasis throughout is the
engineering discipline that makes large-scale simulation trustworthy and
repeatable.

---

## 6. Stanford Statistics / Data Science framing

This project foregrounds the distinction between **sampling uncertainty,
parameter uncertainty, and model uncertainty**. It separates the volatility of
outcomes (which does not shrink with data) from the **standard error of the
estimated edge** (which does), estimates that edge from block-level history with
intervals widened when a stability check finds the win rate changing over time,
and then places a Normal prior on the true win rate to form a conjugate
posterior. The key statistical result is
**posterior predictive risk**: in the reference scenario, integrating win-rate
uncertainty through the ruin-risk function raised modeled risk from 27.3%
(plug-in) to 36.5%, made quantitative with credible intervals and
threshold-exceedance probabilities. Because risk is not convex in the win rate
everywhere, the direction and size of that difference depend on the posterior
and model settings. It also evaluates **confidence-interval calibration** (empirical
coverage across repeated experiments) and **model misspecification** (heavy-tailed,
regime-switching, and dependent alternatives with the same long-run edge and,
except regime switching, the same spread per step). The recurring theme is the limits of point estimates and the value of
honest, simulation-based uncertainty quantification. *(Framed as an independent
project; no thesis is implied.)*

---

## 7. Statement-of-purpose paragraph (one difficulty, one result)

One problem forced me to take numerical validation seriously. My Monte Carlo
engine detects ruin only at discrete step boundaries, while the closed-form
benchmark I was checking against assumes the barrier is monitored continuously —
so the two disagreed, and it was not obvious whether my simulation was wrong or
the comparison was ill-posed. Rather than tune the numbers until they matched, I
formalized the two quantities as answers to different questions, then implemented
a Brownian-bridge correction that estimates the probability a path crossed the
barrier *between* observations. The corrected estimator now agrees with the
analytical benchmark within simulation error at every step size the tests
check, while the uncorrected one stays below it. That experience — turning a confusing disagreement into
a precise statement about what each method measures — is what I want to do more
of: build models whose reliability I can actually characterize before anyone bets
a decision on them.

---

## 8. Detailed portfolio project page (ready to paste)

### Bankroll Risk Lab
**Uncertainty-aware simulation and validation of stochastic ruin models**

**The question.** Risk models are everywhere, but a single number ("your risk of
ruin is 7%") hides how much that number depends on assumptions you can't verify.
This project asks, concretely: how reliable is a finite-horizon risk estimate when
the stochastic model, the estimated edge, the barrier-monitoring frequency, and
the simulation budget are all imperfect?

**The system.** The concrete case study is a cash-game poker bankroll — a random
walk with positive drift and an absorbing "broke" boundary — but the machinery
applies to any absorbing-boundary process (capital depletion, insurance reserves,
reliability thresholds). A vectorized Monte Carlo engine estimates the
probability of hitting the boundary within a fixed horizon.

**What I built (four strands).**
- *Numerical validation.* Cross-checked the baseline simulator against a closed-form
  Brownian first-passage probability and a sparse absorbing Markov chain;
  measured Monte Carlo convergence (fitted O(N^-1/2) rate), confidence-interval
  coverage, and the accuracy–runtime trade-off; added a sequential stopping rule.
- *Barrier-crossing correction.* Showed discrete monitoring underestimates ruin
  and implemented a Brownian-bridge correction that recovers the continuous
  benchmark within simulation error at the step sizes tested.
- *Statistical inference.* Estimated the edge and its standard error from history
  (separating volatility from standard error), then propagated parameter
  uncertainty through a Bayesian posterior into the risk estimate — measuring
  how the risk estimate changes when that uncertainty is included.
- *Model risk.* Stress-tested the Gaussian assumption against heavy-tailed,
  shock, regime-switching, and dependent alternatives with the same long-run
  edge (and, except regime switching, the same spread per step).

**Selected results.** *(§11 gives each number's source)* At 100-hand steps,
endpoint-only monitoring 6.76%, bridge-corrected 7.12%, analytical 7.17%;
plug-in vs uncertainty-integrated ruin risk 27.3% → 36.5% in the reference
scenario (the direction depends on the posterior); serial dependence with the
same spread per step raises ruin ×2.87 in the case-study scenario.

**Engineering.** Python, NumPy/SciPy/pandas, Matplotlib; 131 Python unit and
statistical tests and JavaScript checks; configuration-driven experiments with fixed seeds and
provenance capture; an interactive Streamlit product layer and a standalone
in-browser tool.

**Honest limitations.** Results are conditional model estimates. The base model
assumes i.i.d. Normal increments and a stationary edge — assumptions real data
violate — which is precisely why the project measures the consequences of
violating them rather than asserting a single risk number.

**Links.** `docs/methodology.md` (formal model) · `reports/` (figures, tables,
provenance) · `configs/` (reproduce every experiment) · GitHub (tests + CI).

---

## 9. Reusable prompt to generate a portfolio web page

Paste this into your site builder / an assistant to draft the page:

> Create a single-project portfolio page for a graduate application in
> computational science / statistics. Project name: "Bankroll Risk Lab —
> Uncertainty-Aware Simulation and Validation of Stochastic Ruin Models." Open
> with the research question ("how reliable is a finite-horizon risk estimate
> when the model, data, and numerics are imperfect?"), then one sentence that the
> case study is cash-game bankroll ruin, an absorbing-boundary stochastic system.
> Include four short sections — Numerical validation, Barrier-crossing
> correction, Bayesian parameter uncertainty, Model-risk stress test — each 2–3
> sentences, method-first. Embed three figures with captions: (1) ruin estimate
> vs monitoring step size showing endpoint-only bias and the bridge correction;
> (2) Monte Carlo standard deviation vs sample size on log-log axes with a fitted
> slope near −0.5; (3) plug-in vs uncertainty-integrated ruin risk. Add a
> "Reproduce" code block and note the test suite (131 Python tests and the
> JavaScript checks). Tone: precise, quantitative,
> no marketing adjectives ("revolutionary", "state-of-the-art"); state one honest
> limitation. Keep the poker framing secondary to the statistics and numerics. Do
> not invent numbers — leave clearly marked placeholders for any figure I have
> not provided.

---

## 10. Do / don't checklist

**Do:** lead with the question; show generated figures with one-line findings;
quote numbers straight from `reports/`; state limitations; keep two layers
(research headline, product support); give exact reproduce commands.

**Don't:** call it a "poker AI" or "GTO solver" as the headline (that undersells
the statistics and invites the wrong questions); quote decimals you haven't
regenerated at high precision; imply the Stanford MS includes a thesis; use
"institutional-grade / guaranteed / revolutionary"; claim any alternative model
is the true data-generating process; present a scenario's result (such as
uncertainty raising risk) as a general rule.

---

## 11. Where each number comes from

Quote a number only with its source. "Current" files carry the commit they were
made from (their `provenance` block or `.provenance.json`), and checks and
tests are rerun by `npm test` and `pytest`.

| Number | File | Settings | Made from |
|---|---|---|---|
| Plug-in 27.3% → integrated 36.5% (×1.34), observed edge 1.86 bb/100, P(edge > 0) 66.8%, P(risk > 25%) 55.2%, stability check not flagged | `reports/tables/uncertainty_risk_demo.json` | synthetic history of 50 blocks of 1,000 hands (true +3 bb/100, SD 100, seed 1); 2,000 bb, 100k hands (`configs/uncertainty_risk.yaml`) | current (see its `.provenance.json`) |
| Plug-in 66.2% → integrated 63.8% (risk can fall) | `tests/test_bayes.py` | posterior N(−3, 2²) bb/100, 90 bb/100, 3,000 bb, 100k hands; quadrature and 20,000 draws | pytest |
| At 100-hand steps: endpoint-only 6.76%, bridge-corrected 7.12% (s.e. 0.08 points), analytical 7.17% | `checks/calculation-change-2026-10-21/results.json` | +3 bb/100, 90 bb/100, 3,000 bb, 100k hands, seeds 0–39 × 2,000 paths | current, checked in CI |
| Bridge on the continuous benchmark at 100-, 500- and 2,000-hand steps | `tests/test_bridge.py` | +2 bb/100, 90 bb/100, 1,500 bb, 100k hands, 40,000 paths, within 4 standard errors | pytest |
| AR(1) ×2.87, regimes ×1.65 (step SD ≈101), Student-t ×0.91, shocks ×1.04 | `reports/case-study/assumptions.json` | +3 bb/100, 90 bb/100, 3,000 bb, 100k hands, 40,000 paths each | current (d38b4ac) |

**Research records, not quoted above.** These were made on 2026-07-13/14 with
reduced settings and no commit recorded; regenerate them with the
high-precision configs before quoting their values.

| Number | File | Settings |
|---|---|---|
| AR(1) ×1.44, regimes ×1.20 | `reports/tables/model_risk_quick.csv` | +2 bb/100, 1,500 bb, quick run |
| Endpoint bias 8.2% at 500 hands; bridge within simulation error, at most 1.1% | `reports/tables/barrier_resolution_quick.csv` | +1 bb/100, 800 bb, 50k hands, 12,000 paths (62% ruin) |
| Convergence slope −0.55 (regression SE 0.03) | `reports/tables/mc_convergence_quick.csv` | `configs/mc_quick.yaml`: 5 budgets × 10 seeds, 30k hands |

The slope's ± 0.03 is the regression's own standard error over five points; it
leaves out the noise in each point, a standard deviation estimated from only 10
runs, so the real uncertainty is wider. The high-precision config
(`configs/monte_carlo_convergence.yaml`: 7 budgets × 40 seeds) gives a firmer
number.
