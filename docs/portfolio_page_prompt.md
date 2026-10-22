# Build Prompt — Interactive Portfolio Page: "Bankroll Risk Lab"

Hand this to a developer or an AI coding assistant. It specifies a single,
self-contained, double-click-to-open HTML page that presents the project as a
**computational-statistics study** with two signature interactions: a **live
bankroll simulation hero** and a **headline risk number that visibly moves** as
each source of error is taken seriously.

---

## 0. One-sentence goal

Build one self-contained `bankroll-risk-lab.html` (opens by double-click; only
external dependency is the Plotly CDN) that reframes the project around the
research question, runs a **real client-side Monte Carlo** in the hero so a
reviewer can drag sliders and watch risk update, and uses **scroll** to move a
single headline risk number as barrier resolution, Monte Carlo error, parameter
uncertainty, and model misspecification are each introduced.

## 1. Audience and intent

The reader is a graduate-admissions reviewer in computational science
(Harvard CSE) or statistics / data science (Stanford). They spend ~60 seconds.
The page must, in that time, read as *rigorous quantitative research with a
memorable interactive proof*, not a poker product. Character and interactivity
are the differentiator — but every distinctive element must also *be the
argument*, never mere decoration.

## 2. Framing rules (non-negotiable)

- Section eyebrow: `01 / COMPUTATIONAL STATISTICS`. Title: **Bankroll Risk Lab**.
  Italic subtitle: *Poker bankroll as a case study in absorbing-boundary risk*.
- Hero question, large, accent color:
  *"How reliable is a risk estimate when the model, the data, and the numerics
  are all imperfect?"*
- Poker is the case study, never the headline. Keep exactly **one** tasteful
  playing-card motif; the statistics are the star.
- Tags: `Python` · `NumPy` · `SciPy` · `Monte Carlo` · `Bayesian inference` ·
  `Numerical validation`.

## 3. Technical constraints (reuse the existing engine)

- **One HTML file**, no build step, no framework. Inline all CSS/JS. Plotly from
  `https://cdn.plot.ly/plotly-2.35.2.min.js` is the only external resource.
- **Reuse the project's JavaScript engine** (already written and unit-checked in
  `standalone/engines/` and `standalone/build/app.js`). Specifically inline and
  call:
  - `simBank(p, nPaths, storeN)` — vectorized bankroll Monte Carlo returning
    `{nRuined, terminal, maxdd, paths, ruinFlag, xs, ...}`.
  - `brownFinite(wr, sd, bank, thr, hands)` — analytical finite-horizon ruin.
  - `mulberry32` seeded RNG so every run is reproducible.
  Do **not** invent a new engine; port these so the page's numbers match the
  Python engine's model (same equations, seeded).
- No `localStorage`/backend. All state in memory. Must work opened from disk.

## 4. Signature interaction A — the live hero

A wide hero panel (dark, rounded) containing a **real** bankroll path fan driven
by the JS engine, plus a live risk readout.

- Controls (compact sliders, right or below): **Win rate** (−5…+10 bb/100),
  **Bankroll** (5…60 buy-ins), **Std dev** (60…160 bb/100), **Hands**
  (fixed 100k or a small selector). Default = the canonical scenario in §10.
- On any slider change (debounced ~120 ms): re-run `simBank` at a modest budget
  (e.g. 4,000 paths, store ~80 for drawing), redraw:
  - ~80 sampled paths, surviving in cyan, ruined in muted red;
  - a dashed **red ruin boundary** line (the one recurring dramatic element);
  - ruined paths visibly terminate at the boundary (dot marker where they hit);
  - a live readout box updating **RISK OF RUIN**, **SURVIVAL RATE**,
    **P95 DRAWDOWN**, **PATHS**.
- Show a subtle "simulating…" tick and the seed (`seed 42`) so it reads as real
  computation, not a video. Keep it smooth: cap paths for responsiveness, and
  offer a "high-precision run" button that bumps to ~40k paths once.
- Caption: *"Live Monte Carlo — drag a slider and the ruin probability
  recomputes in your browser."*

## 5. Signature interaction B — the headline number that moves

A single large number is pinned/anchored as the reader scrolls through four
"take it seriously" steps. It starts naive and **animates (count-up/down) to a
new value at each step**, with a one-line annotation of *why* it moved.

- Step 0 (naive): show a clean headline ruin figure for the canonical scenario.
- Step 1 — *Take barrier resolution seriously*: the number rises to reflect the
  discretization correction. Annotation: coarse endpoint monitoring understates
  ruin; the bridge correction restores it.
- Step 2 — *Take Monte Carlo error seriously*: attach the 95% CI to the number;
  annotate the O(N^-1/2) convergence.
- Step 3 — *Take parameter uncertainty seriously*: the number jumps from the
  plug-in value to the uncertainty-integrated value. Annotation: the edge is
  estimated, not known.
- Step 4 — *Take model misspecification seriously*: show the multiplier under
  dependence. Annotation: serial dependence, not fat tails, is the danger.
- Implementation: an `IntersectionObserver` per step triggers a numeric
  tween (e.g. requestAnimationFrame count animation). The moving number is the
  emotional spine of the page — one number, watched changing.

> **Honesty requirement for Step 1–4 (critical).** The four effects were
> originally measured on *different* calibrated scenarios, so do **not** chain
> them as if one scenario's number literally passes through all four values.
> Choose ONE of these truthful designs and state it on the page:
> (a) **Recompute** each effect on the single canonical hero scenario (preferred;
> the JS engine can do barrier + model-risk deltas live, Bayesian via the Python
> outputs), so the moving number is internally consistent; or
> (b) Keep each step's number but **label each with its own scenario** in small
> print, and frame the device as "four illustrations of the same lesson." Never
> present mixed-scenario numbers as one continuous quantity without a label.

