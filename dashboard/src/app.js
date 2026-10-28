'use strict';
(() => {
  const D = JSON.parse(document.getElementById('dashboard-data').textContent);
  const $ = id => document.getElementById(id);
  const pct = (x, digits = 2) => {
    let n = digits;
    while(n < 4 && x > 0 && x < 1 && [0, 100].includes(Number((x * 100).toFixed(n)))) n++;
    const shown = (x * 100).toFixed(n);
    if(x > 0 && Number(shown) === 0) return '<0.0001%';
    if(x < 1 && Number(shown) === 100) return '>99.9999%';
    return shown + '%';
  };
  const num = x => x.toLocaleString('en-US');
  const signed = (x, n = 2) => (x > 0 ? '+' : '') + x.toFixed(n);
  const range = x => x.map(v => pct(v, 1)).join('–');
  const need = x => x == null ? 'Not found in search range' : (x < 100 ? (Math.ceil(x * 10) / 10).toFixed(1) : String(Math.ceil(x)));
  const colors = { noise: '#3568a6', parameter: '#29634f', model: '#a05b17', neutral: '#7c8681', red: '#a73d4f' };
  const charts = {};
  Chart.defaults.font.family = 'Arial, "Helvetica Neue", Helvetica, sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.color = '#59645e';
  Chart.defaults.animation = false;
  function chart(id, type, data, extra = {}) {
    if(charts[id]) charts[id].destroy();
    charts[id] = new Chart($(id), {type, data, options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {legend: {display: false}, tooltip: {callbacks: {label: c => `${c.dataset.label || ''}: ${typeof c.parsed.y === 'number' ? c.parsed.y.toFixed(2) : ''}%`}}},
      scales: {x: {grid: {display: false}}, y: {beginAtZero: true, grid: {color:'#e5e9e2'}}}, ...extra,
    }});
  }
  function metrics(id, rows) {
    $(id).replaceChildren(...rows.map(([title, value, note]) => {
      const div = document.createElement('div'); div.className = 'metric';
      for(const [tag,text] of [['span',title],['strong',value],['small',note]]) {const el=document.createElement(tag);el.textContent=text;div.append(el);}
      return div;
    }));
  }
  function table(id, rows) {
    $(id).replaceChildren(...rows.map(values => {const tr=document.createElement('tr');for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}return tr;}));
  }
  function research() {
    const n = D.uncertainty.monteCarlo.find(x => x.paths === Number($('paths').value));
    const h = D.uncertainty.history.find(x => x.hands === Number($('history').value));
    const m = D.assumptions.rows.map(x => x.risk), model = [Math.min(...m), Math.max(...m)];
    metrics('research-kpis', [
      ['Simulation noise', range(n.interval), `Approximate 95% repeated-run range · ${num(n.paths)} paths`],
      ['Uncertain win rate', range(h.risk_interval), `95% posterior risk interval · ${num(h.hands)} observed hands`],
      ['Return-model assumptions', range(model), 'Range across five fixed stress tests · endpoint-only monitoring'],
    ]);
    const intervals = [n.interval, h.risk_interval, model];
    chart('uncertainty-chart', 'bar', {labels:['Simulation noise','Uncertain win rate','Return models'], datasets:[{data:intervals.map(v=>v.map(x=>x*100)), backgroundColor:[colors.noise,colors.parameter,colors.model],barThickness:22,borderRadius:2}]}, {
      indexAxis:'y',scales:{x:{min:0,max:100,title:{display:true,text:'Risk of ruin (%)'},grid:{color:'#e5e9e2'}},y:{grid:{display:false},ticks:{font:{size:11}}}},
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>range(intervals[c.dataIndex])}}},
    });
    table('range-table', [
      ['Simulation noise', range(n.interval), 'Approximate binomial 95% repeated-run range around the exact model risk '+pct(D.uncertainty.plugInRisk)+'.'],
      ['Uncertain win rate', range(h.risk_interval), '95% posterior interval of conditional risk. Saved 20,000 posterior draws, seed 0; no path simulation error.'],
      ['Return models',range(model),'Minimum and maximum of five endpoint-only model estimates; not a probability interval.'],
    ]);
  }
  function bridge() {
    const w=Number($('bridge-rate').value), c=D.calculation;
    const m=c.multi_seed.rows.find(x=>x.winrate_bb100===w), s=c.single_seed.rows.find(x=>x.winrate_bb100===w);
    const rows=c.multi_seed.per_seed.filter(x=>x.winrate_bb100===w), paths=c.multi_seed.paths_per_seed;
    $('bridge-summary').replaceChildren(...[
      ['Step ends only',pct(m.mean_risk_endpoint_only)],['Bridge corrected',pct(m.mean_risk_bridge)],['Model exact',pct(m.analytical_finite_horizon_brownian)]
    ].map(([label,value])=>{const d=document.createElement('div');d.textContent=label;const b=document.createElement('strong');b.textContent=value;d.append(b);return d;}));
    const line=(label,data,color,dash=[])=>({label,data,borderColor:color,backgroundColor:color,borderWidth:1.5,pointRadius:2,borderDash:dash,tension:0});
    chart('bridge-chart','line',{labels:rows.map(x=>x.seed),datasets:[
      line('Step ends only',rows.map(x=>100*x.ruined_endpoint_only/paths),colors.neutral),
      line('Bridge corrected',rows.map(x=>100*x.ruined_bridge/paths),colors.parameter),
      line('Model exact',rows.map(()=>100*m.analytical_finite_horizon_brownian),colors.amber||colors.model,[4,4]),
    ]},{scales:{x:{title:{display:true,text:'Random seed'},grid:{display:false},ticks:{maxTicksLimit:8}},y:{beginAtZero:true,title:{display:true,text:'Risk (%)'},grid:{color:'#e5e9e2'}}},plugins:{legend:{display:true,position:'bottom',labels:{boxWidth:12,font:{size:10}}}}});
    $('bridge-story').textContent=`Seed ${c.single_seed.seed} alone: ${pct(s.functional_fix_2026_10_05.risk)} → ${pct(s.model_2026_10_21.risk)}. Changing the random stream contributed ${signed(s.random_stream_change_pp)} percentage points; the bridge correction contributed ${signed(s.bridge_change_pp)}. The correction raised risk in ${rows.filter(x=>x.ruined_bridge>x.ruined_endpoint_only).length} of ${rows.length} paired seeds. Standard error of the bridge mean: ${m.standard_error_of_mean_bridge_pp.toFixed(2)} percentage points.`;
    table('bridge-table',rows.map(x=>[x.seed,pct(x.ruined_endpoint_only/paths),pct(x.ruined_bridge/paths),signed(100*(x.ruined_bridge-x.ruined_endpoint_only)/paths)]));
  }
  function models() {
    const r=D.assumptions.rows;
    chart('model-chart','bar',{labels:['Independent Normal','Heavy tails','Rare shocks','Serial correlation','Clustered regimes'],datasets:[{data:r.map(x=>100*x.risk),backgroundColor:r.map((_,i)=>i===0?colors.neutral:colors.model),barThickness:24}]},{indexAxis:'y',scales:{x:{min:0,max:25,title:{display:true,text:'Risk of ruin (%)'},grid:{color:'#e5e9e2'}},y:{grid:{display:false}}},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>pct(r[c.dataIndex].risk)}}}});
    table('model-table',r.map(x=>[x.label,pct(x.risk),x.per_step_sd_bb.toFixed(1),x.total_sd_ratio.toFixed(2)+'×']));
  }
  const bankNames=['40k hands · +4 bb/100','50k hands · +3 bb/100','5k hands · +12 bb/100','100k hands · −3 bb/100'];
  D.bankroll.forEach((x,i)=>$('bank-case').add(new Option(bankNames[i],x.id)));
  function bankroll() {
    const b=D.bankroll.find(x=>x.id===$('bank-case').value), i=b.inputs;
    const q=pct(i.credibility,0), target=pct(i.target,0);
    $('bank-settings').textContent=`${num(i.hands)} observed hands · ${signed(i.winRate,1)} bb/100 · fixed volatility ${i.sd} bb/100 (${i.sdSource || 'assumed'}) · ${i.priorLabel} · current bankroll ${i.bank} buy-ins · ${i.bbPerBuyIn} bb/buy-in · ${num(i.horizon)} future hands · ruin threshold ${i.thr} buy-ins.`;
    metrics('bank-kpis', [['Risk at the observed win rate',pct(b.risk.plugIn),'Treats the observed win rate as known'],['Average posterior risk',pct(b.risk.average),'Averages risk over the win-rate posterior'],[`${q} posterior upper bound`,pct(b.risk.upper),`At ${i.bank} buy-ins · risk limit ${target}`]]);
    $('bank-definition').textContent=`The ${q} posterior requirement: given these historical results and the selected model, the posterior probability that ruin risk is below ${target} is at least ${q}.`;
    table('bank-readings',[[`${q} posterior upper bound below ${target}`,need(b.bankroll.credible.buyIns)],['Average risk below '+target,need(b.bankroll.average.buyIns)],['Observed win rate treated as exact',need(b.bankroll.plugIn.buyIns)]]);
    $('bank-posterior').textContent=`Win rate: 95% posterior interval ${b.winRate.interval.map(x=>signed(x,2)).join(' to ')} bb/100. Risk: 95% posterior interval ${range(b.risk.interval)}. Posterior probability of a positive win rate: ${pct(b.winRate.probPositive)}.`;
    const c=b.curve;
    chart('bank-chart','line',{datasets:[['plugIn','Observed win rate',colors.neutral],['average','Posterior average',colors.noise],['upper',q+' posterior upper bound',colors.parameter]].map(([key,label,color])=>({label,data:c.bankroll.map((x,k)=>({x,y:100*c[key][k]})),borderColor:color,backgroundColor:color,pointRadius:0,borderWidth:2})).concat([{label:'Risk limit',data:c.bankroll.map(x=>({x,y:100*i.target})),borderColor:colors.model,borderWidth:1,borderDash:[4,4],pointRadius:0}])},{scales:{x:{type:'linear',title:{display:true,text:'Bankroll (buy-ins)'},grid:{display:false}},y:{min:0,max:100,title:{display:true,text:'Risk (%)'},grid:{color:'#e5e9e2'}}},plugins:{legend:{display:true,position:'bottom',labels:{boxWidth:10,font:{size:10}}}}});
    table('bank-table',c.bankroll.map((x,k)=>[x.toFixed(2),pct(c.plugIn[k]),pct(c.average[k]),pct(c.upper[k])]));
  }
  const equityNames=['Flop: nut flush draw vs mixed range','Flop: full house vs paired-board range','Flop: draw vs every legal hand','Turn: straight & flush draws','River: split pots in a weighted range','Flop: why suits matter within J2s'];
  D.equity.forEach((x,i)=>$('equity-case').add(new Option(equityNames[i],x.id)));
  function cards(id,text) {$(id).replaceChildren(...text.match(/../g).map(code=>{const e=document.createElement('span');e.className='card'+(/[hd]/.test(code[1])?' red':'');e.textContent=code[0]+({s:'♠',h:'♥',d:'♦',c:'♣'})[code[1]];return e;}));}
  function equity() {
    const e=D.equity.find(x=>x.id===$('equity-case').value);
    cards('hero-cards',e.hero);cards('board-cards',e.board);
    $('equity-range').textContent=e.range;
    $('equity-combos').textContent=`After card removal: ${e.combos} legal combinations; weighted count ${e.weight}. ${num(e.runouts_per_combo)} runouts per combination.`;
    $('equity-number').textContent=pct(e.ours);
    $('equity-check').textContent=`PokerKit ${D.validation.pokerkitVersion}: ${pct(e.pokerkit)}. Absolute difference ${Math.abs(e.difference).toExponential(1)} (equity units). This checks the evaluator and range calculation; it does not verify the chosen opponent range.`;
    ev();
  }
  function ev() {
    const raw=[$('ev-pot').value,$('ev-call').value], [pot,call]=raw.map(Number), box=$('ev-answer');box.replaceChildren();
    if(raw.some(x=>!x.trim())||[pot,call].some(x=>!Number.isFinite(x)||x<0||x>1e6)){box.textContent='Enter a pot and call between 0 and 1,000,000 bb.';return;}
    const eq=D.equity.find(x=>x.id===$('equity-case').value).ours, result=eq*(pot+call)-call;
    const strong=document.createElement('strong');strong.textContent=signed(result)+' bb';if(result<0)strong.className='negative';box.append(strong);
    box.append(document.createTextNode(`Expected value of calling, relative to folding. Break-even equity: ${pot+call>0?pct(call/(pot+call)):'not applicable (zero pot and call)'}.`));
  }
  const tabs=[...document.querySelectorAll('[role=tab]')];
  function activate(id,focus=false) {
    if(!['research','bankroll','equity'].includes(id)) id='research';
    tabs.forEach(t=>{const on=t.getAttribute('aria-controls')===id;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;$(t.getAttribute('aria-controls')).hidden=!on;if(on&&focus)t.focus();});
    requestAnimationFrame(()=>Object.values(charts).forEach(c=>c.resize()));
  }
  tabs.forEach((t,i)=>{
    t.addEventListener('click',()=>{location.hash=t.getAttribute('aria-controls');activate(t.getAttribute('aria-controls'));});
    t.addEventListener('keydown',e=>{const index=e.key==='ArrowRight'?(i+1)%3:e.key==='ArrowLeft'?(i+2)%3:e.key==='Home'?0:e.key==='End'?2:null;if(index!==null){e.preventDefault();const id=tabs[index].getAttribute('aria-controls');location.hash=id;activate(id,true);}});
  });
  window.addEventListener('hashchange',()=>activate(location.hash.slice(1)));
  ['history','paths'].forEach(id=>$(id).addEventListener('change',research));
  $('bridge-rate').addEventListener('change',bridge);$('bank-case').addEventListener('change',bankroll);$('equity-case').addEventListener('change',equity);
  ['ev-pot','ev-call'].forEach(id=>$(id).addEventListener('input',ev));
  $('validation-summary').textContent=`Saved checks cover ${D.validation.posteriorCases} posterior-bankroll scenarios against Python, ${D.validation.rangeNotations} range notations, and ${D.validation.exactEquityCases} exact postflop equity scenarios against PokerKit. These tests establish numerical agreement within their scope.`;
  $('versions').textContent=`Simulation engine ${D.modelVersion}; posterior model ${D.posteriorVersion}. Research uncertainty results saved ${D.uncertainty.savedAt.slice(0,10)}. Monte Carlo ranges and posterior intervals are different quantities.`;
  $('sources').replaceChildren(...D.sources.map(s=>{const li=document.createElement('li');li.textContent=s.file+' · SHA-256 '+s.sha256;return li;}));
  $('download').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(D,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='poker-dashboard-saved-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  research();bridge();models();bankroll();equity();activate(location.hash.slice(1));
})();
