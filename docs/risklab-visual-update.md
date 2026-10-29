# Risk Lab visual update — 2026-10-05

> Historical implementation note for the date above. Numerical values and UI
> descriptions record that revision, not the current release. Use the
> [current case study](../case-study/index.html), [methodology](methodology.md)
> and [validation records](../checks/README.md) for current results.

## Changes

- A single large current risk estimate now sits beside the bankroll-path chart at wide widths. At narrow widths, the estimate precedes the chart.
- The current estimate includes its Monte Carlo interval, committed assumptions and a brief interpretation. Survival and drawdown have lower visual priority.
- Three scenario presets remain visible. Swing presets, sliders and the 16,000-path run are in an expandable assumptions section.
- Changed inputs retain the previous result with an explicit updating label. An in-flight response is discarded when its inputs change.
- Fixed reference experiments occupy a separate section with a visible disclosure that its numbers do not respond to the live controls. The original method-comparison table and reproduction commands are available in expandable sections.
- The sensitivity chart uses a horizontal legend below its plotted data, including when loaded directly at a narrow width.
- The shared header is compact only while Risk Lab is active. Other tool pages keep their existing content and header presentation.

## Evidence boundary

This is a local presentation revision. The analytical engines and configurations were not edited. The four reference findings and fixed comparison table were preserved. No new Python research run or full scientific test suite is claimed. The Render deployment was not updated.

## Verification performed

- `npm run build` regenerated root `index.html`, `site/index.html` and `standalone/poker-analytics-suite.html` from `standalone/build/shell.html` and `standalone/build/app.js`.
- `node --check standalone/build/app.js` passed.
- A hash comparison confirmed 32 existing analysis/configuration files unchanged. HTML parsing confirmed unique element IDs; the three generated pages match. The content of the other main tool sections matches the saved baseline.
- Browser checks covered the default scenario, positive-edge preset, a keyboard slider change, keyboard collapse of the assumptions section, and the fixed method comparison.
- A 16,000-path detailed run completed, displayed 28.2% risk and returned to a non-busy state; restoring the default quick scenario displayed 27.8%. The header also returned to its original presentation when switching to Hand Equity. The browser log check returned no warning/error entries.
- The live scenario updated from 27.8% at 0 bb/100 to 7.8% at 3 bb/100 and 5.7% at 3.5 bb/100, while the fixed reference text remained unchanged. These are UI smoke checks of the unchanged seeded calculation service, not fresh research findings.
- Actual DOM viewport sizes of 1280 × 900 and 390 × 844 were inspected. Both showed the current result and plotted data without horizontal document overflow. The narrow sensitivity figure was checked after direct loading as well as resizing.

## Files to edit next

Edit `standalone/build/shell.html` for HTML/CSS and `standalone/build/app.js` for UI behavior, then run `npm run build`. Editing only the generated root HTML will be overwritten by the build.

For a local preview, run `npm start` and open `http://127.0.0.1:4174/#risklab`.