## 6. The four research strands (cards, with real findings)

Two-by-two grid, each a titled card, eyebrow + serif title + 2–3 sentences. Use
the real numbers in §10. Titles:

1. **Barrier resolution & the Brownian-bridge correction** (Numerics)
2. **Monte Carlo convergence & coverage** (MC error)
3. **Bayesian propagation of parameter uncertainty** (Uncertainty)
4. **Model-misspecification stress tests** (Robustness)

Each card links to / embeds its generated figure from `reports/figures/`.

## 7. Cross-validation table

Four independent estimates of ruin probability for the canonical scenario, with
the neutral header *"Agreement bounds numerical error — it does not prove the
model is right."*

| Method | Ruin probability |
|---|---|
| Monte Carlo (2.0M paths, 95% CI) | 0.072 [0.066, 0.077] |
| Brownian first-passage — finite horizon | 0.072 |
| Gambler's ruin — infinite horizon | 0.108 |
| Markov chain — absorption | 0.068 |

## 8. Data-encoded cards (make them informational, not decorative)

The one card motif encodes three real headline results (not placeholders):
`A♠ → Risk of Ruin`, `K♦ → P95 Drawdown`, `Q♣ → Survival rate`, each showing the
real value from §10. Suit→metric mapping is intentional; label it once.

## 9. Aesthetic — "lab notebook", not "SaaS dashboard"

- Dark palette: bg `#0B1220`, surface `#131C2E`, grid `#243247`, accent cyan
  `#38BDF8`, ruin red `#F87171` (downside/boundary only), off-white text
  `#E6EDF3`, muted `#94A3B8`.
- Display serif for titles (e.g. a Georgia/Playfair-style face); **monospace**
  for eyebrows, numbers, and annotations to give a lab-log feel.
- A real terminal-style **"Reproduce"** block:
  `python -m src.experiments.barrier_resolution --config configs/barrier_resolution.yaml`
- A small provenance stamp: `seed 42 · reproducible · 108 tests passing`.
- Restraint: one accent, red only for ruin, generous spacing, no gradients that
  hurt contrast, no emoji, no casino imagery.

## 10. Real numbers to embed (ground truth from the seeded runs)

Canonical hero scenario: **win rate 3 bb/100, std 90 bb/100, bankroll 3,000 bb
(30 buy-ins), 100,000 hands, seed 42.**

- Risk of ruin: **7.2%**, 95% CI **[6.6%, 7.7%]**.
- Cross-validation: MC **0.072** · Brownian finite **0.072** · Brownian infinite
  **0.108** · Markov **0.068**.
- Barrier: endpoint monitoring understates ruin by **8.2%** at a 500-hand step;
  Brownian-bridge correction cuts the error to **< 1%**; endpoint → analytical as
  step → 1.
- Monte Carlo convergence: fitted log-log slope **−0.55 ± 0.03** (≈ O(N^-1/2)).
- Bayesian (edge 1.86 bb/100 over 50k hands; SE 3.98; 95% CI includes 0;
  P(edge > 0) ≈ **67%**): plug-in ruin **27.3%** → uncertainty-integrated
  **36.5%** (**×1.34**); P(true risk > 25%) ≈ **55%**.
- Model risk (same +3 bb/100 edge, 30 BI, 100k hands, ruin observed at 100-hand
  checkpoints; `reports/case-study/assumptions.json`): AR(1) dependence **×2.87**
  (same spread per step, wider total); regime switching **×1.65**, but with wider
  steps (SD ≈ 101 vs 90), so not variance-matched; heavy tails / shocks at the
  same spread per step ≈ neutral.

> Regenerate all of the above with the high-precision configs before publishing,
> and update any decimal that changes. Mark anything not yet regenerated as a
> clearly visible placeholder — **never render `NaN` or `—` on the live page.**

## 11. Honesty rules

- No fabricated numbers. Every figure traces to a `reports/` artifact.
- The moving-number device must satisfy the §5 honesty requirement.
- State one limitation prominently (i.i.d.-Normal, stationary edge are
  assumptions the project exists to stress-test).
- No "revolutionary / institutional-grade / guaranteed / state-of-the-art".
- Do not imply any alternative model is the true data-generating process. Do not
  imply the Stanford MS includes a thesis.

## 12. Accessibility & responsive

- Charts resize; KPI cards wrap; ≥ 4.5:1 text contrast; status never by color
  alone (label every series); sliders keyboard-operable; the moving number has a
  static fallback if animation is reduced (`prefers-reduced-motion`).

## 13. Acceptance criteria

1. Opens by double-click from disk; hero simulates without a server.
2. Dragging any hero slider visibly re-runs the simulation and updates the
   readout within ~200 ms.
3. Scrolling animates the headline number through the four steps with correct,
   honestly-sourced values and annotations.
4. Cross-validation table shows all four methods; four strands show real numbers.
5. No `NaN`/empty placeholders anywhere; provenance stamp and reproduce block
   present.
6. Reads as computational statistics in the first 10 seconds; poker is secondary.

## 14. What NOT to do

- Don't lead with "poker simulator / GTO / AI".
- Don't let the card motif dominate or drift toward casino styling.
- Don't animate for its own sake — every motion encodes a real result.
- Don't chain mixed-scenario numbers into one quantity without labels.
- Don't ship decimals you haven't regenerated at high precision.
