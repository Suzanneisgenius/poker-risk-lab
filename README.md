# Poker Risk Lab: Understanding Uncertainty in Simulation

**How much should we trust a simulated risk estimate?**

A computational statistics project investigating numerical error, uncertain win
rates, and assumptions about how returns evolve. Poker bankrolls provide the
case study; a Python research engine and an interactive web app make the
experiments reproducible and explorable.

[Research write-up](docs/case_study_imperfect_information.md) ·
[Validation records](checks/README.md) ·
[Run the app](#run-locally) ·
[Reproduce the research](#reproduce-and-check)

![Three views of uncertainty in one bankroll scenario: simulation noise, uncertainty in the win rate, and sensitivity to model assumptions.](reports/case-study/overview.png)

*Reference setting: 30 buy-ins, a +3 bb/100 win rate, volatility of 90 bb/100,
and 100,000 future hands. The figure compares a repeated-simulation range, a
posterior interval, and a range across stress-test models. These have different
meanings; their widths do not establish a general ranking of uncertainty.*

## A result that needed investigation

With seed 42, an engine update moved the risk estimate from **7.85% to 6.35%**
for the same inputs.
Two things had changed together: the random-number streams and the detection
of ruin between 100-hand checkpoints. I separated them to investigate what
caused the difference.

Checking only the bankroll at each checkpoint can miss a path that crosses
the ruin threshold and recovers before the next check. A Brownian-bridge
correction accounts for these crossings under the baseline model. Across
40 seeds, with 2,000 paths per seed, the paired comparison gave:

| Method | Estimated ruin risk |
|---|---:|
| Check only at 100-hand endpoints | 6.76% |
| Include the Brownian-bridge correction | 7.12% |
| Analytical finite-horizon Brownian benchmark | 7.17% |

The standard error of the mean bridge estimate across the 40 seeds was
**0.08 percentage points**. The correction raised risk in every paired run.
A lower result after an engine update therefore needed to be separated from
the effect of changing the random sample.

Settings: 3,000 bb (30 buy-ins of 100 bb), +3 bb/100, volatility 90 bb/100,
100,000 future hands, and a ruin threshold of 0 bb.
[Script, settings and saved results](checks/calculation-change-2026-10-21/README.md).

## What the experiments show

- **More simulation paths reduce Monte Carlo error.** They cannot resolve
  uncertainty about the player's true win rate or whether the model fits the data.
- **An estimated win rate changes the risk question.** The project propagates a
  posterior for the win rate through the risk calculation. The effect on average
  risk can be positive or negative, depending on the posterior and model settings.
- **Assumptions about returns matter.** Heavy tails, shocks, serial dependence
  and changing regimes are tested separately. These are controlled stress tests;
  they do not establish how real poker results behave.

The [interactive case study](case-study/index.html) presents these questions
with adjustable examples. Open it directly as a static file, or visit
`/case-study/` on the running app. The [methodology](docs/methodology.md)
documents the models and their limitations.

## Authorship and AI assistance

My work focused on evaluating the reliability of simulated bankroll-risk
estimates. I investigated threshold crossings missed by 100-hand checkpoints,
incorporated a Brownian-bridge correction, and compared the estimates with an
analytical finite-horizon first-passage benchmark. When an engine update changed
results for the same inputs and seed, I separated the effects of changes to
random-number generation from those of the correction. Across 40 seeds with
2,000 paths per seed, I examined Monte Carlo variation and systematic changes
in how ruin was detected.

I also investigated win-rate uncertainty and alternative assumptions about
bankroll returns. My validation work included Markov-chain absorption
calculations and comparisons between the Python research engine and the web
implementation. I documented settings, seeds, versions, and limitations to make
these comparisons reproducible. These experiments helped me distinguish what
additional simulation can resolve—sampling error—from questions that require
further investigation of the estimated inputs and model assumptions.

AI tools assisted with reviewing code and tests and checking calculations.

## Explore the app

| Tool | What you can investigate |
|---|---|
| **Risk Lab** | Compare scenarios, inspect simulated paths, and save or export A/B comparisons with their settings, seeds and engine versions. |
| **Bankroll Risk** | Enter hands and net win rate, or import session results. Examine win-rate uncertainty, risk intervals, required bankroll under a stated posterior criterion, and sensitivity to the assumptions. |
| **Hand Equity** | Compare a hand with fixed cards, random opponents, or a weighted heads-up range; account for known cards and inspect the breakdown. |
| **Pot Odds & EV** | Use the equity from Hand Equity to examine the EV of calling at a given pot and call size. |

Risk Lab is the default view. Preflop and About are secondary tabs; Preflop
includes illustrative range practice and an optional Kuhn poker CFR demo.

Two routes connect inputs, results and interpretation:

- **From your results:** load an example or your session data in Bankroll Risk,
  then change one assumption and compare the required bankroll.
- **From an opponent's range:** calculate equity in Hand Equity, pass it into
  Pot Odds & EV, then change the range or the price of calling.

The **What changed** panel in Bankroll Risk and Pot Odds & EV compares the
result shown before editing with the new calculation. It lists changed inputs,
shows before-and-after values, and explains their effect within the model.
When several assumptions change together, it avoids attributing the difference
to a single cause.

## Run locally

From the repository root, with **Node.js 20 or later**:

```bash
npm run build
npm start
```

Open <http://localhost:4174> for the app, `/case-study/` for the research story,
and `/case-study/validation.html` for the validation page. The web suite needs
the Node server; opening its main HTML file directly will not run the tools.
Plotly charts require an internet connection.

**Demo access:** local setup is documented here; no public demo URL is currently
listed. The full app requires a Node service; uploading `site/index.html` alone
to a static host does not provide its calculation API. See
[deployment instructions](SECURE_DEPLOY.md) for serving the app while keeping
the source repository private.

The case study and Validation page can be read offline or hosted as static
pages. If shared separately, their **Open the Risk Lab** link needs to point
to the deployed app. See [sharing options](site/DEPLOY.md).

## Reproduce and check

The Python research code requires **Python 3.11 or later**. In a virtual
environment, install the research dependencies and regenerate the case-study
results and pages:

```bash
python -m pip install -r requirements-research.txt
python -m src.experiments.case_study --case all
npm run build
```

Configurations are in [`configs/case_study/`](configs/case_study/); outputs and
provenance are in [`reports/case-study/`](reports/case-study/). The older
`reports/figures/` outputs predate the bridge correction and are not the current
case-study results.

Run the automated checks:

```bash
npm test
npm run check:calc-change
python -m pytest
```

CI checks the web build and JavaScript tests on Node 22, and Python tests on
Python 3.11 and 3.12. Python comparisons check the web calculations against the
research implementation; PokerKit provides separate checks of hand evaluation
and equity. PokerKit checks run separately and require their own dependencies;
commands and saved evidence are in the [checks index](checks/README.md).

Results are reproducible with the recorded inputs, seeds, code and dependency
versions. The saved-result checks (`--check`) require the JavaScript output to
match the saved file exactly; comparisons between the web and Python
implementations allow documented tolerances. Model agreement checks assess
numerical implementation, not whether a model predicts real games accurately.

The optional Python interface is available with `streamlit run app.py` after
installing the dependencies above.

## Scope and limitations

The baseline risk model assumes a constant win rate and independent Normal
increments; its analytical benchmark and bridge correction apply to that model.
Alternative return models are examined through separate experiments. The
posterior bankroll calculation conditions on the chosen volatility; estimating
volatility from sessions does not integrate all of its uncertainty into the
posterior risk calculation.

The examples and stress tests do not establish performance on real player
histories. Preflop frequencies are demonstration data, and Kuhn poker is a
simplified game. This project studies cash-game bankroll risk, not tournaments
or ICM. Outputs are conditional model estimates for research and education,
not guarantees or financial or gambling advice.
