'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const files = {
  calculation: 'checks/calculation-change-2026-10-21/results.json',
  uncertainty: 'reports/case-study/uncertainty.json',
  assumptions: 'reports/case-study/assumptions.json',
  bankroll: 'checks/bankroll-posterior-python/web.json',
  posteriorCheck: 'checks/bankroll-posterior-python/results.json',
  ranges: 'checks/range-equity-pokerkit/results.json',
};
function load() {
  return Object.fromEntries(Object.entries(files).map(([key, file]) => [key, JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))]));
}
function dataset(source = load()) {
  const { calculation: c, uncertainty: u, assumptions: a, bankroll: b, posteriorCheck: p, ranges: r } = source;
  assert(r.all_passed && r.exact.every(x => x.match), 'Range validation failed');
  assert(p.cases.every(x => x.passed && x.failures.length === 0), 'Posterior validation failed');
  assert(c.multi_seed.per_seed.every(x => x.ruined_bridge >= x.ruined_endpoint_only), 'Paired bridge check failed');
  const scenarios = b.cases.filter(x => ['40k-hands-plus-4-assumed-90', 'case-study-50k-plus-3', '5k-hands-plus-12-skeptical', 'losing-100k-minus-3'].includes(x.id))
    .map(({ id, result: z }) => ({ id, inputs: z.inputs, winRate: z.winRate, risk: z.risk, bankroll: z.bankroll, curve: z.curve }));
  assert.equal(scenarios.length, 4);
  const data = {
    modelVersion: c.current_model, posteriorVersion: b.model.version,
    calculation: c, uncertainty: { history: u.history, monteCarlo: u.monte_carlo, plugInRisk: u.plug_in_risk,
      config: u.provenance.parameters.config, savedAt: u.provenance.timestamp_utc },
    assumptions: { rows: a.rows, monitoring: a.monitoring, paths: a.n_paths, config: a.provenance.parameters.config },
    bankroll: scenarios, equity: r.exact,
    validation: { posteriorCases: p.cases.length, exactEquityCases: r.exact.length, rangeNotations: r.notation.length, pokerkitVersion: r.environment.pokerkit },
    sources: Object.entries(files).map(([key, file]) => ({ key, file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') })),
  };
  function finite(x) { if(typeof x === 'number') assert(Number.isFinite(x), 'Non-finite dashboard input'); else if(x && typeof x === 'object') Object.values(x).forEach(finite); }
  finite(data);
  return data;
}
function render(data = dataset()) {
  let html = fs.readFileSync(path.join(root, 'dashboard/src/index.html'), 'utf8');
  const bindings = {
    STYLE: fs.readFileSync(path.join(root, 'dashboard/src/style.css'), 'utf8'),
    CHART: '/*\n' + fs.readFileSync(path.join(root, 'dashboard/vendor/Chart.js-LICENSE.md'), 'utf8') + '\n*/\n' + fs.readFileSync(path.join(root, 'dashboard/vendor/chart.umd.min.js'), 'utf8').replace(/\/\/# sourceMappingURL=.*$/gm, ''),
    DATA: JSON.stringify(data).replaceAll('<', '\\u003c'),
    APP: fs.readFileSync(path.join(root, 'dashboard/src/app.js'), 'utf8'),
  };
  for (const [key, value] of Object.entries(bindings)) {
    const marker = `<!--${key}-->`; assert(html.includes(marker), `Missing ${key}`);
    html = html.replace(marker, () => value);
  }
  return html;
}
function main() {
  fs.writeFileSync(path.join(root, 'dashboard/index.html'), render());
  console.log('wrote dashboard/index.html (saved results; no calculation engines)');
}
if(require.main === module) main();
module.exports = { load, dataset, render, main };
