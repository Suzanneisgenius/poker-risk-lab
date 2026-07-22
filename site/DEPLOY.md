# Share this page — 3 ways to let others play with it

This folder is a complete static website. `index.html` is fully interactive and
self-contained (its only external need is an internet connection to load the
Plotly charting library). Pick whichever is easiest.

## Option A — Netlify Drop (easiest, gives a public link in ~30 seconds, no account needed to try)

1. Go to **https://app.netlify.com/drop**
2. Drag this whole `site` folder onto the page.
3. You immediately get a public URL like `https://your-name.netlify.app` you can
   send to anyone. (Sign in to keep it permanent / rename it.)

## Option B — GitHub Pages (free, permanent, good if the project is on GitHub)

1. Push this repository to GitHub.
2. Repo → **Settings → Pages** → Source: `Deploy from a branch` → branch `main`,
   folder `/ (root)`.
3. Your site appears at `https://<username>.github.io/<repo>/`.

GitHub's branch-based Pages picker supports only `/ (root)` or `/docs`; it does
not publish an arbitrary `/site` folder directly.

## Option C — just send the file

`index.html` also works by **double-click** on any computer with a browser and
internet. You can email it or drop it in a shared drive; the recipient opens it
directly — no install, no server.

---

### What's inside

A single page, six tabs:

- **Risk Lab** — the research dashboard: a live in-browser Monte Carlo bankroll
  simulation (drag the sliders), cross-validation table, and four research
  strands with real results.
- **Hand Equity** — visual card picker; expected pot share against up to five fixed or random opponent hands.
- **Pot Odds & EV** — is a call worth it?
- **Bankroll Risk** — quick risk-of-ruin calculator.
- **GTO Trainer** — CFR converging on Kuhn poker.
- **About** — plain-language glossary and honest limitations.

### Notes

- Needs internet on first load (Plotly comes from a CDN). Everything else runs
  locally in the visitor's browser; no data leaves their machine.
- Numbers shown are from seeded reference runs of the companion Python engine.
- Research and educational tool — not financial or gambling advice.
