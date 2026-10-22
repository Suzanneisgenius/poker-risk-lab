# Functional repair and acceptance — 2026-10-05

> **Later change (2026-10-22):** the UI logic check moved to `standalone/test_ui_logic.js` and was rewritten when the Trainer switched to short practice sets with frequency questions and a review. The results below describe the 2026-10-05 version.

## Trainer repairs

- Restore the active Trainer after asynchronous range loading finishes. A failed load disables the controls and offers Retry.
- Show only the actions available in the selected scenario. First-in scenarios show Raise and Fold; defensive scenarios can show Call or Jam.
- Add a Training scenario selector and improve button spacing and scroll offsets.
- Reveal frequencies after an answer. Require an answer before Next hand.
- Count each hand class once per session, retain its answer when reviewing it, and advance to an unanswered class. Restart after all 169 classes.
- Label the score as accepted choices against demonstration frequencies. It is not a measure of real-game skill.
- Restore the correct status when switching among Library, Compare and Trainer. Add keyboard mode navigation and ignore stale scenario/comparison responses.

## Other functional repairs

- Match the equity input maximum to the API limit of 150,000 trials.
- Preserve Seed 0 in Equity and the optional CFR demo.
- Abort superseded equity requests and invalidate cached equity when cards or opponents change. Disable transfer of stale equity and mark the old EV result.
- Clear only Equity cards; preserve the independently selected Preflop cards.
- Label a deterministic multiway showdown as exact. The adapter label changed; the calculation engine did not.
- Show measured CFR reference checks without an unconditional success claim.
- Handle hash navigation, including the legacy #gto link.
- Cancel stale bankroll requests on edits. Mark and dim previous results during updates or invalid inputs; reject empty fields and invalid thresholds.

## Checks actually executed

| Check | Result |
|---|---|
| `npm run build` and JavaScript syntax check | Passed |
| `node standalone/engines/test_engines.js` | Passed: equity examples, evaluator ordering, MC/exact comparison, multiway shares, CFR benchmarks |
| `node server/test_api.js` | Passed: API, cache, rate limit, headers, validation and public bundle |
| `npm run test:ui` | Passed: actual frontend state functions, all 169 classes in all 5 scenarios, answer gating, reveal, duplicate scoring, restart, unavailable actions, load race, stale response, retry, mode status and Seed 0 |
| HTML integrity | 186 unique IDs; all three generated entries are byte-identical |
| Baseline integrity | 39 of 40 files unchanged; only `server/compute.js` differs, for the deterministic result label |

The UI state test uses a minimal DOM harness with the real frontend functions and the real demonstration dataset. Browser checks separately cover click targets, layout, card selection and chart rendering.

## Browser checks actually performed

Codex in-app browser, CSS viewports 1281 × 900 and 390 × 844:

- Trainer: clicks, keyboard Enter, answer/Next, review without recounting, first-in Raise/Fold, BB Call and SB Jam, scenario reset, visible feedback and progress.
- Library and Compare: two-card picker, duplicate card blocked, automatic second picker, AKs class mapping, A/B differences and sign reversal after Swap.
- Optional CFR: 10,000 iterations with Seed 0; learning curve, action table and measured reference checks.
- Equity: all three examples; 150,000 trials with Seed 0; up to five opponents and removal; empty-hand error; five community cards and exact 100% tie; transfer to EV.
- EV: card and manual equity, dirty-card invalidation, missing-card error, 45% equity / 10 bb pot / 5 bb call = +1.75 bb, +11.7 pp margin; test 20% = −2.00 bb while current EV stays +1.75 bb; reset, invalid call error and 50% / 10 / 10 break-even.
- Bankroll: presets, volatility choice, Seed 0, blank and threshold errors, previous-result disclosure, successful rerun, path and risk-curve rendering.
- Risk Lab: presets, four sliders, 16,000-path run, A/B save, replace, adjust and clear, fixed research disclosures.
- About, main navigation, hash changes, legacy #gto mapping and Preflop keyboard mode navigation.

No console warning/error was recorded during these checks. Stable document widths were 1272 and 381 CSS px, within the tested viewports. Plotly briefly retained wider chart dimensions in immediate resize snapshots, then resized without document overflow.

## Delivery boundaries

This is a local verified package. The Render deployment and GitHub repository were not updated. Run it with Node 20 or later using `npm start`; opening the HTML directly, or hosting only the HTML on GitHub Pages, does not provide the private calculation API. Plotly charts currently require its CDN to load.

The core engines, Python analysis, research configurations and saved research results were preserved. No fresh Python analysis/refit was run. The browser checks do not cover every input combination, other browsers, physical devices or a screen reader. Preflop ranges remain demonstration data, not solver-verified strategy.

Machine-readable evidence: `verification.json`. Screenshots here were captured in this revision; the sibling `decision-views-2026-10-05` directory is retained evidence from earlier work.
