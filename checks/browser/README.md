# Browser smoke checks

These checks exercise the built application in a fresh Chromium context. They
cover picker focus trapping/restoration, the posterior-interval label, visible
Preflop demo-data labels, chart font redraw on light/dark changes, and horizontal
overflow at an actual viewport of 375 CSS pixels. The report names each checked
chart. Trace/fill recoloring has separate unit coverage in `npm run test:ui`.
This is not a full accessibility audit, a real-phone test or numerical validation.

## Run from the repository root

Use Node 22 (the CI major version). Browser tooling is optional and isolated from
the dependency-free application:

```sh
npm run build
npm --prefix checks/browser ci
npm --prefix checks/browser exec -- playwright install chromium
node checks/browser/run.js
```

On Linux, install Chromium system dependencies if required:
`npm --prefix checks/browser exec -- playwright install --with-deps chromium`.
The page loads Plotly from its existing CDN, so the check needs internet access.
It fails if the browser, server, CDN or an assertion is unavailable; it does not
silently skip checks. Choose a free local port with `BROWSER_CHECK_PORT=4199` if
4198 is occupied. The script starts and stops its own server and browser.

`outputs/browser-check/` contains screenshots and `browser-check.json`. Override
that location with `BROWSER_CHECK_OUTPUT`. The JSON records the Git revision,
whether the checkout was dirty, Node/Playwright/Chromium and OS versions, actual
requested CSS viewports, timestamps, assertions and errors. A failure exits with
nonzero status. The output directory is ignored by Git; retain it with a handoff
if evidence is needed. Run against a clean, rebuilt checkout for a release record.

This script was added after the c377cf8 handoff. It is a new reproducible smoke
check, not the missing generator of that handoff's historical browser-check.json.
It runs separately from `npm test` and is not currently a CI job.
