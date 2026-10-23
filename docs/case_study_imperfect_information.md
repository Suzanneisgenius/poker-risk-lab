# Case Study — Poker, Risk & Imperfect Information

*Part of the Bankroll Risk Lab portfolio. This case study connects what I have
built and validated (the risk / Monte Carlo / uncertainty side of poker) to the
research direction I am moving toward next (strategic decision-making under
imperfect information via CFR and state abstraction).*

> **Attribution.** The imperfect-information / CFR direction below is informed by
> Steven Gong's open-source **[Gongsta/Poker-AI](https://github.com/Gongsta/Poker-AI)**
> (MIT License), which I use as a **learning reference** for card/bet abstraction,
> K-Means bucketing, and full-scale CFR. I do not reproduce that project's code,
> figures, or benchmark results, and I do not present its training outcomes as my
> own. In that repository the full No-Limit Hold'em CFR agent ("Strategy 4") is
> explicitly a **work in progress**; I describe it as such. Any code or idea I
> later adapt from it will retain the MIT License and an explicit
> *"Inspired by Gongsta/Poker-AI"* note.

---

## 1. Problem

Poker is really two problems wearing one costume. The first is **risk under
variance**: even a skilled, long-run-winning player can go broke over a finite
horizon because results are noisy — a random walk with a small positive drift and
an absorbing "broke" boundary. The second is **strategic decision-making under
imperfect information**: unlike chess, you never see the opponent's cards, so the
right play is a *mixed* strategy (bluffing, balancing) rather than a single best
move. Reinforcement-learning approaches that work on perfect-information games
fail here — a deterministic policy is trivially exploitable — which is why the
game-theoretic tool of choice is **Counterfactual Regret Minimization (CFR)**,
which converges to a Nash equilibrium in two-player zero-sum games.

My work so far rigorously addresses the **first** problem and takes a validated
**toy-scale** step into the second. This case study is honest about where the
line between "done and validated" and "next stage" falls.

## 2. Method

**Risk side (built and validated).** A vectorized Monte Carlo engine simulates
bankroll trajectories with an absorbing ruin barrier and estimates finite-horizon
risk of ruin, drawdown, and growth. I do not trust a single simulated number: I
cross-check it against a closed-form Brownian first-passage probability and a
sparse absorbing Markov chain, study its Monte Carlo convergence, correct its
discrete-monitoring bias with a Brownian-bridge crossing model, and propagate
**parameter uncertainty** in the win rate through a Bayesian posterior into the
risk estimate.

**Imperfect-information side (toy-scale, validated; full-scale, next).** I
implemented **vanilla CFR on Kuhn poker** (a 3-card game) from scratch and
verified it converges to the known equilibrium. The path from there to real
Hold'em is exactly what Gongsta/Poker-AI documents and what I am studying next:
**game abstraction** — bucketing hands by equity distribution with **K-Means**
(information abstraction) and sizing bets relative to the pot (action
abstraction) — then solving the reduced game with CFR to produce a blueprint
strategy, and translating that strategy back to the full game in real time.

## 3. Validation results (my own, reproducible from seed 42)

- **Risk of ruin** for the canonical scenario (3 bb/100 edge, 90 bb/100 std,
  30-buy-in bankroll, 100k hands): **7.2%** [95% CI 6.6%–7.7%], and four
  independent methods agree — Monte Carlo **0.072**, Brownian finite-horizon
  **0.072**, gambler's-ruin infinite-horizon **0.108** (an upper bound), Markov
  chain **0.068**.
- **Numerical honesty:** coarse barrier monitoring understates ruin by **8.2%**
  at a 500-hand step; the Brownian-bridge estimate agrees with the analytical
  value within simulation error at every step (relative error at most **1.1%**).
  Monte Carlo error follows the expected rate (fitted log-log slope **−0.55 ≈
  O(N⁻¹ᐟ²)**). Both come from earlier quick runs (12,000 paths; 10 seeds per
  budget) in their own scenarios; regenerate them before quoting decimals.
