# Methodology

*Bankroll Risk Lab — uncertainty-aware simulation and validation of stochastic
ruin models.*

This document defines the stochastic model, the estimands, and the assumptions.
Poker bankroll management is the **motivating case study**; the same machinery
applies to any stochastic process with an absorbing lower boundary (capital
depletion, insurance reserves, inventory exhaustion, reliability thresholds).
We do not claim the calibrated numbers transfer to those domains — only the
architecture does.

---

## 1. Baseline stochastic process

Bankroll is measured in big blinds (bb). Play advances in discrete steps; step
`k` represents `Δh_k` hands. The bankroll evolves as

$$
B_{k+1} = B_k + \mu\,\frac{\Delta h_k}{100} + \sigma\sqrt{\frac{\Delta h_k}{100}}\;Z_k,
\qquad Z_k \sim \mathcal{N}(0,1)\ \text{i.i.d.}
$$

- $B_0$ — initial bankroll (bb).
- $\mu$ — **true** win rate (bb/100).
- $\sigma$ — standard deviation of results (bb/100).
- $\Delta h_k$ — hands in step $k$ (usually a constant `step_hands`, with a
  possibly shorter final step).
- $b$ — ruin threshold (bb). **Ruin** occurs at the first $k$ with $B_k \le b$,
  and ruin is **absorbing**: the process is pinned at $b$ thereafter.

The per-step increment has mean $\mu\,\Delta h/100$ and variance
$\sigma^2\,\Delta h/100$, so over $H$ hands the drift is $\mu H/100$ and the
variance is $\sigma^2 H/100$ — the standard "per 100 hands" convention.

### Continuous-time limit

As `step_hands` $\to 0$, the process converges to a Brownian motion with drift
$\tilde\mu = \mu/100$ per hand and variance $\tilde\sigma^2 = \sigma^2/100$ per
hand. This limit underlies the analytical benchmarks below and is the reference
against which discrete monitoring is compared.

---

## 2. Quantities we must not conflate

A recurring source of error in "bankroll calculators" is collapsing distinct
quantities. We keep them explicitly separate.

| Symbol / term | Meaning |
|---|---|
| $\hat\mu$ | **Estimated** win rate from a finite sample of results. |
| $\mu$ | **Latent true** win rate (never observed directly). |
| Observed block returns $r_i$ | Realized profit over a block of hands. |
| Finite-horizon ruin | $P(\exists k \le K : B_k \le b)$ over a fixed horizon $H = \sum \Delta h_k$. |
| Infinite-horizon ruin | $P(\exists k < \infty : B_k \le b)$; the classic gambler's-ruin limit. |
| Discrete barrier monitoring | Ruin checked only at step boundaries (what Monte Carlo does). |
| Continuous barrier monitoring | Ruin if the barrier is crossed *at any instant* (what the Brownian first-passage formula assumes). |
| Conditional risk $P(\text{ruin}\mid \mu,\sigma,B_0,H)$ | Risk for a *fixed* parameter vector. |
| Uncertainty-integrated risk $P(\text{ruin}\mid D)$ | Risk after integrating parameter uncertainty against data $D$. |

The central research question of this project is what happens to a reported risk
number when the boundaries between these quantities are blurred — by using
$\hat\mu$ as if it were $\mu$ (plug-in bias), by using discrete monitoring as if
it were continuous (barrier-crossing bias), or by using a Gaussian increment as
if it were the true return law (model misspecification).

---

## 3. Analytical benchmarks

### 3.1 Infinite-horizon gambler's ruin

For drift $\tilde\mu > 0$ and effective bankroll $a = B_0 - b$, the classical
approximation is

$$
P_\infty(\text{ruin}) \approx \exp\!\left(-\frac{2\tilde\mu a}{\tilde\sigma^2}\right)
= \exp\!\left(-\frac{2\,\mu\,a}{\sigma^2}\right),
$$

where the per-100 units cancel. For $\tilde\mu \le 0$ the infinite-horizon ruin
probability tends to 1. This is an **upper bound** on any finite-horizon risk and
must not be treated as a validation failure when it exceeds the Monte Carlo
number.

### 3.2 Finite-horizon Brownian first passage

The most directly comparable analytical benchmark. For a Brownian motion started
at $a = B_0 - b$ above an absorbing barrier at 0, with drift $\tilde\mu$ and
volatility $\tilde\sigma$ over horizon $T = H$ hands, the probability of hitting
the barrier by $T$ is

$$
P_T(\text{ruin}) = \Phi\!\left(\frac{-a-\tilde\mu T}{\tilde\sigma\sqrt{T}}\right)
+ \exp\!\left(-\frac{2\tilde\mu a}{\tilde\sigma^2}\right)
\Phi\!\left(\frac{-a+\tilde\mu T}{\tilde\sigma\sqrt{T}}\right).
$$

This assumes **continuous** monitoring. It is computed in log-space for
numerical stability. As $T \to \infty$ it recovers §3.1 from below.

### 3.3 Markov-chain absorption

The bankroll is discretized into states from the ruin threshold (absorbing) up
to a cap. One-step transitions are Normal-increment bucket probabilities; the
distribution is iterated for the same number of steps as the horizon (a
**finite-step** quantity). The upper boundary is **not reflecting**: upper-tail
mass that would leave the grid is aggregated into the top state, a truncation
that is only harmless when little mass reaches the cap. The implementation
therefore returns `mass_at_cap`, a `truncation_warning`, the row-sum error, the
state count, and the grid spacing.

### Why the three benchmarks legitimately differ

