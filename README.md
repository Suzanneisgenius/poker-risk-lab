# Bankroll Risk Lab
### Uncertainty-Aware Simulation and Validation of Stochastic Ruin Models

**Research question:** *How reliable are finite-horizon ruin-risk estimates when
the stochastic model, the estimated edge, the barrier-monitoring frequency, and
the simulation budget are all imperfect?*

A reproducible computational-statistics framework for estimating finite-horizon
ruin risk under **parameter uncertainty, model misspecification, and discrete
barrier monitoring**. Poker bankroll management is the concrete case study; the
methods apply to any stochastic process with an absorbing lower boundary —
capital depletion, insurance reserves, inventory exhaustion, reliability
thresholds. The current experiments are calibrated to bankroll processes; the
software architecture is extensible, and we do not overclaim domain generality.

The intellectual contribution is framed generally as *uncertainty-aware risk
estimation for stochastic systems with absorbing boundaries*, demonstrated
through four strands: (1) mathematical modeling, (2) statistical inference under
parameter uncertainty, (3) numerical/computational validation, and
(4) reproducible scientific software. See [`docs/methodology.md`](docs/methodology.md).

> Research and educational tool. Results depend on simplified model assumptions
> and are **not** financial or gambling advice.

---

*The section below documents the original decision-support tool, which remains
the product layer over the research engine.*

## Poker Bankroll Risk Simulator (product layer)

---

## Product questions this supports

- How likely am I to reach the ruin threshold under my current bankroll and edge?
- How much drawdown should I realistically prepare for (P75 / P90 / P95 / P99)?
- How sensitive is bankroll survival to uncertainty in my win rate?
- How different are mean outcomes from median outcomes on a skewed distribution?
- When does the finite-horizon estimate diverge from the classic infinite-horizon
  gambler's-ruin formula, and why?

This models **cash-game bankroll variance only** — not tournaments or ICM.

---

## Methodology

**Bankroll process.** The bankroll is measured in big blinds (bb) and evolves in
discrete steps of `step_hands` hands. Each step applies an i.i.d. Normal increment:

```
increment ~ Normal(mean = winrate_bb100 * step_hands / 100,
                    std  = std_bb100 * sqrt(step_hands / 100))
```

**Absorbing ruin.** A path is ruined the first time its bankroll is `<=`
`ruin_threshold_bb`. Ruin is absorbing: the path is clipped to the threshold for
all subsequent steps and can never recover. Terminal bankroll is defined
consistently for survivors and ruined paths.

**Monte Carlo estimation.** The engine is fully vectorized (`np.random.default_rng`,
no per-path Python loops, optional path-chunking with a memory guard). Risk of ruin
is the fraction of ruined paths, with a path-level **bootstrap** confidence interval
(or a fast **Wilson** binomial interval for large path counts).

**Drawdown.** Maximum drawdown is measured from each path's prior running peak on the
absorbed path; percentage drawdown uses a safe denominator. Ruined paths are never
silently treated as recovered.

---

## Validation

Three methods are reported side by side because they answer *slightly different
questions*:

| Method | Question it answers |
|---|---|
| **Monte Carlo, finite horizon** | Simulated ruin rate over exactly `n_hands`. |
| **Brownian, finite horizon** | First-passage probability of hitting the barrier by time `T = n_hands`. Most directly comparable to Monte Carlo. |
| **Brownian, infinite horizon** | Classic gambler's ruin `exp(-2 mu b / sigma^2)`; assumes unbounded time, so tends to 1 for zero/negative drift. |
| **Markov chain, finite step** | Absorption probability on a discretized bankroll grid, iterated for the same number of steps. |

