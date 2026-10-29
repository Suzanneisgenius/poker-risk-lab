# Deployment status — 2026-10-29

The repository is now public. The full Node application and the static Research
overview are built and checked locally. No live URL has been verified in this
release; a successful push or CI run does not establish a deployment.

Use `SECURE_DEPLOY.md` for the full application on Render, and `GITHUB_PAGES.md`
for the optional seven-file static overview. The static artifact excludes server
engines and session files, but the engine source can be read in the public
repository. Do not assume that packaging files selectively hides Git history.

## Earlier attempt — 2026-10-28

At that time the repository was private. The read-only Pages query returned 404,
and automatic approval review stopped an attempt to enable Pages before it
executed. That record describes the earlier attempt, not current visibility.

Local preview: run `npm start`, then open `http://localhost:4174/` for the full
application or `/dashboard/` for the saved-results overview.