They answer *different* questions: finite vs infinite horizon, discrete vs
continuous monitoring, exact vs discretized state space. Agreement within
simulation uncertainty is reassuring; disagreement is informative, not a bug.
Crucially, **agreement between methods does not imply correctness** — all three
share the Normal-increment assumption, so they can be jointly wrong under
misspecification (§6 studies exactly this).

---

## 4. Estimands and estimators

The primary estimand is the finite-horizon ruin probability
$p = P(\text{ruin}\mid \theta)$ for a parameter vector $\theta=(\mu,\sigma,B_0,b,H)$.

- **Point estimate.** Monte Carlo proportion $\hat p = R/N$, where $R$ is the
  number of ruined paths out of $N$.
- **Interval.** Because ruin is a Bernoulli outcome per path, the default
  interval is the **Wilson score interval**, which is well-behaved near 0 and 1
  and needs no resampling. A nonparametric bootstrap is available but is not the
  default: for a single proportion it only reproduces the Wilson/normal interval
  while costing $O(N_\text{boot}\times N)$ memory.
- **Standard error.** $\widehat{\mathrm{se}}(\hat p) = \sqrt{\hat p(1-\hat p)/N}$,
  giving the $O(N^{-1/2})$ Monte Carlo rate studied empirically in the
  convergence experiment.

---

## 5. Barrier monitoring (discrete vs continuous)

Monte Carlo checks ruin only at step endpoints. If two consecutive bankroll
values $x_0, x_1$ both sit above the barrier, the path may still have dipped
below it *between* observations — an intrastep crossing that endpoint monitoring
misses. Endpoint monitoring therefore **underestimates** ruin relative to
continuous monitoring, and the gap grows with `step_hands`.

For a Brownian bridge between $x_0$ and $x_1$ over an interval of variance
$s^2 = \tilde\sigma^2\,\Delta h$, conditional on both endpoints exceeding the
barrier at level 0, the probability of an intrastep crossing is

$$
P_\text{cross}(x_0, x_1) = \exp\!\left(-\frac{2\,x_0\,x_1}{s^2}\right).
$$

The bridge-corrected ruin indicator marks a path as ruined if any endpoint is at
or below the barrier **or** a Bernoulli($P_\text{cross}$) draw fires on any
above-barrier interval. The barrier-resolution experiment (§ experiments)
compares (i) endpoint-only monitoring, (ii) bridge-corrected monitoring, and
(iii) the analytical continuous first-passage probability, and reports whether
the discrete estimate converges to the continuous benchmark as `step_hands`
decreases. We do **not** assume convergence in advance; we report the observed
behavior.

*Reference:* the Brownian-bridge crossing probability is standard; see e.g.
Glasserman, *Monte Carlo Methods in Financial Engineering* (2004), §6.4, on
barrier-option discretization bias and bridge corrections.

---

## 6. Parameter uncertainty and Bayesian propagation

The observed win rate $\hat\mu$ is an estimate with sampling error, not the true
$\mu$. Treating $\hat\mu$ as known (a **plug-in** estimate) ignores this and can
materially understate risk, because ruin risk is convex and increasing as $\mu$
falls.

We place a Normal prior on the win rate, $\mu \sim \mathcal{N}(\mu_0, \tau_0^2)$,
and condition on observed block returns with (for the first version) a plug-in
volatility $\sigma$. With block-level likelihood variance, the Normal–Normal
conjugate posterior is again Normal, $\mu \mid D \sim \mathcal{N}(\mu_n,\tau_n^2)$,
with the standard precision-weighted updates. Posterior-integrated ruin risk is

$$
P(\text{ruin}\mid D) = \int P(\text{ruin}\mid \mu,\sigma,B_0,H)\,p(\mu\mid D)\,d\mu,
$$

approximated by drawing $\mu^{(j)} \sim p(\mu\mid D)$, computing the conditional
ruin risk for each draw, and aggregating. We report the plug-in risk, the
posterior-integrated expected risk, the posterior median risk, credible
intervals, and threshold-exceedance probabilities — always displaying the
plug-in and uncertainty-integrated numbers **side by side**.

---

## 7. Assumptions, and how violating each one biases risk

| Assumption | If violated… | Direction of bias in reported ruin risk |
|---|---|---|
| Independent increments | Streaks / session dependence exist | Understated (dependence fattens the loss tail and clusters drawdowns) |
| Stationary drift $\mu$ | Edge changes with form, games, adaptation | Either sign; a declining edge understates risk |
| Constant volatility $\sigma$ | Variance regime-switches | Usually understated (high-variance regimes dominate ruin) |
| Normal increments | Real returns are heavier-tailed | Understated (Gaussian thins the downside tail) |
| Fixed threshold $b$ | Player moves down / reloads | Overstated if the player de-risks; not modeled here |
| No deposits/withdrawals | Bankroll is topped up or skimmed | Either sign |
| No stake changes | Player moves up/down in stakes | Either sign; §policies studies this explicitly |
| No behavioral adaptation | Tilt, fatigue, game selection | Typically understated |

The project's experiments are built to *quantify* several of these biases rather
than assume them away: §5 (monitoring), §6 (parameter uncertainty), and the
model-risk stress tests (Gaussian vs Student-t / regime-switching / shock).

---

## 8. Reproducibility

Every result is a deterministic function of its configuration and seed. Randomness
uses `numpy.random.default_rng` / `SeedSequence` with principled seed splitting so
that chunked and (optionally) parallel execution give identical results
regardless of scheduling. Experiments are configuration-driven and runnable from
the command line, and record seeds, package versions, and parameters alongside
their outputs. No numerical finding is written into the documentation until the
corresponding experiment has actually produced it.
