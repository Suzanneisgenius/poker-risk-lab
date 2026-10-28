# Sharing this project

`index.html` in this folder is a copy of the app's interface only. Equity, EV,
bankroll and CFR calculations run on the project's Node server
(`server/app.js`) and reach the page through `/api/...`. Opened from disk, or
put on a static host such as Netlify Drop, GitHub Pages or a shared drive, the
page loads but cannot calculate anything. The build writes this copy; it is not
a deployment on its own.

## Ways to share

The primary portfolio experience is the **full Node application on Render**,
with the original interface and live calculations. The saved-results dashboard
is an optional research overview.

- **The research dashboard, as a static preview.** `dashboard/index.html` works
  offline with saved scenarios. For GitHub Pages, use only the allowlisted
  artifact described in [`GITHUB_PAGES.md`](../GITHUB_PAGES.md). It is separate
  from the server-backed app and does not calculate new ranges or bankrolls.

- **The app, publicly.** Deploy the Node service as described in
  [`SECURE_DEPLOY.md`](../SECURE_DEPLOY.md) (configuration in `render.yaml`).
  On a free plan the service sleeps when idle, so the first visit after a pause
  can take a while to load.
- **The case study, as static pages.** `case-study/index.html` and
  `case-study/validation.html` are built from saved results and need no server
  and no network. They can be opened from disk or put on any static host. Their
  "Open the Risk Lab" link points to the app beside them (`../`), so it only
  works where the app is served too.
- **On your own machine.** `npm start`, then <http://localhost:4174>.

## What is inside the app

The first four tabs are the main routes; Preflop and About sit to the right as
secondary tabs.

- **Risk Lab**: bankroll simulation with a guided A/B comparison of one
  assumption, the cross-validation table and the research strands.
- **Bankroll Risk**: from your own results (totals, or a CSV of sessions): the
  win rate's interval and the bankroll needed, with an "Inspect assumptions"
  section. A second mode simulates an assumed win rate.
- **Hand Equity**: equity against fixed hands, random hands or one opponent's
  weighted range, with combos that use your cards or the board removed; sends
  the equity to Pot Odds & EV.
- **Pot Odds & EV**: the EV of a call from the equity, the pot and the call.
- **Preflop**: illustrative range matrices to browse, compare and practise, and
  an optional Kuhn poker CFR demo.
- **About**: what each tool does and its limits.

Two routes run end to end: *from your results* (Bankroll Risk) and *from an
opponent's range* (Hand Equity, then Pot Odds & EV). On both, a "What changed"
box compares a new result with the one shown before the edit and says why the
answer moved.

## Notes

- Charts load Plotly from a CDN, so they need an internet connection; the
  numbers do not.
- The server does not store calculation inputs.
- Research and educational tool, not financial or gambling advice.
