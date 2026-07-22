# GitHub Pages is intentionally no longer the deployment target

GitHub Pages can host only static public files. It cannot execute the private
Equity, EV, Monte Carlo, or CFR service, and any algorithm shipped through Pages
can be downloaded by a visitor.

This version therefore uses a private GitHub repository plus a public Node web
service. The browser receives only the UI and chart-ready results. Follow
[SECURE_DEPLOY.md](SECURE_DEPLOY.md) instead of enabling Pages.

The root `index.html` remains the server's public entry point; `.nojekyll` is
harmless but is not used by the secure deployment.