- **Uncertainty matters:** with an observed 1.86 bb/100 edge over 50k hands, the
  win rate's confidence interval still includes zero (P(edge > 0) ≈ **67%**);
  propagating that uncertainty raises modeled ruin risk from **27.3%** (plug-in)
  to **36.5%** (**×1.34**).
- **Model risk:** at the same +3 bb/100 edge (30 buy-ins, 90 bb/100, 100k
  hands, ruin observed at 100-hand checkpoints; `reports/case-study/assumptions.json`),
  swings that carry over between steps raise ruin risk — AR(1) **×2.87**, with the
  same spread per step but a wider total. Regime switching gives **×1.65**, but its
  steps are also wider (SD about 101 instead of 90), so it does not hold the
  variance fixed. Heavy tails and shocks at the same spread per step are roughly
  neutral. (An earlier quick run in a different scenario gave ×1.44 and ×1.20.)
- **Toy CFR:** my Kuhn-poker CFR converges to the known game value **−1/18 ≈
  −0.0556** and reproduces the equilibrium's qualitative structure (the best hand
  bets three times as often as the worst as a bluff; the middle hand checks first;
  the best hand always calls).

*(Suggested figures to embed here — all self-generated: the bankroll-path fan
with the ruin boundary; the risk-of-ruin-vs-bankroll curve with its confidence
band; the plug-in-vs-uncertainty-integrated risk chart; and a small set of
"model assumption" cards, below.)*

### Model-assumption cards (my model, stated plainly)

- **i.i.d. increments** — results are independent across hands; violated by
  streaks and session effects (which the AR(1)/regime experiments show inflate
  risk).
- **Stationary edge** — the win rate is constant; violated by learning, tilt,
  and game selection.
- **Normal increments** — light-tailed; may understate extreme swings.
- **Absorbing, fixed ruin threshold** — no reloads or moving down in stakes.
- **Cash-game variance only** — not tournament ICM.

Every card is a place where the headline number could be wrong; the project's
point is to *measure* those sensitivities rather than hide them.

## 4. Limitations

- The risk model's outputs are **conditional model estimates**, not guarantees;
  its assumptions (i.i.d., stationary, Normal) are simplifications the project
  deliberately stress-tests rather than defends.
- My CFR work is **toy-scale** (Kuhn poker). I have **not** built a full No-Limit
  Hold'em solver, and I do not claim one. Full-scale CFR is a research-scale
  computation: the game has on the order of 10¹⁶¹ decision states, which is why
  abstraction is mandatory and why even dedicated open-source efforts (including
  Gongsta/Poker-AI) keep full-game CFR in a work-in-progress state.
- Poker's high variance makes head-to-head bot benchmarking noisy; any future
  evaluation would need tens of thousands of hands and careful variance
  reduction, and I would report it with intervals, not point claims.

## 5. Next steps

- Extend the validated CFR from Kuhn to **Leduc poker** (a two-round game with a
  public card), tracking **exploitability → 0** as the honest convergence metric.
- Implement **equity-distribution card abstraction with K-Means** and pot-relative
  **bet abstraction**, using Gongsta/Poker-AI as a learning reference for the
  engineering, and measure how abstraction granularity trades off strategy
  quality against tractability.
- Connect the two halves of the project: use abstraction-based **equity** and
  **exploitability** estimates as inputs to the same uncertainty-aware risk
  framework, so a strategy's edge is fed into ruin analysis *with* its estimation
  error rather than as a fixed number.

---

### License & credit

This portfolio project is my own work and is released under the MIT License. The
imperfect-information research direction credits **Gongsta/Poker-AI (MIT License)**
as an inspiration and learning reference. If I adapt any of its code, I will
include its license text and an explicit *"Inspired by / adapted from
Gongsta/Poker-AI"* attribution, and I will not present its results, figures, or
trained models as my own.
