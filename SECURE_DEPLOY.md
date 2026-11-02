# Secure public deployment

The GitHub repository is public, including the calculation engine source.
Render serves the full application at a public HTTPS link. Calculations execute
on the Node server; the browser bundle contains the interface and chart code.
Server-side execution is an architecture choice, not source-code secrecy.

## Architecture

- `index.html`: public interface and chart rendering only.
- `server/app.js`: same-origin Node HTTP server, security headers, input limits,
  body-size limit, in-memory rate limiting, and API routing.
- `server/compute.js` plus `standalone/engines/`: server-side Equity, EV, bankroll,
  and CFR implementations.
- `server/worker.js`: runs CPU-heavy calculations away from the HTTP event loop.
- `render.yaml`: reproducible Render web-service configuration.

## One-time deployment

1. Use the existing public repository
   `Suzanneisgenius/poker-risk-lab`, branch `main`. Do not create a new
   repository, reinitialize Git, or change its visibility.
2. In Render, choose **New → Blueprint**, connect that GitHub repository, and
   review the root-level `render.yaml`. The Blueprint creates the web service
   `poker-analytics-suite`. If an older service set up by hand also deploys
   this repository (as the earlier Python/Streamlit service did), suspend it
   once the new one passes the deploy check, so a push does not build both.
   Build minutes are shared across the workspace.
3. The service must be a **Node Web Service**, not a Static Site:

   | Setting | Value |
   | --- | --- |
   | Branch | `main` |
   | Root directory | repository root (leave blank) |
   | Build | `npm run build && npm test` |
   | Start | `npm start` |
   | Health check | `/api/health` |
   | Auto-deploy | after the pushed commit's GitHub checks pass (`autoDeployTrigger: checksPass`) |
   | Node | `22` |
   | Environment | `CALC_WORKERS=2`, `TRUST_PROXY_HOPS=1` |

   Let Render provide `PORT`; the server already binds to `0.0.0.0`. No API
   keys, separate frontend host, or database are required for the application.
4. Wait for Render to mark the deploy Live, then use the **actual URL shown by
   Render**. A successful GitHub push or CI run alone is not a deployment.

## Verify the deployed application

Run the deploy check from your own machine, with the commit you pushed:

```bash
npm run check:deploy -- https://<your-app>.onrender.com --commit "$(git rev-parse HEAD)" --heavy
```

It waits up to 150 s for a sleeping service to start, then checks:

- `/api/health` returns
  `{"ok":true,"service":"poker-analytics-api","commit":"<sha>"}` with the
  commit you pushed. Render sets `RENDER_GIT_COMMIT`; locally `commit` is
  `null`.
- The four pages are served with their security headers, and Plotly is loaded
  with its integrity hash.
- Each calculation answers a small request, including Bankroll Risk with the
  priors from real hands. Calculations from another site are refused.
- With `--heavy`: how long the largest Risk Lab and Bankroll runs the page
  offers take, against their route timeouts (see below).

A run with `--heavy` uses about 70 of the 100 rate-limit points an address gets
per minute, so wait a minute before running it again.

Then check by hand what the script cannot:

- `/` opens the original Risk Lab with its full interface. Save A, change one
  assumption and check that B recalculates and the comparison updates.
- In Bankroll Risk, change the historical sample size and run the calculation.
- In Hand Equity, try `TT+, AQs+, AKo`, then send the equity to Pot Odds & EV.
- Open `/case-study/` and `/case-study/validation.html`; `/dashboard/` is an
  optional saved-results overview, not the main application.
- Repeat the main route on a narrow screen and check the browser console.

The service is at <https://poker-analytics-suite.onrender.com/>. Its first
deploy (commit `3fcb028`) passed every check on 2026-11-01. Run the check again
after each deploy; until it passes, describe a release as pushed, not verified.

## Free-service expectations

The current Blueprint selects the Free instance. Render says an idle free web
service sleeps after 15 minutes; restarting on the next visit takes about a
minute and Render shows its own loading page. The original design and calculation
features remain available after startup, but local speed does not establish the
performance of Render's shared resources. Check a detailed simulation on the
actual service before sharing it as a portfolio demo.

Saved A/B comparisons are stored in the visitor's browser, not on Render's
filesystem. Export JSON for a portable copy. A paid instance can avoid idle
spin-down, but changing the plan is a separate decision; this setup does not
subscribe to one.

