"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const standalone = path.join(root, "standalone");
const page = [
  fs.readFileSync(path.join(standalone, "build", "shell.html"), "utf8"),
  "\n<script>\n",
  fs.readFileSync(path.join(standalone, "build", "app.js"), "utf8"),
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
