'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {load,dataset,render}=require('./build_dashboard');
const root=path.resolve(__dirname,'..');
const source=load(), data=dataset(source), html=render(data);
const embedded=JSON.parse(html.match(/<script id="dashboard-data" type="application\/json">(.*?)<\/script>/s)[1]);
assert.deepEqual(embedded,data);
// Keep evidence values tied to their original records, including less convenient cases.
assert.deepEqual(data.calculation,source.calculation);
assert.deepEqual(data.uncertainty.history,source.uncertainty.history);
assert.deepEqual(data.assumptions.rows,source.assumptions.rows);
assert.deepEqual(data.equity,source.ranges.exact);
for(const b of data.bankroll) {
  const r=source.bankroll.cases.find(c=>c.id===b.id).result;
  for(const k of ['inputs','risk','bankroll','curve','winRate'])assert.deepEqual(b[k],r[k]);
}
for(const mutate of [s=>s.ranges.all_passed=false,s=>s.ranges.exact[0].match=false,s=>s.posteriorCheck.cases[0].passed=false,s=>s.calculation.multi_seed.per_seed[0].ruined_bridge=0,s=>s.bankroll.cases[0].result.risk.average=NaN]) {
  const broken=structuredClone(source);mutate(broken);assert.throws(()=>dataset(broken));
}
assert(!/<script[^>]+src=/.test(html),'dashboard must not need a script CDN');
assert(!/<!--(?:DATA|APP|STYLE|CHART)-->/i.test(html),'all template slots are populated');
for(const marker of ['function simulateBankroll','function equityMC','function scoreHand','class CalculationPool'])assert(!html.includes(marker),'server-side engine unexpectedly bundled: '+marker);
assert.match(html,/Chart\.js v4\.5\.1/);
const {main:pack}=require('./package_dashboard');pack();
const out=path.join(root,'outputs/github-pages');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.relative(out,path.join(d,e.name))]).sort();
assert.deepEqual(walk(out),['.nojekyll','Chart.js-LICENSE.md','LICENSE','case-study/index.html','case-study/validation.html','dashboard/index.html','index.html']);
assert.equal(fs.readFileSync(path.join(out,'LICENSE'),'utf8'),fs.readFileSync(path.join(root,'LICENSE'),'utf8'));
for(const file of ['case-study/index.html','case-study/validation.html']) {
  const page=fs.readFileSync(path.join(out,file),'utf8');assert(!page.includes('Open the Risk Lab'));assert(page.includes('../dashboard/'));
}
assert.equal(fs.readFileSync(path.join(out,'dashboard/index.html'),'utf8'),html);
console.log('PASS: dashboard preserves saved data, rejects failed/non-finite inputs, stays offline, and packages only public presentation files.');
