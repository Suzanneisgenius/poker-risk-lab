# Secure public deployment

This deployment keeps the GitHub repository private while giving visitors a
normal public HTTPS link. The frontend remains inspectable—as every website's
downloaded interface must—but the calculation engines never leave the server.

## Architecture

- `index.html`: public interface and chart rendering only.
- `server/app.js`: same-origin Node HTTP server, security headers, input limits,
  body-size limit, in-memory rate limiting, and API routing.
- `server/compute.js` plus `standalone/engines/`: private Equity, EV, bankroll,
  and CFR implementations.
- `server/worker.js`: runs CPU-heavy calculations away from the HTTP event loop.
- `render.yaml`: reproducible Render web-service configuration.

## One-time deployment

1. On GitHub, create a new **Private** repository, for example
   `poker-analytics-private`. Do not add a README or license during creation.
2. From this project folder, push the private source:

   ```bash
   git init
   git add .
   git commit -m "Private server-backed poker analytics suite"
   git branch -M main
   git remote add origin https://github.com/<your-user>/poker-analytics-private.git
   git push -u origin main
   ```

3. In Render, choose **New → Blueprint**, connect GitHub, select the private
   repository, and apply the detected root-level `render.yaml`.
4. Wait for the build and tests to pass. Render then displays the public
   `https://...onrender.com` URL. Open `/api/health` on that domain to confirm it
   returns `{"ok":true,"service":"poker-analytics-api"}`.

Render should be granted access only to this private repository. Visitors receive
the public site and API results, not repository access.

## Updating later

```bash
npm run build
npm test
git add .
git commit -m "Update poker analytics suite"
git push
```

Render automatically rebuilds and deploys the linked branch.

## Local verification

```bash
npm run build
npm test
npm start
```

Then open `http://127.0.0.1:4174/`. The application deliberately does not work
as a standalone `file://` page because calculations require the private API.

## Protection boundary

This design prevents visitors from downloading the server implementation from
the public site. It does not make an internet-facing API impossible to probe or
reimplement from observed inputs and outputs. Keep the repository private,
retain the request limits, and move to managed rate limiting or authentication
if traffic becomes substantial.
