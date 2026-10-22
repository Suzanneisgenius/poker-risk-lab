"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const standalone = path.join(root, "standalone");
// Embed the saved research case with its original settings. No analysis is rerun.
const resultPath = "reports/tables/uncertainty_risk_demo.json";
const provenancePath = "reports/tables/uncertainty_risk_demo.provenance.json";
const reference = {
  result: JSON.parse(fs.readFileSync(path.join(root, resultPath), "utf8")),
  provenance: JSON.parse(fs.readFileSync(path.join(root, provenancePath), "utf8")),
  sources: [resultPath, provenancePath].map(file => ({file,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex")})),
};
const marker = "/*__UNCERTAINTY_REFERENCE__*/ null";
const app = fs.readFileSync(path.join(standalone, "build", "app.js"), "utf8");
if (!app.includes(marker)) throw new Error("Missing saved-reference binding in app.js");
const reviewedApp = app.replace(marker, JSON.stringify(reference).replaceAll("<", "\\u003c"));
const page = [
  fs.readFileSync(path.join(standalone, "build", "shell.html"), "utf8"),
  "\n<script>\n",
  reviewedApp,
  "\n</script></body></html>\n",
].join("");

for (const target of [
  path.join(standalone, "poker-analytics-suite.html"),
  path.join(root, "index.html"),
  path.join(root, "site", "index.html"),
]) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, page, "utf8");
  process.stdout.write(`wrote ${path.relative(root, target)}\n`);
}
