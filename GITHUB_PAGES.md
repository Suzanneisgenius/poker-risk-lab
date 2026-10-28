# Static dashboard on GitHub Pages

The research dashboard and case-study pages can be hosted statically. The full
Equity, EV, bankroll and CFR application still requires the private Node server;
follow [SECURE_DEPLOY.md](SECURE_DEPLOY.md) for that application.

## Build the publication artifact

```sh
npm run build
npm test
npm run check:calc-change
npm run build:pages
```

Only `outputs/github-pages/` is suitable for Pages. It contains exactly:

- `index.html` (entry redirect)
- `dashboard/index.html` (self-contained dashboard and aggregate saved results)
- `case-study/index.html`
- `case-study/validation.html`
- `Chart.js-LICENSE.md`
- `.nojekyll`

The packager uses an allowlist and rejects unexpected files. It does not copy
server/Python code, engines, session files, environment files, development briefs,
or the full application. Case-study navigation is adjusted in the artifact to
return to the dashboard instead of linking to an unavailable Node application.
The original app and case-study pages remain available on the Node server.

## Deploy without making the repository public

GitHub Pages support for a private repository depends on the account plan and
permissions. Do not change repository visibility to work around a restriction.
The selected published presentation files are accessible to site visitors;
the rest of the private repository is not part of the artifact.

If eligible, enable **Settings → Pages → Source: GitHub Actions**, then run the
manual **Dashboard preview** workflow on `main`. It rebuilds, tests, packages
only the six files, and uses `actions/deploy-pages`. The workflow's environment
output supplies the actual URL. Verify the page, filters and links there before
claiming deployment. Future pushes do not automatically redeploy this manual
preview; rerun the workflow after CI passes.

If Pages is unavailable, the standalone `dashboard/index.html` still opens from
disk and `/dashboard/` is served by the existing Node app. An unconfigured Pages
URL, an uploaded commit, or a successful local preview is not a public deployment.

Official documentation:
[GitHub Pages and supported plans](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages),
[creating a Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).
