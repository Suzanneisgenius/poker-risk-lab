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
   `Suzanneisgenius/poker-analytics-private`, branch `main`. Do not create a new
   repository, reinitialize Git, or change its visibility.
2. In Render, choose **New → Blueprint**, connect that GitHub repository, and
   review the root-level `render.yaml`. If a Render service already serves this
   repository, update that service instead of creating a duplicate.
3. The service must be a **Node Web Service**, not a Static Site:

   | Setting | Value |
   | --- | --- |
   | Branch | `main` |
   | Root directory | repository root (leave blank) |
   | Build | `npm run build && npm test` |
   | Start | `npm start` |
   | Health check | `/api/health` |
   | Node | `22` |
   | Environment | `CALC_WORKERS=2`, `TRUST_PROXY_HOPS=1` |

   Let Render provide `PORT`; the server already binds to `0.0.0.0`. No API
   keys, separate frontend host, or database are required for the application.
4. Wait for Render to mark the deploy Live, then use the **actual URL shown by
   Render**. A successful GitHub push or CI run alone is not a deployment.

## Verify the deployed application

- `/api/health` returns `{"ok":true,"service":"poker-analytics-api"}`.
- `/` opens the original Risk Lab with its full interface. Save A, change one
  assumption and check that B recalculates and the comparison updates.
- In Bankroll Risk, change the historical sample size and run the calculation.
- In Hand Equity, try `TT+, AQs+, AKo`, then send the equity to Pot Odds & EV.
- Open `/case-study/` and `/case-study/validation.html`; `/dashboard/` is an
  optional saved-results overview, not the main application.
- Repeat the main route on a narrow screen and check the browser console.

Record the deployed commit and URL after these checks. Until then, describe the
release as prepared or pushed, not publicly verified.

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

Render automatically rebuilds and deploys the linked branch.

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