References: [Render web services](https://render.com/docs/web-services),
[Blueprint configuration](https://render.com/docs/blueprint-spec),
[free-instance limits](https://render.com/docs/free).

When connecting GitHub for automatic deployments, limit Render access to the
repository it needs. The public app serves pages and API responses; the engine
source is separately available in the public GitHub repository.

### Speed on the Free instance

The Free instance has 0.1 CPU (Starter 0.5, Standard 1). Measured on the
deployed service with `--heavy` on 2026-11-01:

- **Everyday requests** answer in 0.5–0.8 s, most of it network time.
- **Risk Lab, detailed run at the longest horizon** (16,000 paths × 300,000
  hands, 61.5 million path-steps): 21.8 s of its 55 s timeout.
- **Bankroll, 98 million path-steps** (20,000 paths × 400,000 hands): 31.1 s
  of its 45 s timeout. That is about 0.32 s per million path-steps, 11 times
  slower than one local core. Two such runs at once share the CPU, so both
  would time out.
- **Memory:** six near-ceiling runs at once peaked at 111 MB locally, well
  under the 512 MB limit.

The work ceiling is therefore 64 million path-steps: `MAX_PATH_STEPS` in
`server/compute.js`, mirrored by `BK_MAX_PATH_STEPS` in
`standalone/build/app.js`. `server/test_unit.js` checks that the two match and
that the detailed Risk Lab run fits. The largest bankroll run takes about 20 s.
At long horizons the page lowers the number of paths so the run fits: at most
16,800 paths at 300,000 hands, 11,500 at 400,000 and 3,300 at 1,000,000.

If runs still come close to their timeouts:

- A Starter instance (0.5 CPU) makes them about five times faster, and the
  ceiling could go back up. Change `plan` in `render.yaml`, not only in the
  dashboard: the Blueprint syncs that file. Changing the plan is a separate
  decision.
- `CALC_WORKERS=1` runs one calculation at a time, so a second heavy run does
  not slow the first. It waits instead, and can reach the page's 60–70 s
  timeout.

## Repository rename

The source repository is now `Suzanneisgenius/poker-risk-lab`. Existing clones
can update their remote without changing history:

```bash
git remote set-url origin https://github.com/Suzanneisgenius/poker-risk-lab.git
```

When creating or reconnecting the Render service, select this repository and
`main`. The Render service name can remain `poker-analytics-suite`; a repository
rename does not itself create, rename or verify a deployed service. Use the
actual URL displayed by Render after deployment.

## Updating later

```bash
npm run build
npm test
# Review and stage only the intended release files.
git diff --stat
git add <reviewed-files>
git commit -m "Update poker analytics suite"
git push origin main
```

Render rebuilds and deploys the linked branch once the pushed commit's GitHub
checks pass. Then run the deploy check again with the new commit.

## Local verification

```bash
npm run build
npm test
npm start
```

Then open `http://127.0.0.1:4174/`. The application deliberately does not work
as a standalone `file://` page because calculations require the Node API.

## Rate limiting and client IPs

Each client gets 100 points per minute. A request costs points in proportion
to the work it does (hand evaluations, bankroll path-steps, CFR iterations), so
a large Monte Carlo run uses up the budget faster than a quick EV check.

Clients are identified by `X-Forwarded-For`, but only the rightmost
`TRUST_PROXY_HOPS` entries are trusted, because everything to their left is
whatever the visitor sent. `render.yaml` sets `TRUST_PROXY_HOPS=1`. Confirm it
once after the first deploy:

1. In Render, add the environment variable `LOG_CLIENT_IP=1` and redeploy.
2. Send a request with a forged header:

   ```bash
   curl -s -X POST https://<your-app>.onrender.com/api/ev \
     -H 'Content-Type: application/json' -H 'X-Forwarded-For: 198.51.100.7' \
     -d '{"pot":10,"call":5,"equityPct":40}'
   ```

3. In the Render logs, the `rate-limit key=` line must show your real public
   IP, not `198.51.100.7` and not a Render-internal address. If it shows an
   internal address, set `TRUST_PROXY_HOPS=2`; if it shows the forged value,
   the proxy is not appending and the setting must be reviewed.
4. Remove `LOG_CLIENT_IP`.

Locally, leave `TRUST_PROXY_HOPS` unset so the header is ignored.

## Protection boundary

The server serves an explicit list of pages and API routes, not arbitrary files
from the checkout. This reduces accidental exposure of runtime files, but the
engine source is already public on GitHub. Never commit credentials or personal
records. Retain the request limits, and consider managed rate limiting or
authentication if traffic becomes substantial.
