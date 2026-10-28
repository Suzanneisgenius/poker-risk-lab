# Preview status — 2026-10-28

The dashboard and six-file static publication artifact have been built and
checked locally. The repository remains private. No public preview has been
deployed by this task.

GitHub's read-only Pages query returned 404 (no accessible configured site);
that does not establish whether the account is eligible. The attempted request
to enable Pages was stopped by automatic approval review before execution,
because public exposure of the selected files needs explicit confirmation.
No repository visibility or Pages setting was changed.

The proposed public payload is exactly the six files listed in
`GITHUB_PAGES.md`: the dashboard, static case study and validation pages, the
entry redirect, license and `.nojekyll`. It includes aggregate saved research
results and presentation code; it excludes private calculation engines and
personal session data. Confirm that this presentation may be public before
enabling Pages or dispatching the manual deployment workflow.

Local preview: open `dashboard/index.html`, or run the Node app and visit
`http://localhost:4174/dashboard/`.
