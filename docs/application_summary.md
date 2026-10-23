# Application & Portfolio Summary

*Project: **Bankroll Risk Lab — Uncertainty-Aware Simulation and Validation of
Stochastic Ruin Models**.*

> A note on numbers. Every figure below comes from a seeded experiment in this
> repository, and §11 lists the file, settings and commit each one comes from.
> Two of them (the 8% discretization bias and the −0.55 slope) are from earlier
> quick runs whose commit was not recorded; regenerate those with the
> high-precision configs (`configs/*.yaml`) before quoting exact values in a
> submitted document. Do not round in a way that overstates an effect.

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
and the test suite (130 Python tests, plus the JavaScript checks run by
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
  130 Python tests, config-driven experiments) that quantifies how
  finite-horizon **risk-of-ruin** estimates degrade under **parameter
  uncertainty, model misspecification, and discrete barrier monitoring**; showed
  Bayesian uncertainty propagation raises modeled risk **≈1.3×** over the naive
  plug-in estimate (27.3% → 36.5% in the reference case).
- Designed and validated Monte Carlo experiments against **analytical
  (Brownian first-passage)** and **Markov-chain** benchmarks: empirically
  confirmed the **O(N^-1/2)** convergence rate (fitted log-log slope
  **−0.55** in a quick run), implemented a **Brownian-bridge** barrier
  correction that removes an **≈8%** discretization bias at coarse resolution,
  and showed that **serial dependence raised ruin risk ×2.9** against an
  independent Gaussian baseline with the same edge and the same spread per
  step.

---

## 3. 100-word portfolio description

Bankroll Risk Lab is a reproducible computational-statistics framework that asks
a single question: when does a simulated risk estimate deserve to be trusted? Using
cash-game bankroll ruin as a concrete stochastic system with an absorbing
boundary, it estimates finite-horizon risk by Monte Carlo and stress-tests that
estimate from three directions — parameter uncertainty (Bayesian posterior
propagation), model misspecification (heavy tails, shocks, regime switching,
dependence), and numerical resolution (discrete vs continuous barrier monitoring,
with a Brownian-bridge correction). Every Monte Carlo result is cross-checked
against analytical and Markov-chain benchmarks, is reproducible from a fixed
seed, and is covered by 130 Python unit and statistical tests.

---

## 4. Core findings (only what the experiments produced)

- **Discretization bias is real and correctable.** Endpoint-only Monte Carlo
  converges to the continuous analytical benchmark as the monitoring step
  shrinks, but underestimates ruin by ≈8% at a 500-hand step (a quick run of
  12,000 paths in a high-risk scenario, 62% ruin); the Brownian-bridge estimate
  agrees with the benchmark within simulation error at every step from 1 to 500
  hands (relative error at most 1.1%), at negligible cost.
- **Plug-in estimates understate risk.** With an observed 1.86 bb/100 edge over
  50k hands, the win rate's 95% CI still includes zero and P(edge > 0) ≈ 67%;
  propagating that uncertainty raises modeled ruin risk from 27.3% (plug-in) to
  36.5% (integrated), and puts the probability that true risk exceeds 25% at
  ≈55%. The stability check found no change in that history's win rate, so
  the interval was not widened.
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
*validated*, not trusted: results are cross-checked against a closed-form
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
**posterior predictive risk**: integrating parameter uncertainty through a convex
ruin-risk function shows that a **plug-in estimator materially understates risk**,
a point made quantitative with credible intervals and threshold-exceedance
probabilities. It also evaluates **confidence-interval calibration** (empirical
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
barrier *between* observations. The corrected estimator agreed with the
analytical benchmark within simulation error at every step size from 1 to 500
hands, while the naive estimator underestimated ruin by roughly eight percent at
the coarsest resolution. That experience — turning a confusing disagreement into
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
- *Numerical validation.* Cross-checked the simulation against a closed-form
  Brownian first-passage probability and a sparse absorbing Markov chain;
  measured Monte Carlo convergence (fitted O(N^-1/2) rate), confidence-interval
  coverage, and the accuracy–runtime trade-off; added a sequential stopping rule.
- *Barrier-crossing correction.* Showed discrete monitoring underestimates ruin
  and implemented a Brownian-bridge correction that recovers the continuous
  benchmark.
- *Statistical inference.* Estimated the edge and its standard error from history
  (separating volatility from standard error), then propagated parameter
  uncertainty through a Bayesian posterior into the risk estimate — quantifying
  how much the naive plug-in understates risk.
- *Model risk.* Stress-tested the Gaussian assumption against heavy-tailed,
  shock, regime-switching, and dependent alternatives with the same long-run
  edge (and, except regime switching, the same spread per step).

**Selected results.** *(regenerate exact decimals from the high-precision
configs; §11 gives each number's source)* Discretization bias ≈8% at a
500-hand step, removed by the bridge correction; plug-in vs
uncertainty-integrated ruin risk 27.3% → 36.5%; serial dependence with the same
spread per step raises ruin ×2.87 in the case-study scenario.

**Engineering.** Python, NumPy/SciPy/pandas, Matplotlib; 130 Python unit and
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
> "Reproduce" code block and note the test suite (130 Python tests and the
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
is the true data-generating process.

---

## 11. Where each number comes from

Quote a number only with its source. "Current" files carry the commit they were
made from (their `provenance` block or `.provenance.json`); "earlier quick run"
files were made on 2026-07-13/14 with reduced settings and no commit recorded,
so regenerate them before quoting exact decimals.

| Number | File | Settings | Made from |
|---|---|---|---|
| Plug-in 27.3% → integrated 36.5% (×1.34), observed edge 1.86 bb/100, P(edge > 0) 66.8%, P(risk > 25%) 55.2%, stability check not flagged | `reports/tables/uncertainty_risk_demo.json` | synthetic history of 50 blocks of 1,000 hands (true +3 bb/100, SD 100, seed 1); 2,000 bb, 100k hands (`configs/uncertainty_risk.yaml`) | current (see its `.provenance.json`) |
| AR(1) ×2.87, regimes ×1.65 (step SD ≈101), Student-t ×0.91, shocks ×1.04 | `reports/case-study/assumptions.json` | +3 bb/100, 90 bb/100, 3,000 bb, 100k hands, 40,000 paths each | current (d38b4ac) |
| AR(1) ×1.44, regimes ×1.20 (historical) | `reports/tables/model_risk_quick.csv` | +2 bb/100, 1,500 bb, quick run | earlier quick run, 2026-07-14 |
| Endpoint bias 8.2% at 500 hands; bridge within simulation error, at most 1.1% | `reports/tables/barrier_resolution_quick.csv` | +1 bb/100, 800 bb, 50k hands, 12,000 paths (62% ruin) | earlier quick run, 2026-07-13 |
| Convergence slope −0.55 (regression SE 0.03) | `reports/tables/mc_convergence_quick.csv` | `configs/mc_quick.yaml`: 5 budgets × 10 seeds, 30k hands | earlier quick run, 2026-07-13 |

The slope's ± 0.03 is the regression's own standard error over five points; it
leaves out the noise in each point, a standard deviation estimated from only 10
runs, so the real uncertainty is wider. The high-precision config
(`configs/monte_carlo_convergence.yaml`: 7 budgets × 40 seeds) gives a firmer
number.