Differences are expected. The infinite-horizon estimate is an **upper bound** on the
finite-horizon result and is *not* a validation failure when it comes out higher.
Consistency is judged with neutral language ("consistent within simulation
uncertainty", "directionally consistent", or "difference likely reflects
finite-horizon or discretization assumptions"). Actual numbers appear only after
running `scripts/run_validation.py` — none are hard-coded here.

Unit conventions (per hand): `mu = winrate_bb100 / 100`,
`sigma^2 = std_bb100^2 / 100`, `b = bankroll_bb - ruin_threshold_bb`, `T = n_hands`.

---

## Assumptions and limitations

- Results are i.i.d.; the model ignores autocorrelation and session dependence.
- The win rate is stationary — it ignores learning, fatigue, tilt, opponent
  adaptation, and game selection.
- The Normal increment may understate heavy tails.
- The estimated win rate itself carries sampling uncertainty (see the optional
  win-rate-uncertainty extension).
- Rake and changing game quality can make assumptions optimistic.
- Deposits, withdrawals, bet sizing, and moving between stakes are excluded unless
  explicitly modeled.
- This is cash-game variance, not tournament ICM.
- Outputs are conditional **model estimates**, not guarantees.

---

## Reproducibility

Every result is a deterministic function of the parameters and the seed:

```bash
python scripts/run_validation.py \
  --winrate 3.0 --std 90 --bankroll 3000 \
  --hands 100000 --paths 50000 --seed 42
```

## Poker Analytics Suite (private compute API)

The public page is a no-install interface backed by a private Node calculation
service. Visitors can inspect the normal HTML/CSS/UI JavaScript that their
browser receives, but the Equity evaluator, EV formulas, bankroll Monte Carlo,
and CFR implementation remain in the private server repository and are never
included in the public bundle. See [SECURE_DEPLOY.md](SECURE_DEPLOY.md) for the
deployment flow.

The suite provides four cross-validated tools behind one dark UI:

- **Hand Equity** — expected pot share against up to five fixed or random
  opponent hands and an optional board. Heads-up spots use exact enumeration
  when the runout is small; multiway spots use seeded Monte Carlo.
- **Pot Odds & EV** — turns the latest card-derived equity into a call/fold
  decision with EV in big blinds; manual equity remains an advanced option.
- **Bankroll Risk** — the Monte Carlo risk-of-ruin engine with a finite-horizon
  Brownian reference line.
- **GTO Trainer** — CFR on Kuhn poker, with a live convergence curve to the known
  game value (−1/18) and the equilibrium strategy table.

The private compute engines live in `standalone/engines/` and `server/compute.js`.
The server adds strict input limits, same-origin API enforcement, a bounded worker
queue, request-size limits, and in-memory rate limiting. Run all JavaScript checks with:

```bash
npm test
```

After editing the public shell or UI code, rebuild the public copies without
embedding the engines:

```bash
npm run build
```

This validates the evaluator/equity against published matchups (AA vs KK 82.6%,
72o vs AA 12%, MC ≈ exact) and CFR against the Kuhn equilibrium (value −1/18,
K bets 3× as often as J, Q checks first, K always calls).

## Two ways to use the bankroll tool

**A. Public web suite (no install).** Start it locally with `npm start`, or deploy
the private repository to Render. The server returns only result and chart data;
the public page cannot work correctly when opened directly as a `file://` URL or
deployed to static-only GitHub Pages. Internet is also used to load Plotly.

**B. Streamlit app (full engine).** Adds the Markov-chain validation, scenario
comparison, and file export on top of the exact Python engine that the tests
verify.

## Run the Streamlit app

```bash
pip install -r requirements.txt
streamlit run app.py
```

Expensive simulations run only when you click **Run simulation**; changing inputs
afterwards shows a "results are stale" banner until the next run. Results are
cached by their exact parameter tuple, so repeated runs are instant and
reproducible. Tabs: **Overview** (executive summary, six KPIs, path fan chart,
drawdown and terminal distributions, plain-language interpretation),
**Sensitivity** (risk-of-ruin curve with an x-axis toggle, win-rate uncertainty
sweep, required-bankroll solver, 2-D risk heatmap), **Scenario Comparison** (save
up to three scenarios), **Validation** (the four-method comparison table), and
**Methodology** (assumptions plus JSON / CSV / Markdown export).

Display units switch between buy-ins and big blinds; set the big-blind size to
show dollars. All amounts read in poker-player terms (buy-ins, bb/100) while the
engine works in big blinds internally.

## Testing

```bash
pip install -r requirements.txt
pytest
```

## Project structure

```
poker-bankroll-risk/
├── app.py              # Streamlit decision-support app (5 tabs)
├── .streamlit/config.toml   # dark quantitative theme
├── src/
│   ├── simulation.py   # vectorized Monte Carlo engine + SimulationConfig
│   ├── analytics.py    # risk of ruin, drawdown, growth, time-to-ruin
│   ├── validation.py   # Brownian (finite/infinite) + Markov cross-checks
│   ├── scenarios.py    # labelled illustrative presets
│   ├── sensitivity.py  # parameter sweeps + required-bankroll solver
│   ├── recommendations.py   # neutral risk classification + drivers
│   ├── plotting.py     # Plotly figures (dark theme)
│   └── formatting.py   # bb / buy-in / dollar formatting
├── scripts/
│   └── run_validation.py
├── tests/              # pytest: simulation, analytics, validation,
│                       #         sensitivity, edge cases (60 tests)
├── requirements.txt
└── pyproject.toml
```

Modules keep simulation, analytics, validation, plotting, and interpretation fully
separate — no plotting or global RNG inside the analytical functions. The app is a
thin, cached UI layer over these primitives.
