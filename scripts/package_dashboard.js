'use strict';
// Explicit allowlist: never publish the repository root, Node app or engines.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'outputs', 'github-pages');
const { main: build } = require('./build_dashboard');
function main() {
  build();
  fs.mkdirSync(out, { recursive: true });
  // Refuse unexpected files rather than silently including old artifacts.
  const allowed = new Set(['index.html', 'dashboard/index.html', 'case-study/index.html', 'case-study/validation.html', 'Chart.js-LICENSE.md', '.nojekyll']);
  function inspect(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir,e.name);
      if(e.isSymbolicLink()) throw new Error('Symlink in Pages output: '+f);
      if(e.isDirectory()) inspect(f);
      else if(!allowed.has(path.relative(out,f).split(path.sep).join('/'))) throw new Error('Unexpected Pages output: '+f);
    }
  }
  inspect(out);
  fs.mkdirSync(path.join(out,'dashboard'),{recursive:true});
  fs.mkdirSync(path.join(out,'case-study'),{recursive:true});
  fs.copyFileSync(path.join(root,'dashboard/index.html'),path.join(out,'dashboard/index.html'));
  fs.copyFileSync(path.join(root,'dashboard/vendor/Chart.js-LICENSE.md'),path.join(out,'Chart.js-LICENSE.md'));
  for(const file of ['index.html','validation.html']) {
    const html=fs.readFileSync(path.join(root,'case-study',file),'utf8')
      .replaceAll('<a href="../">Open the Risk Lab</a>', '<a href="../dashboard/">Research dashboard</a>');
    fs.writeFileSync(path.join(out,'case-study',file),html);
  }
  fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=dashboard/"><title>Poker Risk Lab</title><a href="dashboard/">Open the research dashboard</a></html>\n');
  fs.writeFileSync(path.join(out,'.nojekyll'),'');
  inspect(out);
  console.log('Pages artifact: outputs/github-pages (6 allowlisted static files; no engines)');
}
if(require.main===module)main();
module.exports={main};
