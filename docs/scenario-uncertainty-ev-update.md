# Scenario comparison, uncertainty case and EV sensitivity — 2026-10-05

## Changes

- Risk Lab can save the completed current simulation as A, retain it while B changes, replace A, clear the comparison, and open B's assumptions directly. Inputs, seeded path counts, separate Monte Carlo intervals, a point-estimate difference and stored-path median/50% bands appear together. Pending/error states retain the previous B with an explicit label; saving is disabled until the displayed result matches its inputs.
- The saved parameter-uncertainty experiment now has a focused comparison, a fitted Normal posterior density, the original 95% posterior interval for model risk, and expandable settings and reproduction instructions. The build reads the existing JSON/provenance files and embeds their hashes. It does not generate new research results.
- EV emphasizes the conditional call EV and the percentage-point equity margin over break-even. An equity slider explores the linear EV relationship at a fixed pot and call without changing the card calculation or the headline assumptions. Reset restores the current equity. The zero-EV case is explicitly break-even, and invalid inputs disable exploration while identifying the previous result.
- The EV pot definition includes the opponent's bet and excludes the pending call. Equity is described as expected pot share, including ties. Assumptions cover a fixed eligible pot, no future betting, rake or side pots; scenario exploration is not a confidence interval.
- EV decorations are clipped without creating an internally scrollable result card. Focusing the sensitivity slider no longer scrolls the main EV estimate out of the card, and the decorations do not widen the narrow document.
- Corrected the Risk Lab path-band description: the engine stores 80 example paths for graphical summaries, while risk and its Monte Carlo interval use the full simulation. The sensitivity curve displays its smaller simulation budget and only reuses a curve whose assumptions match the current detailed run.

## Reference ideas consulted

These are design/method references, not imported code or evidence validating this project's estimates.

- [OMPEval README](https://github.com/zekyll/OMPEval/blob/master/README.md): separates enumeration and Monte Carlo and exposes sampling precision/stopping criteria. Borrowed the principle of making method and simulation precision explicit. The underlying engine here remains unchanged.
- [Streamlit poker probability calculator](https://github.com/ajcaesar/poker_probabilities_calculator/blob/main/readme.txt): separates scenarios with known opponents from those with unknown opponents. Retained the selected card/manual context alongside the EV assumptions.
- [PokerNews odds calculator](https://www.pokernews.com/poker-tools/poker-odds-calculator.htm): links card scenarios with interpretable equity/pot-odds learning. Used the input–result–next comparison workflow as a reference.
- [PyMC predictive-check documentation](https://www.pymc.io/projects/docs/en/stable/learn/core_notebooks/posterior_predictive.html): uses distributions and uncertainty-aware plots. Borrowed the presentation principle; this case uses the existing Normal-Normal posterior and Brownian risk model, not a new PyMC implementation or a new posterior predictive check.

## Evidence boundaries

- The uncertainty case is synthetic: 50 blocks of 1,000 hands, generating win rate 3 and SD 100 bb/100, data seed 1. It uses a Normal prior with mean 0 and SD 10 bb/100, 20 buy-ins, a 100,000-hand risk horizon and 20,000 posterior draws at seed 0. Its saved result date is 2026-07-13 UTC.
- The saved plug-in risk is 0.2729433775 and integrated mean risk 0.3743235323; their difference is 10.1380 percentage points. The original 95% posterior interval for model risk is [0.0088054186, 0.9731281117]. This broad interval is shown rather than presenting the mean alone.
- This is a frontend/build revision. Existing scientific results, simulation algorithms and Python configurations are preserved. No fresh Python analysis or research replication is claimed. Render is not updated.
- A is an in-memory snapshot for the current page session; reloading clears it. Shared seeds do not establish independence of A/B runs. Separate Monte Carlo intervals are not an interval or a significance test for their difference.

## Verification

- `npm run build` and JavaScript syntax validation. Root, site and standalone generated HTML are identical; static element IDs are unique.
- 40 analysis, engine, configuration and saved-result files match the pre-edit hashes.
- Existing engine checks passed. The existing API suite passed after allowing its temporary localhost test server; sandbox binding alone initially failed. No full Python statistical suite was run.
- Narrow numerical checks: live A/B seeded risks 0.2775 and 0.0785 (difference −19.9 pp); EV at pot 10/call 5/equity 45% is +1.75 bb; equity 0%/100% endpoints are −5/+10 bb; pot 10/call 10/equity 50% is zero.
- Browser verification is recorded separately in the delivery check JSON and current screenshots, including actual viewport sizes, controls, plots, preserved saved-case values and visible error states.

## Editing and preview

Edit `standalone/build/shell.html`, `standalone/build/app.js` and the reviewed-data binding in `scripts/build_static_site.js`, then run `npm run build`. The generated root page is overwritten by builds.

Local preview: `HOST=127.0.0.1 PORT=4174 node server/app.js`. Open `http://127.0.0.1:4174/#risklab` or `#ev`. This package requires its Node API for live calculations.
