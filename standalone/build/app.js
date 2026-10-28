/* ================= Poker Analytics Suite — public UI logic =================
   Core calculations run on the private same-origin API and are deliberately
   excluded from the browser bundle. */
"use strict";

/* ---------- shared: Plotly theme ---------- */
const RANKS="23456789TJQKA";
// Chart colours are read from the page's CSS tokens, so charts follow the light or dark theme.
const C={};
function hexRGB(hex){let h=hex.slice(1);if(h.length===3)h=[...h].map(c=>c+c).join('');const n=parseInt(h,16);return [n>>16,n>>8&255,n&255];}
function tint(hex,alpha){return `rgba(${hexRGB(hex).join(',')},${alpha})`;}
function readChartColors(){
  const css=typeof getComputedStyle==='function'?getComputedStyle(document.documentElement):null;
  const v=(name,fallback)=>css?.getPropertyValue(name).trim()||fallback;
  Object.assign(C,{bg:v('--surface','#ffffff'),grid:v('--grid','#e1ddd4'),accent:v('--accent','#2b6cb0'),ruin:v('--ruin','#b23b52'),
    pos:v('--pos','#1f7a4a'),median:v('--median','#b5801a'),text:v('--text','#1d1f23'),muted:v('--muted','#555b64')});
  C.band=tint(C.accent,.16);
}
readChartColors();
// Chart text uses the page's font tokens too: Arial for axes and legends, the typewriter face for labels on the plot.
const FONT=(()=>{const css=typeof getComputedStyle==='function'?getComputedStyle(document.documentElement):null;
  const v=(name,fallback)=>css?.getPropertyValue(name).trim()||fallback;
  return {sans:v('--sans','Arial,sans-serif'),mono:v('--mono','"Courier New",monospace')};})();
const CFG={displayModeBar:false,responsive:true};
const UNCERTAINTY_REFERENCE=/*__UNCERTAINTY_REFERENCE__*/ null;
function layout(title,xt,yt,extra){return Object.assign({title:{text:title,font:{color:C.text,size:16}},
  paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',font:{family:FONT.sans,color:C.muted,size:13},
  margin:{l:62,r:18,t:44,b:48},xaxis:{title:xt,gridcolor:C.grid,zerolinecolor:C.grid},
  yaxis:{title:yt,gridcolor:C.grid,zerolinecolor:C.grid},legend:{font:{color:C.muted}}},extra||{});}
const $=id=>document.getElementById(id);
// A theme switch redraws every chart already drawn from the data it holds, with each old theme colour
// (solid or tinted) swapped for the new one: traces, fills, markers, annotations, shapes, text and grid.
function colorParts(color){
  if(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color))return {rgb:hexRGB(color).join(','),alpha:null};
  const m=/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(color);
  return m?{rgb:`${m[1]},${m[2]},${m[3]}`,alpha:m[4]===undefined?null:Number(m[4])}:null;
}
function recolorCharts(before){
  const swap=new Map();
  for(const k of Object.keys(before)){const old=colorParts(before[k]);if(old&&old.alpha===null&&before[k]!==C[k])swap.set(old.rgb,C[k]);}
  const recolor=value=>{
    if(typeof value==='string'){const c=colorParts(value),next=c&&swap.get(c.rgb);return next?(c.alpha===null?next:tint(next,c.alpha)):value;}
    if(Array.isArray(value))return value.map(recolor);
    if(Object.prototype.toString.call(value)==='[object Object]')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,recolor(v)]));
    return value;
  };
  document.querySelectorAll('.js-plotly-plot').forEach(el=>Plotly.react(el,recolor(el.data),recolor(el.layout),CFG));
}
if(typeof matchMedia==='function')matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{
  const before={...C};
  readChartColors();
  if(typeof globalThis.Plotly!=='undefined')recolorCharts(before);
});
function kpiCard(l,v,s){return `<div class="kpi"><div class="kl">${l}</div><div class="kv">${v}</div><div class="ks">${s||''}</div></div>`;}
const reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
function integerInput(id,fallback){const value=Number.parseInt($(id).value,10);return Number.isFinite(value)?value:fallback;}
async function apiJSON(path,payload,timeoutMs=60000,externalSignal=null){
  const controller=new AbortController();
  let timedOut=false;
  const abortFromOutside=()=>controller.abort();
  if(externalSignal?.aborted)controller.abort();
  else externalSignal?.addEventListener('abort',abortFromOutside,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
  try{
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
      credentials:'same-origin',body:JSON.stringify(payload),signal:controller.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'The calculation service is temporarily unavailable.');
    return data;
  }catch(error){
    if(error?.name==='AbortError'){
      const aborted=new Error(timedOut?'The calculation took too long. Try a lower precision setting.':'Calculation cancelled.');
      aborted.name='AbortError';throw aborted;
    }
    if(error instanceof TypeError)throw new Error('Cannot reach the private calculation service. Check your connection and try again.');
    throw error;
  }finally{clearTimeout(timer);externalSignal?.removeEventListener('abort',abortFromOutside);}
}
function errorMessage(error){return error instanceof Error?error.message:'Calculation failed. Please try again.';}
const escapeHtml=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* One vocabulary for every result panel (Hand Equity, Pot Odds & EV, Bankroll Risk):
   current = the numbers match the inputs; pending = a new calculation is running;
   stale = inputs changed since the numbers were calculated; error = the latest
   calculation failed; empty = nothing calculated yet. Whenever numbers are shown,
   the panel also says what they were calculated for, so an older result is never
   presented as the current one. CSS dims .result-dim content outside "current". */
const RESULT_STATE_LABELS={current:'Current result',pending:'Calculating…',stale:'Previous calculation',error:'Update failed',empty:'No result yet'};
function setResultState(panel,stateEl,state,{note='',basis=''}={}){
  panel.dataset.resultState=state;
  stateEl.dataset.state=state;
  const label=document.createElement('strong');label.textContent=RESULT_STATE_LABELS[state];
  const lines=[];
  if(note)lines.push(note);
  if(basis)lines.push((state==='current'?'Calculated for: ':'The numbers below are for: ')+basis);
  stateEl.replaceChildren(label,...lines.map(text=>{const line=document.createElement('span');line.textContent=text;return line;}));
}
function downloadText(filename,text,type){
  const url=URL.createObjectURL(new Blob([text],{type}));
  const link=document.createElement('a');link.href=url;link.download=filename;
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function setBusy(button,busy,busyLabel){
  if(!button)return;
  if(busy){if(!button.hasAttribute('aria-busy'))button.dataset.idleLabel=button.textContent;button.textContent=busyLabel;button.disabled=true;button.setAttribute('aria-busy','true');}
  else{button.textContent=button.dataset.idleLabel||button.textContent;button.disabled=false;button.removeAttribute('aria-busy');}
}
/* "What changed" box for the two guided routes: the inputs that differ from
   the result shown before the edit began, the main numbers before and now, and
   why they moved. Built as text, since inputs can come from an imported file. */
function renderChange(box,change,{same}){
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;if(cls)node.className=cls;return node;};
  // Nothing to compare yet: the box stays hidden until a result changes.
  box.hidden=!change;
  if(!change||change.same){box.replaceChildren(...(change?[el('p',same,'change-hint')]:[]));return;}
  const list=el('ul');change.items.forEach(text=>list.append(el('li',text)));
  const table=el('table'),head=el('tr'),body=el('tbody');
  ['','Before','Now'].forEach((text,k)=>{const th=el('th',text,k?'num':'');th.scope='col';head.append(th);});
  change.rows.forEach(([label,before,now])=>{const tr=el('tr'),th=el('th',label);th.scope='row';tr.append(th,el('td',before,'num'),el('td',now,'num'));body.append(tr);});
  const thead=el('thead');thead.append(head);table.append(thead,body);
  const why=el('p',null,'change-why');why.append(el('strong','Why: '),change.why);
  box.replaceChildren(el('h3','What changed'),list,table,why);
}
const plotlyReady=()=>typeof globalThis.Plotly!=="undefined";
function chartUnavailable(id){
  const el=$(id); if(!el)return;
  el.classList.add('chart-fallback');
  el.textContent='Charts need an internet connection to load Plotly. The calculators and numeric results still work.';
}

/* Associate the compact field labels with their inputs. */
document.querySelectorAll('.fld').forEach(field=>{
  const label=field.querySelector('label'),input=field.querySelector('input,select');
  if(label&&input&&!label.htmlFor)label.htmlFor=input.id;
});

/* ================= NAVIGATION ================= */
const tabs=[...document.querySelectorAll('.nav .t')];
function activateTab(t,updateHash=true){
  document.body.classList.toggle('risklab-active',t.dataset.mod==='risklab');
  tabs.forEach(x=>{const active=x===t;x.classList.toggle('on',active);x.setAttribute('aria-selected',String(active));x.tabIndex=active?0:-1;});
  document.querySelectorAll('.mod').forEach(x=>{const active=x.id===t.dataset.mod;x.classList.toggle('on',active);x.setAttribute('aria-hidden',String(!active));});
  t.scrollIntoView({block:'nearest',inline:'center'});
  if(updateHash&&history.replaceState)history.replaceState(null,'','#'+t.dataset.mod);
  window.dispatchEvent(new Event('resize'));
}
tabs.forEach((t,index)=>{
  t.addEventListener('click',()=>activateTab(t));
  t.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    tabs[next].focus();activateTab(tabs[next]);initializeModule(tabs[next].dataset.mod);
  });
});
const requestedHash=location.hash==='#gto'?'#preflop':location.hash;
if(location.hash==='#gto'&&history.replaceState)history.replaceState(null,'','#preflop');
const initialTab=tabs.find(t=>'#'+t.dataset.mod===requestedHash)||tabs[0];
activateTab(initialTab,false);
window.addEventListener('hashchange',()=>{
  const hash=location.hash==='#gto'?'#preflop':location.hash;
  const tab=tabs.find(t=>'#'+t.dataset.mod===hash);
  if(tab){activateTab(tab,false);initializeModule(tab.dataset.mod);if(location.hash==='#gto')history.replaceState(null,'','#preflop');}
});

/* ================= 1. HAND EQUITY (visual card picker) ================= */
const SUIT_SYM=['♣','♦','♥','♠'];   // c d h s  (index = suit)
const SLOTS={hero:['hero0','hero1'],board:['board0','board1','board2','board3','board4'],preflop:['pf0','pf1']};
const opponentSlots=index=>[`opp${index}a`,`opp${index}b`];
// defaults: A of diamonds + K of spades vs Q of hearts + Q of clubs
const cardState={hero0:25,hero1:50,
  board0:null,board1:null,board2:null,board3:null,board4:null,pf0:51,pf1:42};
for(let i=0;i<5;i++){cardState[`opp${i}a`]=i===0?36:null;cardState[`opp${i}b`]=i===0?10:null;}
let activeOpponents=[0];
// How each opponent's hand is given: known 'cards', a 'range' (one opponent
// only) or a 'random' hand dealt on every trial.
const opponentModes=['cards','cards','cards','cards','cards'];
let activeSlot=null;
let pickerReturnFocus=null,pickerInert=[];
const cardRed=idx=>{const s=Math.floor(idx/13);return s===1||s===2;};   // d,h
const groupOf=sid=>sid.startsWith('hero')?'hero':sid.startsWith('opp')?'opponent':sid.startsWith('pf')?'preflop':'board';
const opponentIndexOf=sid=>sid.startsWith('opp')?parseInt(sid.slice(3),10):null;
const slotLabel=sid=>sid.startsWith('hero')?'your hand card '+(+sid.at(-1)+1):sid.startsWith('opp')?'opponent '+(activeOpponents.indexOf(opponentIndexOf(sid))+1)+' card '+(sid.endsWith('a')?1:2):sid.startsWith('pf')?'selected preflop card '+(+sid.at(-1)+1):'board card '+(+sid.at(-1)+1);

function slotsHTML(ids,disabled=false){
  return ids.map(sid=>{
    const v=cardState[sid];
    if(v==null) return `<button type="button" class="cardslot empty${disabled?' disabled':''}" data-slot="${sid}" id="slot_${sid}" aria-label="Choose ${slotLabel(sid)}"${disabled?' disabled':''}><span class="rk">+</span></button>`;
    return `<button type="button" class="cardslot filled${cardRed(v)?' red':''}${disabled?' disabled':''}" data-slot="${sid}" id="slot_${sid}" aria-label="Change ${slotLabel(sid)}: ${RANKS[v%13]} ${SUIT_SYM[Math.floor(v/13)]}"${disabled?' disabled':''}>`+
      `<span class="rk">${RANKS[v%13]}</span><span class="su">${SUIT_SYM[Math.floor(v/13)]}</span>`+
      `<span class="x" data-clear="${sid}" aria-hidden="true">✕</span></button>`;
  }).join('');
}
function renderGroup(g){$('slots_'+g).innerHTML=slotsHTML(SLOTS[g]);}
const OPPONENT_MODES=[['cards','Cards'],['range','Range'],['random','Random']];
function renderOpponents(){
  const headsUp=activeOpponents.length===1;
  $('opponents_list').innerHTML=activeOpponents.map((idx,position)=>{
    const mode=opponentModes[idx];
    const choices=OPPONENT_MODES.map(([value,label])=>{
      const off=value==='range'&&!headsUp;
      return `<label class="${off?'is-off':''}"><input type="radio" name="opp_mode_${idx}" value="${value}" data-opponent-mode="${idx}"${mode===value?' checked':''}${off?' disabled':''}><span>${label}</span></label>`;
    }).join('');
    const body=mode==='random'?'<div class="random-hand-placeholder">Two legal cards will be dealt privately on every simulation trial.</div>'
      :mode==='range'?'<div class="random-hand-placeholder">A hand from the range below is dealt on every runout or trial.</div>':`<div class="slots" id="slots_opp_${idx}">${slotsHTML(opponentSlots(idx))}</div>`;
    return `<div class="opponent-row" data-opponent="${idx}"><div class="opponent-head"><strong>Opponent ${position+1}</strong><div class="opp-actions"><fieldset class="opp-mode"><legend class="sr-only">How opponent ${position+1}'s hand is given</legend>${choices}</fieldset>${activeOpponents.length>1?`<button type="button" class="opp-remove" data-remove-opponent="${idx}" aria-label="Remove opponent ${position+1}">Remove</button>`:''}</div></div>${body}</div>`;
  }).join('');
  const ranged=rangeOpponentActive();
  $('eq_opp_count').textContent=activeOpponents.length+' of 5';
  $('eq_add_opp').disabled=activeOpponents.length>=5||ranged;
  $('eq_opp_note').hidden=!ranged&&headsUp;
  $('eq_opp_note').textContent=ranged?'A range is played against one opponent. Switch opponent 1 to Cards or Random to add players.':'Range is available with one opponent.';
  renderRangeEditor();
}
const rangeOpponentActive=()=>activeOpponents.some(idx=>opponentModes[idx]==='range');

/* Opponent range editor. The text is the source of truth; the matrix and
   the Top % control rewrite it. PokerRange (standalone/shared/range.js) is
   the same parser the server uses. */
let eqRangeWeights=PokerRange.parseRange($('eq_range_text').value).weights||new Float64Array(PokerRange.COMBO_COUNT);
let eqRangeError='';
let eqRangeFocus=0;
const comboCount=n=>(Number.isInteger(n)?n:+n.toFixed(2)).toLocaleString('en-US')+(n===1?' combo':' combos');
// Combos are the two-card holdings; a weight below 1 makes a combo enter the
// range less often, so the weighted count can differ from the number of combos.
// Weights come in steps of 0.0001, so four decimals show a weighted count exactly.
const weightedCount=n=>(+n.toFixed(4)).toLocaleString('en-US',{maximumFractionDigits:4});
const comboLabel=(count,weight)=>comboCount(count)+(Math.abs(weight-count)>1e-9?`, weighted ${weightedCount(weight)}`:'');
function equityKnownCards(){return [...SLOTS.hero,...SLOTS.board].map(s=>cardState[s]).filter(v=>v!=null);}
function renderRangeEditor(){
  const editor=$('eq_range_editor'),on=rangeOpponentActive();
  editor.hidden=!on;if(!on)return;
  const status=$('eq_range_status');
  if(eqRangeError){status.textContent=eqRangeError;status.dataset.state='error';}
  else{
    const s=PokerRange.summarize(eqRangeWeights,equityKnownCards());
    status.dataset.state=s.combos?'ok':'error';
    status.textContent=!s.combos?'The range is empty. Type hands, tap the chart or use Top %.'
      :`${comboLabel(s.combos,s.weighted)} · ${(s.share*100).toFixed(1)}% of starting hands`+(s.live<s.combos?` · ${comboLabel(s.live,s.liveWeighted)} left after your cards and the board`:'')
        +(s.live?'':'. Every one uses a known card.');
  }
  const matrix=$('eq_range_matrix');
  const focused=matrix.contains(document.activeElement)?+document.activeElement.dataset.rangeClass:null;
  matrix.innerHTML=PokerRange.CLASSES.map((name,index)=>{
    const {weight,mixed}=PokerRange.classState(eqRangeWeights,index),pct=Math.round(weight*100);
    const state=weight===0?'not in range':weight===1&&!mixed?'in range':mixed?`some combos, ${pct}% on average`:`${pct}% weight`;
    return `<button type="button" class="range-cell${weight>=.75?' is-on':weight>0?' is-part':''}" data-range-class="${index}" data-row="${Math.floor(index/13)}" data-column="${index%13}" tabindex="${index===eqRangeFocus?0:-1}" aria-pressed="${weight===1&&!mixed?'true':weight>0?'mixed':'false'}" aria-label="${name}: ${state}" style="--w:${pct}%">${name}</button>`;
  }).join('');
  if(focused!=null)matrix.querySelector(`[data-range-class="${focused}"]`)?.focus();
}
// The chart and Top % write the range as text; the state is whatever that text
// parses back to, so the preview always matches what is sent to the server.
function setRangeFromWeights(weights){
  const text=PokerRange.formatRange(weights),parsed=PokerRange.parseRange(text);
  eqRangeWeights=parsed.weights||weights;eqRangeError=parsed.error||'';
  $('eq_range_text').value=text;
  renderRangeEditor();markEquityDirty();
}
$('eq_range_text').addEventListener('input',()=>{
  const parsed=PokerRange.parseRange($('eq_range_text').value);
  if(parsed.error)eqRangeError=parsed.error;else{eqRangeError='';eqRangeWeights=parsed.weights;}
  renderRangeEditor();markEquityDirty();
});
$('eq_range_matrix').addEventListener('click',event=>{
  const cell=event.target.closest('[data-range-class]');if(!cell)return;
  eqRangeFocus=+cell.dataset.rangeClass;
  setRangeFromWeights(PokerRange.toggleClass(eqRangeWeights,eqRangeFocus));
});
$('eq_range_matrix').addEventListener('keydown',event=>{
  const cell=event.target.closest('[data-range-class]');if(!cell)return;
  const next=pfMatrixMove(Number(cell.dataset.row),Number(cell.dataset.column),event.key);
  if(!next)return;
  event.preventDefault();
  eqRangeFocus=next[0]*13+next[1];
  cell.tabIndex=-1;
  const target=$('eq_range_matrix').querySelector(`[data-range-class="${eqRangeFocus}"]`);target.tabIndex=0;target.focus();
});
$('eq_range_top_use').addEventListener('click',()=>{
  const raw=$('eq_range_top').value.trim(),value=Number(raw);
  const pct=raw&&Number.isFinite(value)?clamp(value,1,100):15;$('eq_range_top').value=pct;
  setRangeFromWeights(PokerRange.topPercent(pct));
});
$('eq_range_clear').addEventListener('click',()=>setRangeFromWeights(new Float64Array(PokerRange.COMBO_COUNT)));
function renderSlots(){renderGroup('hero');renderGroup('board');renderOpponents();}
// What the displayed equity numbers were calculated for (empty until a result exists).
let eqResultBasis='';
function setEquityState(state,note=''){setResultState($('eq_results'),$('eq_result_state'),state,{note,basis:eqResultBasis});}
function markEquityDirty(){
  ++equityRequest;equityController?.abort();equityController=null;
  $('eq_spin').style.display='none';setBusy($('eq_run'),false);
  window.__lastEquity=null;window.__lastEquityContext=null;$('eq_toev').disabled=true;
  setEquityState(eqResultBasis?'stale':'empty','Cards or opponents changed. Choose Compute equity to update.');
  if(window.__equityMode!=='manual'){
    ++evRequest;evController?.abort();evController=null;
    $('ev_eq_display').textContent='Needs calculation';$('ev_eq_context').textContent='Cards changed. Calculate their equity before evaluating the call.';
    setEVState(evCurrentResult?'stale':'empty','Cards changed. Calculate their equity to update this result.');
  }
}
function openPicker(slotId){
  activeSlot=slotId;
  pickerReturnFocus=document.activeElement;
  const context=groupOf(slotId)==='preflop'?'preflop':'equity';
  const used=new Set(Object.entries(cardState).filter(([key,value])=>{
    const keyContext=groupOf(key)==='preflop'?'preflop':'equity';
    return value!=null&&key!==slotId&&keyContext===context;
  }).map(([,value])=>value));
  let html='';
  for(const su of [3,2,1,0]){            // spades, hearts, diamonds, clubs
    for(let r=12;r>=0;r--){               // A .. 2
      const idx=su*13+r, u=used.has(idx);
      html+=`<button type="button" class="pcard${(su===1||su===2)?' red':''}${u?' used':''}" data-card="${idx}" aria-label="${RANKS[r]} ${SUIT_SYM[su]}"${u?' disabled':''}>`+
        `<span class="rk">${RANKS[r]}</span><span class="su">${SUIT_SYM[su]}</span></button>`;
    }
  }
  $('pgrid').innerHTML=html;
  $('picktitle').textContent='Pick a card — '+(groupOf(slotId)==='board'?'board':groupOf(slotId)+' hand');
  $('picker').classList.add('on');
  // While the picker is open the rest of the page is inert: no focus, clicks or screen-reader access behind it.
  if(!pickerInert.length){pickerInert=[...document.body.children].filter(el=>el!==$('picker')&&el.tagName!=='SCRIPT'&&!el.inert);pickerInert.forEach(el=>{el.inert=true;});}
  // Focus moves in now, not on the next frame, so it never rests on the inert page behind.
  $('pgrid').querySelector('.pcard:not(:disabled)')?.focus();
}
function closePicker(){
  $('picker').classList.remove('on');
  pickerInert.forEach(el=>{el.inert=false;});pickerInert=[];
  // A pick re-renders the card slots, so focus returns to the new slot with the same id.
  const back=pickerReturnFocus?.isConnected?pickerReturnFocus:pickerReturnFocus?.id&&document.getElementById(pickerReturnFocus.id);
  back?.focus();
}
function fillSlot(idx){
  const g=groupOf(activeSlot); cardState[activeSlot]=idx;
  if(g==='preflop'){renderPfHandSlots();syncPfHandFromCards();}
  else{renderSlots();markEquityDirty();}
  closePicker();
  if(g!=='board'){const ids=g==='hero'?SLOTS.hero:g==='preflop'?SLOTS.preflop:opponentSlots(opponentIndexOf(activeSlot));const next=ids.find(s=>cardState[s]==null);
    if(next) setTimeout(()=>openPicker(next),140); }
}
function clearSlot(sid){
  cardState[sid]=null;
  if(groupOf(sid)==='preflop'){renderPfHandSlots();$('pf_change_status').textContent='Choose the missing card to update the range class.';}
  else{renderSlots();markEquityDirty();}
}
function handleSlotClick(e){
  const clr=e.target.closest('[data-clear]'); if(clr){clearSlot(clr.dataset.clear);e.stopPropagation();return;}
  const slot=e.target.closest('.cardslot'); if(slot&&!slot.classList.contains('disabled')) openPicker(slot.dataset.slot);
}
$('slots_hero').addEventListener('click',handleSlotClick);$('slots_board').addEventListener('click',handleSlotClick);
$('slots_preflop').addEventListener('click',handleSlotClick);
$('opponents_list').addEventListener('click',e=>{
  const remove=e.target.closest('[data-remove-opponent]');if(remove){const idx=+remove.dataset.removeOpponent;activeOpponents=activeOpponents.filter(x=>x!==idx);opponentSlots(idx).forEach(s=>cardState[s]=null);opponentModes[idx]='cards';renderSlots();runEquity();return;}
  handleSlotClick(e);
});
$('opponents_list').addEventListener('change',e=>{
  const radio=e.target.closest('[data-opponent-mode]');if(!radio)return;
  const idx=+radio.dataset.opponentMode;opponentModes[idx]=radio.value;
  if(radio.value!=='cards')opponentSlots(idx).forEach(s=>cardState[s]=null);
  renderOpponents();
  // Keep keyboard focus on the radio group, which was just re-rendered.
  document.querySelector(`[data-opponent-mode="${idx}"][value="${radio.value}"]`)?.focus();
  radio.value==='random'?runEquity():markEquityDirty();
});
$('eq_add_opp').addEventListener('click',()=>{const idx=[0,1,2,3,4].find(i=>!activeOpponents.includes(i));if(idx==null)return;activeOpponents.push(idx);renderOpponents();markEquityDirty();});
$('pgrid').addEventListener('click',e=>{const c=e.target.closest('.pcard');
  if(c&&!c.classList.contains('used')) fillSlot(+c.dataset.card);});
$('pickclose').addEventListener('click',closePicker);
// Tab and Shift+Tab wrap between the close button and the last available card.
$('picker').addEventListener('keydown',e=>{
  if(e.key!=='Tab')return;
  const items=[$('pickclose'),...$('pgrid').querySelectorAll('.pcard:not(:disabled)')];
  const first=items[0],last=items[items.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
});
$('picker').addEventListener('click',e=>{if(e.target.id==='picker')closePicker();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('picker').classList.contains('on'))closePicker();});
function clearEquityCards(){Object.keys(cardState).filter(k=>groupOf(k)!=='preflop').forEach(k=>cardState[k]=null);}
$('eq_clear').addEventListener('click',()=>{clearEquityCards();activeOpponents=[0];opponentModes.fill('cards');renderSlots();markEquityDirty();});
// one-click example matchups (beginner friendly)
const EXAMPLES={
  aakk:{hero:[51,38],vill:[50,24],random:false},   // A♠A♥ vs K♠K♦
  aks22:{hero:[38,37],vill:[0,13],random:false},   // A♥K♥ vs 2♣2♦
  random:{hero:[51,50],mode:'random'},             // A♠K♠ vs random
  range:{hero:[38,37],mode:'range',range:'TT+, AQs+, AKo'}   // A♥K♥ vs a range
};
document.querySelectorAll('.exbtn').forEach(b=>b.addEventListener('click',()=>{
  const ex=EXAMPLES[b.dataset.ex]; if(!ex) return;
  clearEquityCards();markEquityDirty();
  activeOpponents=[0];opponentModes.fill('cards');
  cardState.hero0=ex.hero[0]; cardState.hero1=ex.hero[1];
  if(ex.vill){cardState.opp0a=ex.vill[0]; cardState.opp0b=ex.vill[1];}
  opponentModes[0]=ex.mode||'cards';
  if(ex.range){$('eq_range_text').value=ex.range;eqRangeWeights=PokerRange.parseRange(ex.range).weights;eqRangeError='';}
  renderSlots(); runEquity(true);
}));

// Equity against each hand in the range, toughest first, with the share of the
// range where hero is ahead, even or behind. Exact runs decide that combo by
// combo; Monte Carlo runs only hand by hand (res.split.basis says which).
function renderRangeBreakdown(res){
  const box=$('eq_breakdown');box.hidden=!res;if(!res)return;
  const rows=[...res.groups].sort((a,b)=>a.equity-b.equity||b.share-a.share);
  const split=res.split,byCombo=split.basis==='combo';
  // Two decimals near 0% and 100%, so a sliver of the range neither vanishes nor
  // rounds the rest to 100%; below 0.01% (or above 99.99%) it says so.
  const pct=v=>v>0&&v<1e-4?'<0.01%':v<1&&v>1-1e-4?'>99.99%':(v*100).toFixed((v>0&&v<.001)||(v<1&&v>.999)?2:1)+'%';
  const parts=[split.ahead&&`ahead of ${pct(split.ahead)}`,split.behind&&`behind ${pct(split.behind)}`,split.even&&`even with ${pct(split.even)}`,split.unclear&&`not clearly ahead or behind ${pct(split.unclear)}`].filter(Boolean);
  const list=parts.length>1?parts.slice(0,-1).join(', ')+' and '+parts.at(-1):parts[0];
  $('eq_breakdown_summary').textContent=byCombo?`Combo by combo, weighted: you're ${list} of this range.`:`Hand by hand, using each hand's average over its combos: you're ${list} of this range.`;
  const middle=byCombo?split.even:split.unclear;
  $('eq_breakdown_bar').innerHTML=`<span style="width:${split.ahead*100}%;background:var(--pos)"></span><span style="width:${middle*100}%;background:var(--muted)"></span><span style="width:${split.behind*100}%;background:var(--ruin)"></span>`;
  $('eq_breakdown_bar').setAttribute('aria-label',`Share of the range: ahead ${pct(split.ahead)}, ${byCombo?'even':'not clear'} ${pct(middle)}, behind ${pct(split.behind)}`);
  $('eq_breakdown_rows').innerHTML=rows.map(g=>{
    const e=g.equity*100;
    const tone=byCombo?(g.split.ahead===1?'ahead':g.split.behind===1?'behind':g.split.even===1?'even':'mixed'):g.call;
    // Monte Carlo: the hand's own runs and 95% interval. A wide interval means
    // too few runs to tell, whatever the average says.
    let spread='';
    if(byCombo){if(tone==='mixed')spread=` <span class="dim">combos ${(g.comboEquity[0]*100).toFixed(1)}–${(g.comboEquity[1]*100).toFixed(1)}%</span>`;}
    else{
      const [lo,hi]=g.interval,runs=`${g.trials.toLocaleString()} run${g.trials===1?'':'s'}, 95% interval ${(lo*100).toFixed(0)}–${(hi*100).toFixed(0)}%`;
      spread=` <span class="dim">${tone!=='unclear'?runs:hi-lo>=0.2?`only ${runs}: too few runs to tell`:`${runs}: too close to call`}</span>`;
    }
    return `<tr><th scope="row">${escapeHtml(g.group)}</th><td>${pct(g.share)} <span class="dim">${comboLabel(g.combos,g.weight)}</span></td><td><span class="range-eq ${tone}"><span style="width:${e}%"></span></span>${e.toFixed(1)}%${spread}</td></tr>`;
  }).join('');
  $('eq_breakdown_note').textContent=byCombo
    ?'Ahead means more than 50% equity against that combo over every runout. A hand whose combos fall on both sides shows the range of its combos.'
    :`Ahead means the hand's 95% interval lies above 50%, behind that it lies below; otherwise it is not clear, either because the hand is close to 50% or because it got too few runs. Each hand gets runs in proportion to its share, so rare hands get few; the interval does not rely on their spread, which is zero when a few runs all win or all lose. Each interval is approximate and holds for that hand alone: across many hands, one may land on the wrong side by chance. Monte Carlo does not separate a hand's combos, which can sit on different sides of 50%.`;
}

let equityRequest=0;
let equityController=null;
// `failed` distinguishes a service failure from inputs that are not complete yet.
function showEquityError(message,failed=false){
  $('eq_err').textContent=message;
  setEquityState(failed?(eqResultBasis?'error':'empty'):(eqResultBasis?'stale':'empty'),message);
  if(window.__equityMode!=='manual'){$('ev_err').textContent=message;setEVState(evCurrentResult?(failed?'error':'stale'):'empty',failed?'Card equity could not be calculated.':'Card equity needs complete cards.');}
}
async function runEquity(showResult=false){
  $('eq_err').textContent='';
  const hero=SLOTS.hero.map(s=>cardState[s]).filter(v=>v!=null);
  if(hero.length!==2){showEquityError('Pick 2 cards for your hand.');return;}
  const board=SLOTS.board.map(s=>cardState[s]).filter(v=>v!=null);
  const opponents=[];
  for(let position=0;position<activeOpponents.length;position++){
    const idx=activeOpponents[position];
    if(opponentModes[idx]==='random'){opponents.push(null);continue;}
    if(opponentModes[idx]==='range'){
      if(eqRangeError){showEquityError(eqRangeError);return;}
      const s=PokerRange.summarize(eqRangeWeights,[...hero,...SLOTS.board.map(s=>cardState[s]).filter(v=>v!=null)]);
      if(!s.combos){showEquityError('The range is empty. Type hands, tap the chart or use Top %.');return;}
      if(!s.live){showEquityError('Every hand in this range uses one of your cards or a board card.');return;}
      opponents.push({range:$('eq_range_text').value});continue;
    }
    const hand=opponentSlots(idx).map(s=>cardState[s]).filter(v=>v!=null);
    if(hand.length!==2){showEquityError(`Pick 2 cards for opponent ${position+1}, or mark that hand as unknown / random.`);return;}
    opponents.push(hand);
  }

  const trials=clamp(integerInput('eq_trials',30000),1000,150000);
  $('eq_trials').value=trials;
  const seed=integerInput('eq_seed',42);
  equityController?.abort();
  $('eq_spin').style.display='block';
  setBusy($('eq_run'),true,'Calculating…');
  setEquityState('pending',eqResultBasis?'The previous calculation stays visible until this one finishes.':'');
  const request=++equityRequest;
  const controller=new AbortController();equityController=controller;
  try{
    const {result:res,methodText:methodTxt,range}=await apiJSON('/api/equity',{hero,opponents,board,trials,seed},60000,controller.signal);
    if(request!==equityRequest)return;
    // Range results report win/tie/lose as weighted shares; the others as counts.
    const share=range?1:res.trials;
    const eqp=res.equity*100, w=res.win/share*100, t=res.tie/share*100, l=res.lose/share*100;
    // plain-language verdict for beginners
    let vtxt, tone;
    const field=range?' against this range':` against ${opponents.length} opponent${opponents.length===1?'':'s'}`;
    if(eqp>=55){vtxt=`You're the favourite${field}: about ${Math.round(eqp)}% of the pot on average.`;tone='positive';}
    else if(eqp>=35){vtxt=`This is a competitive spot${field}: about ${Math.round(eqp)}% of the pot on average.`;tone='caution';}
    else{vtxt=`You're the underdog${field}: about ${Math.round(eqp)}% of the pot on average.`;tone='negative';}
    const vd=$('eq_verdict'); vd.style.display='block';
    vd.className='result-insight result-dim sr-only '+tone;vd.textContent=vtxt;
    $('eq_kpis').innerHTML=kpiCard('Equity',eqp.toFixed(1)+'%','')+
      kpiCard('Win',w.toFixed(1)+'%','')+kpiCard('Tie / Lose',t.toFixed(1)+'% / '+l.toFixed(1)+'%','');
    $('eq_method').textContent=methodTxt;
    $('eq_bars').innerHTML=`<span style="width:${w}%;background:var(--pos)"></span><span style="width:${t}%;background:var(--muted)"></span><span style="width:${l}%;background:var(--ruin)"></span>`;
    $('eq_bars').setAttribute('aria-label',`Equity result: win ${w.toFixed(1)} percent, tie ${t.toFixed(1)} percent, lose ${l.toFixed(1)} percent`);
    $('eq_legend').innerHTML=`<span style="color:var(--pos)">■ win</span>&nbsp;&nbsp;<span style="color:var(--muted)">■ tie</span>&nbsp;&nbsp;<span style="color:var(--ruin)">■ lose</span>`;
    $('eq_note').innerHTML=range
      ?(res.method==='exact'?''
        :`Monte Carlo estimate; standard error ≈ ${(res.standardError*100).toFixed(2)} pp. Each hand in the range gets trials in proportion to its share, so the shares themselves are exact.`)
      :res.method==='exact'
      ?''
      :'Monte Carlo estimate; conservative approximate standard error ≈ '+(Math.sqrt(res.equity*(1-res.equity)/res.trials)*100).toFixed(2)+' pp (allows for fractional split pots).';
    renderRangeBreakdown(range?res:null);
    window.__lastEquity=eqp;
    $('eq_toev').disabled=false;
    const cardText=i=>RANKS[i%13]+SUIT_SYM[Math.floor(i/13)];
    const shortRange=text=>text.length>60?text.slice(0,text.lastIndexOf(',',57))+', …':text;
    const opponentText=range?`range ${shortRange(range.text)} (${comboLabel(range.live,range.liveWeighted)})`
      :opponents.map((hand,index)=>hand?hand.map(cardText).join(' '):`Opponent ${index+1} random`).join(' · ');
    window.__lastEquityContext=hero.map(cardText).join(' ')+' vs '+opponentText+(board.length?' · board '+board.map(cardText).join(' '):'');
    eqResultBasis=window.__lastEquityContext+' · '+(res.method==='exact'?'exact':`${res.trials.toLocaleString()} trials, seed ${seed}`);
    setEquityState('current');
    if(window.__equityMode!=='manual')useCardEquity(true);
    if(showResult&&matchMedia('(max-width:860px)').matches)$('eq_results').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});
  }catch(error){
    if(request===equityRequest)showEquityError(errorMessage(error),true);
  }finally{
    if(request===equityRequest){equityController=null;$('eq_spin').style.display='none';setBusy($('eq_run'),false);}
  }
}
$('eq_run').addEventListener('click',()=>runEquity(true));
$('eq_toev').addEventListener('click',()=>{
  useCardEquity(false);
  document.querySelector('.nav .t[data-mod="ev"]').click();
});

/* ================= 2. POT ODDS & EV ================= */
window.__equityMode='auto';
function updateEVEquitySource(){
  const value=parseFloat($('ev_eq').value),manual=window.__equityMode==='manual';
  $('ev_eq_display').textContent=Number.isFinite(value)?value.toFixed(1)+'%':'—';
  $('ev_eq_context').textContent=manual?'Manual percentage — card changes will not overwrite it.':(window.__lastEquityContext||'Using the current Hand Equity matchup.');
}
function useCardEquity(recalculate=true){
  window.__equityMode='auto';
  if(window.__lastEquity!=null)$('ev_eq').value=window.__lastEquity.toFixed(1);
  updateEVEquitySource();if(recalculate)runEV();
}
let evRequest=0;
let evController=null;
let evCurrentResult=null;
let evResultBasis='';
let evLast=null,evBase=null;  // as bpLast and bpBase
let evTestPct=null;
// The equity explorer only makes sense for a current result, so it is
// disabled in every other state.
function setEVState(state,note=''){
  setResultState($('ev_results'),$('ev_result_state'),state,{note,basis:evCurrentResult?evResultBasis:''});
  $('ev_test_equity').disabled=state!=='current';$('ev_reset_test').disabled=state!=='current';
}
const signedValue=(value,digits=1)=>`${value<0?'−':value>0?'+':''}${Math.abs(value).toFixed(digits)}`;
function evAmount(value){
  const amount=Math.abs(value)>=10000?Math.abs(value).toLocaleString('en-US',{notation:'compact',maximumFractionDigits:2}):Math.abs(value).toFixed(2);
  return `${value<0?'−':value>0?'+':''}${amount} bb`;
}
// The EV comparison: equity (from the cards or typed in) and the price (pot
// and call). EV = equity × (pot + call) − call, so with the price fixed each
// point of equity is worth (pot + call) / 100.
const evSnapshot=(r,source)=>({source,equity:r.equity,pot:r.pot,call:r.call,required:r.requiredEquity,ev:r.evCall});
function evChange(base,cur){
  if(!base)return null;
  const items=[],groups=new Set(),pct=v=>(v*100).toFixed(1)+'%';
  const note=(group,label,from,to)=>{if(from!==to){groups.add(group);items.push(`${label}: ${from} → ${to}`);}};
  note('equity','Equity from',base.source,cur.source);
  if(base.source===cur.source)note('equity','Equity',pct(base.equity),pct(cur.equity));
  note('price','Pot',`${base.pot} bb`,`${cur.pot} bb`);
  note('price','Call',`${base.call} bb`,`${cur.call} bb`);
  if(!groups.size){
    if(Math.abs(cur.equity-base.equity)<1e-12)return {same:true};
    groups.add('equity');  // moved by less than the 0.1 shown
  }
  const rows=[['Equity',pct(base.equity),pct(cur.equity)],['Break-even equity',pct(base.required),pct(cur.required)],['EV of calling',evAmount(base.ev),evAmount(cur.ev)]];
  const crossed=Math.sign(base.ev)!==Math.sign(cur.ev)&&Math.abs(base.ev)>1e-9&&Math.abs(cur.ev)>1e-9?` The call is now ${cur.ev>0?'above':'below'} break-even.`:'';
  let why;
  if(groups.size>1)why='The equity and the price both changed, so this comparison cannot say which one moved the EV. Change one at a time to see each effect.';
  else if(groups.has('equity'))why=`The pot and the call are the same, so break-even stays at ${pct(cur.required)}. Equity moved ${signedValue((cur.equity-base.equity)*100)} points, and each point is worth ${((cur.pot+cur.call)/100).toLocaleString('en-US',{maximumFractionDigits:4})} bb here, so EV moved ${evAmount(cur.ev-base.ev)}.${crossed}`;
  else why=`The equity is the same (${pct(cur.equity)}), but the price changed. Break-even is call ÷ (pot + call): ${pct(base.required)} → ${pct(cur.required)}, so EV moved ${evAmount(cur.ev-base.ev)}.${crossed}`;
  return {items,rows,why};
}
function renderEVSensitivity(){
  if(!evCurrentResult)return;
  const r=evCurrentResult,current=r.equity*100,test=evTestPct??current,q=test/100;
  const testEV=q*r.pot-(1-q)*r.call;
  $('ev_test_pct').textContent=test.toFixed(1)+'%';
  $('ev_test_result').textContent=`At ${test.toFixed(1)}% equity: ${evAmount(testEV)} EV per call.`;
  $('ev_sensitivity_note').textContent=`Pot ${r.pot.toLocaleString()} bb · call ${r.call.toLocaleString()} bb held fixed. Each +1 point of equity adds ${((r.pot+r.call)/100).toLocaleString('en-US',{maximumFractionDigits:4})} bb.`;
  $('ev_sensitivity_chart').setAttribute('aria-label',`EV increases linearly with equity at pot ${r.pot} bb and call ${r.call} bb. Break-even ${(r.requiredEquity*100).toFixed(1)} percent. EV for the displayed calculation ${r.evCall.toFixed(2)} bb; test EV ${testEV.toFixed(2)} bb.`);
  if(!plotlyReady()){chartUnavailable('ev_sensitivity_chart');return;}
  const threshold=r.requiredEquity*100;
  const traces=[
    {x:[0,threshold],y:[-r.call,0],mode:'lines',line:{color:C.ruin,width:2.4},hovertemplate:'Equity %{x:.1f}%<br>EV %{y:.2f} bb<extra></extra>'},
    {x:[threshold,100],y:[0,r.pot],mode:'lines',line:{color:C.pos,width:2.4},hovertemplate:'Equity %{x:.1f}%<br>EV %{y:.2f} bb<extra></extra>'},
    {x:[current],y:[r.evCall],mode:'markers',marker:{size:11,color:C.accent,line:{color:C.text,width:1.5}},hovertemplate:'Equity used %{x:.1f}%<br>EV %{y:.2f} bb<extra></extra>'},
  ];
  if(Math.abs(test-current)>.049)traces.push({x:[test],y:[testEV],mode:'markers',marker:{size:11,color:C.median,symbol:'diamond'},hovertemplate:'Test equity %{x:.1f}%<br>EV %{y:.2f} bb<extra></extra>'});
  const narrow=$('ev_sensitivity_chart').clientWidth<450;
  const lay=layout('','Equity (%)','Call EV (bb)');
  lay.showlegend=false;lay.margin={l:narrow?52:60,r:12,t:12,b:48};
  lay.xaxis.range=[0,100];lay.xaxis.dtick=25;lay.xaxis.fixedrange=true;
  lay.yaxis.range=[-r.call-(r.pot+r.call)*.08,r.pot+(r.pot+r.call)*.08];lay.yaxis.automargin=true;lay.yaxis.fixedrange=true;
  lay.shapes=[{type:'line',xref:'paper',x0:0,x1:1,y0:0,y1:0,line:{color:C.muted,width:1,dash:'dot'}},
    {type:'line',x0:threshold,x1:threshold,yref:'paper',y0:0,y1:1,line:{color:C.muted,width:1,dash:'dash'}}];
  Plotly.react('ev_sensitivity_chart',traces,lay,CFG);
}
function renderEV(result,source){
  evCurrentResult=result;
  const snapshot=evSnapshot(result,source);
  renderChange($('ev_change'),evChange(evBase,snapshot),{same:'Nothing that affects the EV differs from before this change.'});
  evLast=snapshot;
  evResultBasis=`${source} · equity ${(result.equity*100).toFixed(1)}% · pot ${result.pot.toLocaleString()} bb · call ${result.call.toLocaleString()} bb`;
  const gap=(result.equity-result.requiredEquity)*100,zero=Math.abs(result.evCall)<1e-9;
  $('ev_main_value').textContent=evAmount(zero?0:result.evCall);
  $('ev_gap').textContent=signedValue(Math.abs(gap)<1e-9?0:gap)+' pp';
  $('ev_current_pct').textContent=(result.equity*100).toFixed(1)+'%';
  $('ev_threshold_pct').textContent=(result.requiredEquity*100).toFixed(1)+'%';
  $('ev_verdict').textContent=zero?'Same as folding (0 bb)':result.evCall>0?'Better than folding (0 bb)':'Worse than folding (0 bb)';
  $('ev_results').classList.toggle('is-positive',!zero&&result.evCall>0);
  $('ev_results').classList.toggle('is-negative',!zero&&result.evCall<0);
  setEVState('current');
  evTestPct=result.equity*100;
  $('ev_test_equity').value=(result.equity*100).toFixed(1);
  $('ev_expl').textContent=`EV = equity × ${result.pot} − (1 − equity) × ${result.call} bb. Assumes no future betting, rake or side pots.`;
  renderEVSensitivity();
}
async function runEV(){
  if(window.__equityMode!=='manual'&&window.__lastEquity==null){
    setEVState('pending','Calculating card equity first…');
    if(!equityController)runEquity();
    return;
  }
  const pot=parseFloat($('ev_pot').value),bet=parseFloat($('ev_bet').value),equityPct=parseFloat($('ev_eq').value);
  const source=window.__equityMode==='manual'?'Manual equity':(window.__lastEquityContext||'Card equity');
  const request=++evRequest;
  evController?.abort();evController=null;
  $('ev_err').textContent='';
  if(!Number.isFinite(pot)||!Number.isFinite(bet)||!Number.isFinite(equityPct)||pot<0||bet<=0||equityPct<0||equityPct>100){
    $('ev_err').textContent='Enter a non-negative pot, a call above 0, and equity from 0% to 100%.';
    setEVState(evCurrentResult?'stale':'empty','The inputs on the left need attention before the call can be evaluated.');return;
  }
  setEVState('pending',evCurrentResult?'The previous calculation stays visible until this one finishes.':'');
  const controller=new AbortController();evController=controller;
  try{
  const result=await apiJSON('/api/ev',{pot,call:bet,equityPct},15000,controller.signal);
  if(request!==evRequest)return;
  renderEV(result,source);
  }catch(error){if(request===evRequest){$('ev_err').textContent=errorMessage(error);setEVState(evCurrentResult?'error':'empty',errorMessage(error));}}
  finally{if(request===evRequest)evController=null;}
}
$('ev_run').addEventListener('click',runEV);
$('ev_choose_hand').addEventListener('click',()=>document.querySelector('.nav .t[data-mod="equity"]').click());
$('ev_use_cards').addEventListener('click',()=>useCardEquity(true));
$('ev_test_equity').addEventListener('input',()=>{evTestPct=+$('ev_test_equity').value;renderEVSensitivity();});
$('ev_reset_test').addEventListener('click',()=>{if(evCurrentResult){evTestPct=evCurrentResult.equity*100;$('ev_test_equity').value=evTestPct.toFixed(1);renderEVSensitivity();}});
$('ev_eq').addEventListener('input',()=>{window.__equityMode='manual';updateEVEquitySource();runEV();});
let _evT=null;
['ev_pot','ev_bet'].forEach(id=>$(id).addEventListener('input',()=>{clearTimeout(_evT);_evT=setTimeout(runEV,100);}));
// Edits on Hand Equity feed the EV too, so an edit on either tab starts a comparison.
['equity','ev'].forEach(id=>['focusin','pointerdown'].forEach(type=>$(id).addEventListener(type,()=>{evBase=evLast;},true)));

/* ================= 3. BANKROLL RISK ================= */
let bankrollRequest=0;
let bankrollController=null;
// What the displayed simulation was calculated for (empty until a result exists).
let bkResultBasis='';
function setBankrollState(state,note=''){setResultState($('bk_results'),$('bk_result_state'),state,{note,basis:bkResultBasis});}
function markBankrollDirty(message='Inputs changed. Choose Run simulation to update.'){
  ++bankrollRequest;bankrollController?.abort();bankrollController=null;setBusy($('bk_run'),false);
  setBankrollState(bkResultBasis?'stale':'empty',message);
}
// Mirrors the server's work ceiling (MAX_PATH_STEPS in server/compute.js): the main fan plus nine curve runs of clamp(10% of paths, 200, 500) paths, each over ceil(hands/100) steps.
const BK_MAX_PATH_STEPS=100000000;
function bankrollPathSteps(hands,paths){return Math.ceil(hands/100)*(paths+9*clamp(Math.round(paths*0.1),200,500));}
function maxBankrollPaths(hands){let paths=20000;while(paths>100&&bankrollPathSteps(hands,paths)>BK_MAX_PATH_STEPS)paths-=100;return paths;}
async function runBankroll(){
  const BI=100;
  ++bankrollRequest;bankrollController?.abort();bankrollController=null;setBusy($('bk_run'),false);
  const fields=['bk_wr','bk_sd','bk_bank','bk_thr','bk_hands','bk_paths','bk_seed'];
  if(fields.some(id=>$(id).value.trim()===''||!Number.isFinite(Number($(id).value)))){
    markBankrollDirty('Fill in all numeric inputs before running the simulation.');return;
  }
  const p={wr:+$('bk_wr').value,sd:Math.max(0,+$('bk_sd').value),bank:+$('bk_bank').value*BI,thr:+$('bk_thr').value*BI,
    hands:clamp(Math.round(+$('bk_hands').value)||100000,100,1000000),paths:clamp(Math.round(+$('bk_paths').value)||6000,100,20000),
    seed:Math.round(+$('bk_seed').value)};
  const maxPaths=maxBankrollPaths(p.hands),pathsReduced=p.paths>maxPaths;
  if(pathsReduced)p.paths=maxPaths;
  $('bk_paths').max=maxPaths;
  $('bk_budget_note').hidden=!pathsReduced;
  $('bk_budget_note').textContent=pathsReduced?`Simulation paths lowered to ${maxPaths.toLocaleString()} so ${p.hands.toLocaleString()} hands fit in one calculation.`:'';
  $('bk_hands').value=p.hands;$('bk_paths').value=p.paths;
  if(p.bank<=p.thr||+$('bk_sd').value<0){markBankrollDirty('Bankroll must exceed the ruin threshold, and game swings must be non-negative.');return;}
  const request=++bankrollRequest;
  const controller=new AbortController();bankrollController=controller;
  setBusy($('bk_run'),true,'Simulating…');
  setBankrollState('pending',bkResultBasis?'The previous simulation stays visible until this one finishes.':'');
  try{
  const result=await apiJSON('/api/bankroll',p,60000,controller.signal);
  if(request!==bankrollRequest)return;
  const r=result.fan,curve=result.curve,metrics=result.metrics;
  bkResultBasis=`${(p.bank/BI).toLocaleString()} BI · ${p.wr} bb/100 win rate · ${p.sd} bb/100 swings · ${p.hands.toLocaleString()} hands · threshold ${(p.thr/BI).toLocaleString()} BI · ${p.paths.toLocaleString()} paths, seed ${p.seed}`;
  setBankrollState('current');
  const ror=metrics.risk,med=metrics.medianTerminal,p95=metrics.p95Drawdown,pp=metrics.profitProbability;
  const rorCount=Math.round(ror*100),riskTone=ror<0.05?'positive':ror<0.2?'caution':'negative';
  $('bk_insight').className='result-insight result-dim sr-only '+riskTone;
  $('bk_insight').textContent=`About ${rorCount} in 100 simulated bankrolls reach the ruin threshold within ${Math.round(p.hands/1000)}k hands under these assumptions.`;
  $('bk_kpis').innerHTML=kpiCard('Risk of ruin',(ror*100).toFixed(1)+'%','over '+p.hands.toLocaleString()+' hands')+
    kpiCard('P95 max drawdown',p95.toFixed(1)+' BI','')+
    kpiCard('Median terminal',med.toFixed(1)+' BI','')+
    kpiCard('Prob. profit',(pp*100).toFixed(1)+'%','')+
    kpiCard('Brownian (finite)',(metrics.brownian*100).toFixed(1)+'%','analytical check')+
    kpiCard('Paths',p.paths.toLocaleString(),'seed '+p.seed);
  if(!plotlyReady()){chartUnavailable('bk_fan');chartUnavailable('bk_curve');return;}
  const tr=[];
  if(r.paths.length>=20)tr.push({x:r.xs.concat(r.xs.slice().reverse()),y:r.p95.concat(r.p05.slice().reverse()),fill:'toself',fillcolor:C.band,line:{color:'rgba(0,0,0,0)'},hoverinfo:'skip',showlegend:false});
  r.paths.forEach((path,i)=>tr.push({x:r.xs,y:path,mode:'lines',line:{color:r.ruinFlags[i]?C.ruin:C.accent,width:0.7},opacity:0.5,hoverinfo:'skip',showlegend:false}));
  tr.push({x:r.xs,y:r.p50,mode:'lines',line:{color:C.median,width:2},name:'median'});
  const lay=layout('Bankroll paths (sample of '+r.paths.length+')','Hands','Bankroll (BI)');
  lay.shapes=[{type:'line',x0:0,x1:p.hands,y0:p.bank/BI,y1:p.bank/BI,line:{color:C.muted,dash:'dot',width:1}},
              {type:'line',x0:0,x1:p.hands,y0:p.thr/BI,y1:p.thr/BI,line:{color:C.ruin,dash:'dash',width:1}}];
  Plotly.react('bk_fan',tr,lay,CFG);
  const lay2=layout('Risk of ruin vs bankroll','Bankroll (BI)','Risk of ruin',{yaxis:{tickformat:'.0%',gridcolor:C.grid}});
  lay2.shapes=[{type:'line',x0:p.bank/BI,x1:p.bank/BI,yref:'paper',y0:0,y1:1,line:{color:C.median,dash:'dot',width:1.3}}];
  Plotly.react('bk_curve',riskCurveTraces(curve),lay2,CFG);
  }catch(error){if(request===bankrollRequest)setBankrollState(bkResultBasis?'error':'empty',errorMessage(error));}
  finally{if(request===bankrollRequest){bankrollController=null;setBusy($('bk_run'),false);}}
}
$('bk_run').addEventListener('click',runBankroll);
document.querySelectorAll('.bkpreset').forEach(button=>button.addEventListener('click',()=>{
  $('bk_wr').value=button.dataset.wr;$('bk_sd').value=button.dataset.sd;$('bk_bank').value=button.dataset.bank;$('bk_hands').value=button.dataset.hands;
  document.querySelectorAll('.bkpreset').forEach(x=>x.setAttribute('aria-pressed',String(x===button)));
  document.querySelectorAll('.bksdpreset').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.sd===button.dataset.sd)));runBankroll();
}));
document.querySelectorAll('.bksdpreset').forEach(button=>button.addEventListener('click',()=>{
  $('bk_sd').value=button.dataset.sd;document.querySelectorAll('.bksdpreset').forEach(x=>x.setAttribute('aria-pressed',String(x===button)));
  document.querySelectorAll('.bkpreset').forEach(x=>x.setAttribute('aria-pressed','false'));runBankroll();
}));
['bk_wr','bk_sd','bk_bank','bk_hands'].forEach(id=>$(id).addEventListener('input',()=>{document.querySelectorAll('.bkpreset').forEach(x=>x.setAttribute('aria-pressed','false'));if(id==='bk_sd')document.querySelectorAll('.bksdpreset').forEach(x=>x.setAttribute('aria-pressed','false'));}));
['bk_wr','bk_sd','bk_bank','bk_thr','bk_hands','bk_paths','bk_seed'].forEach(id=>$(id).addEventListener('input',()=>markBankrollDirty()));

/* ================= 3b. BANKROLL FROM YOUR RESULTS ================= */
// Same three readings everywhere: the observed win rate taken as exact (amber),
// the average over the win rate's posterior (blue) and the posterior upper
// bound that the answer uses (rose). Dash styles repeat the distinction.
const BP_SERIES={upper:{get color(){return C.ruin},dash:'solid'},average:{get color(){return C.accent},dash:'dash'},plugIn:{get color(){return C.median},dash:'dot'}};
const BP_PRIOR_SHORT={none:'no prior',weak:'weakly informative prior',skeptical:'skeptical prior'};
const BP_FIELDS=['bp_hands','bp_wr','bp_sd','bp_bank','bp_thr','bp_bb','bp_horizon','bp_target','bp_cred','bp_margin','bp_level'];
let bpRequest=0,bpController=null,bpBasis='',bpTimer=null,bpHasResult=false;
// The last result shown, and the one shown when the current edit began.
let bpLast=null,bpBase=null;
function setBpState(state,note=''){setResultState($('bp_results'),$('bp_result_state'),state,{note,basis:bpBasis});}
const bkMode=()=>document.querySelector('input[name="bk_mode"]:checked').value;
const bpSdSource=()=>document.querySelector('input[name="bp_sd_source"]:checked').value;
const bpPrior=()=>document.querySelector('input[name="bp_prior"]:checked').value;
const bpAssumedSd=()=>+(document.querySelector('.bpsdpreset[aria-pressed="true"]')?.dataset.sd||90);
const bpPct=v=>v<0.0005?'<0.1%':v>0.9995?'>99.9%':(v*100).toFixed(1)+'%';
const bpSigned=v=>(v<0?'−':'+')+Math.abs(v).toFixed(1);
const bpLevel=v=>`${Number((v*100).toFixed(1))}%`;
const bpBI=v=>v==null?'—':v<100?String(Math.round(v*10)/10):Math.round(v).toLocaleString();
// A bankroll needed is rounded up at the precision shown (0.1 buy-in below
// 100, 1 above), so typing in the amount shown meets the target. Shortfalls
// are worked out from that amount, and spare buy-ins round down.
const bpUp=v=>v==null?null:v<100?Math.min(100,Math.ceil(v*10)/10):Math.ceil(v);
const bpNeed=v=>bpBI(bpUp(v));
const bpShort=(need,bank)=>{const d=bpUp(need)-bank;return d<100?Math.max(0.1,Math.ceil(d*10-1e-7)/10):Math.ceil(d-1e-7);};
const bpSpare=(need,bank)=>{const d=bank-need;return d<100?Math.floor(d*10)/10:Math.floor(d);};
// A probability or risk shown beside the level it is compared with: where
// rounding would put it on, or across, that level, more decimals are shown.
function bpPctAgainst(v,level){
  if(v===level||Math.abs(v-level)>=0.001)return bpPct(v);
  for(let d=2;d<=6;d++){const s=(v*100).toFixed(d);if(+s!==level*100&&(+s<level*100)===(v<level))return s+'%';}
  return bpPct(v);
}
const bpRange=(lo,hi)=>`${bpPct(lo)} to ${bpPct(hi)}`;
const bpHands=n=>n>=1e6?`${(n/1e6).toFixed(n>=1e7?1:2)} million`:Math.round(n).toLocaleString();
// What changed between the result shown before an edit and the new one, and
// why the answer moved. Each input belongs to one group; when more than one
// group changed, the comparison cannot say which change moved the answer.
const BP_SD_SOURCE={assumed:'assumed',tracker:'from your tracker',sessions:'estimated from the sessions'};
const bpSnapshot=(r,context)=>({inputs:r.inputs,context,need:r.bankroll.credible.buyIns,used:r.winRate.credible,interval:r.winRate.interval,average:r.risk.average});
function bpChange(base,cur){
  if(!base)return null;
  const a=base.inputs,b=cur.inputs,items=[],groups=new Set();
  const note=(group,label,from,to)=>{if(from!==to){groups.add(group);items.push(`${label}: ${from} → ${to}`);}};
  const exact=v=>String(+v.toFixed(2)),rate=v=>`${v<0?'−':'+'}${exact(Math.abs(v))} bb/100`;
  const results=s=>s.context?`${s.context.sessions.toLocaleString()} sessions (${s.context.description})`:`totals, ${s.inputs.hands.toLocaleString()} hands at ${rate(s.inputs.winRate)}`;
  if(base.context||cur.context){
    note('data','Results',results(base),results(cur));
    note('data','Win-rate interval widened',a.seMultiplier>1?`×${a.seMultiplier.toFixed(2)}`:'no',b.seMultiplier>1?`×${b.seMultiplier.toFixed(2)}`:'no');
  }else{note('data','Hands played',a.hands.toLocaleString(),b.hands.toLocaleString());note('data','Win rate',rate(a.winRate),rate(b.winRate));}
  // With sessions on both sides the volatility is estimated from them, so it
  // changes with the selection rather than as a setting of its own.
  if(!(a.sdSource==='sessions'&&b.sdSource==='sessions'))note('volatility','Volatility',`${exact(a.sd)} bb/100 (${BP_SD_SOURCE[a.sdSource]})`,`${exact(b.sd)} bb/100 (${BP_SD_SOURCE[b.sdSource]})`);
  note('prior','Prior',a.priorLabel,b.priorLabel);
  note('target','Risk limit',bpLevel(a.target),bpLevel(b.target));
  note('credibility','Posterior probability asked for',bpLevel(a.credibility),bpLevel(b.credibility));
  note('thr','Ruin threshold',`${exact(a.thr)} buy-ins`,`${exact(b.thr)} buy-ins`);
  note('horizon','Hands you plan to play',a.horizon.toLocaleString(),b.horizon.toLocaleString());
  note('bank','Your bankroll',`${exact(a.bank)} buy-ins`,`${exact(b.bank)} buy-ins`);
  note('units','Big blinds per buy-in',exact(a.bbPerBuyIn),exact(b.bbPerBuyIn));
  if(!groups.size)return {same:true};
  const rows=[['Bankroll needed',`${bpNeed(base.need)} BI`,`${bpNeed(cur.need)} BI`],
    ['Win rate the answer uses',`${bpSigned(base.used)} bb/100`,`${bpSigned(cur.used)} bb/100`],
    ['Average risk at your bankroll',bpPct(base.average),bpPct(cur.average)]];
  const one=groups.size===1?[...groups][0]:null,more=(x,y)=>y>x;
  const interval=s=>`${bpSigned(s.interval[0])} to ${bpSigned(s.interval[1])}`,used=`${bpSigned(base.used)} to ${bpSigned(cur.used)} bb/100`;
  let why;
  if(!one)why='Several things changed at once, so this comparison cannot say which one moved the answer. Change one at a time to see each effect.';
  else if(one==='bank')why='Only your bankroll changed. The bankroll needed stays the same; what changes is whether yours is enough.';
  else if(one==='units')why=`The model works in big blinds, so a different buy-in size changes your bankroll${a.thr||b.thr?' and threshold':''} in big blinds and every amount shown in buy-ins.`;
  else if(one==='target'){const s=b.target<a.target;why=`A ${s?'stricter':'looser'} limit on risk needs ${s?'more':'less'} bankroll. The win rate the answer uses does not change.`;}
  else if(one==='credibility'){const m=more(a.credibility,b.credibility);why=`Asking to be ${m?'more':'less'} sure uses a ${m?'lower':'higher'} point of the win-rate estimate (${used}), so ${m?'more':'less'} bankroll is needed.`;}
  else if(one==='thr')why='Risk depends on the room above the threshold, so the bankroll needed moves with the threshold, by the same number of buy-ins.';
  else if(one==='horizon'){const m=more(a.horizon,b.horizon);why=`${m?'More':'Fewer'} hands leave ${m?'more':'less'} time to fall to the threshold, so ${m?'more':'less'} bankroll is needed for the same risk.`;}
  else if(one==='volatility')why=`Volatility changes two things: how sure the win-rate estimate is (95% interval ${interval(base)} → ${interval(cur)} bb/100, so the point the answer uses moved from ${used}) and how much risk each win rate carries. Both feed the answer.`;
  else if(b.sdSource==='sessions'&&exact(a.sd)!==exact(b.sd))why=`The selected sessions changed both the win-rate estimate (95% interval ${interval(base)} → ${interval(cur)} bb/100) and the volatility estimated from them (${exact(a.sd)} → ${exact(b.sd)} bb/100). Both feed the answer.`;
  else{
    const lower=cur.used<base.used;
    why=`The win-rate estimate changed: 95% interval ${interval(base)} → ${interval(cur)} bb/100. The answer uses its ${bpLevel(1-b.credibility)} point, `
      +(Math.abs(cur.used-base.used)<0.05?'which barely moved, so neither did the answer.':`which moved from ${used}. A ${lower?'lower':'higher'} win rate needs ${lower?'more':'less'} bankroll for the same risk.`);
  }
  return {items,rows,why};
}
function scheduleBp(){
  ++bpRequest;bpController?.abort();bpController=null;
  setBpState(bpHasResult?'stale':'empty','Inputs changed. Updating…');
  clearTimeout(bpTimer);bpTimer=setTimeout(runBp,350);
}
async function runBp(){
  clearTimeout(bpTimer);
  ++bpRequest;bpController?.abort();bpController=null;
  const sessionsMode=bpSessionsActive();
  const fields=BP_FIELDS.filter(id=>sessionsMode?!['bp_hands','bp_wr','bp_sd'].includes(id):id!=='bp_sd'||bpSdSource()==='tracker');
  if(fields.some(id=>$(id).value.trim()===''||!Number.isFinite(Number($(id).value)))){
    setBpState(bpHasResult?'stale':'empty','Fill in every number to calculate.');return;
  }
  if(sessionsMode&&!bpSelection){
    setBpState(bpHasResult?'stale':'empty',bpSessionData?'Select at least two sessions.':'Choose a CSV file of your sessions, or try the example data.');return;
  }
  const sdSource=sessionsMode?'sessions':bpSdSource();
  const input={hands:+$('bp_hands').value,winRate:+$('bp_wr').value,sd:sdSource==='tracker'?+$('bp_sd').value:bpAssumedSd(),sdSource,prior:bpPrior(),
    bank:+$('bp_bank').value,thr:+$('bp_thr').value,bbPerBuyIn:+$('bp_bb').value,horizon:+$('bp_horizon').value,
    target:+$('bp_target').value,credibility:+$('bp_cred').value,margin:+$('bp_margin').value,sampleLevel:+$('bp_level').value};
  let context=null;
  if(sessionsMode){
    const sel=bpSelection;
    if(!(sel.sd>=10&&sel.sd<=500)){setBpState(bpHasResult?'stale':'empty',`The selected sessions' volatility (${sel.sd.toFixed(1)} bb/100) is outside 10 to 500. Check that profit_bb is in big blinds.`);return;}
    const clampSd=v=>Math.min(500,Math.max(10,v));
    Object.assign(input,{hands:sel.hands,winRate:sel.winRate,sd:sel.sd,sdRange:[clampSd(sel.sdInterval[0]),clampSd(sel.sdInterval[1])],
      seMultiplier:bpWidenActive()?sel.stability.multiplier:1});
    context={sessions:sel.n,description:bpSelectionDescription()};
  }
  const request=++bpRequest;
  const controller=new AbortController();bpController=controller;
  setBpState('pending',bpHasResult?'The previous result stays visible until this one finishes.':'');
  try{
    const result=await apiJSON('/api/bankroll-posterior',input,15000,controller.signal);
    if(request!==bpRequest)return;
    renderBp(result,context);
  }catch(error){if(request===bpRequest)setBpState(bpHasResult?'error':'empty',errorMessage(error));}
  finally{if(request===bpRequest)bpController=null;}
}
function renderBp(r,context=null){
  const i=r.inputs,w=r.winRate,risk=r.risk,b=r.bankroll;
  const sd1=v=>String(Math.round(v*10)/10),widened=i.seMultiplier>1?` · win-rate interval widened ×${i.seMultiplier.toFixed(2)} for changes over time`:'';
  const q=bpLevel(i.credibility),tgt=bpLevel(i.target),thr=i.thr>0?`${bpBI(i.thr)} buy-ins`:'zero',horizon=`${i.horizon.toLocaleString()} hands`;
  const sdText=i.sdSource==='sessions'?`${sd1(i.sd)} bb/100 (estimated from the sessions; 95% interval ${sd1(i.sdRange[0])} to ${sd1(i.sdRange[1])})`
    :`${i.sd} bb/100 (${i.sdSource==='tracker'?'from your tracker':'assumed'})`;
  bpBasis=(context?`${context.sessions.toLocaleString()} sessions (${context.description}) · `:'')
    +`${i.hands.toLocaleString()} hands at ${bpSigned(i.winRate)} bb/100 · volatility ${sdText}${widened} · ${BP_PRIOR_SHORT[i.prior]} · ${bpBI(i.bank)} buy-ins of ${i.bbPerBuyIn} bb · ${horizon} · threshold ${thr} · risk below ${tgt} with ${q} posterior probability`;
  bpHasResult=true;setBpState('current');
  const snapshot=bpSnapshot(r,context);
  renderChange($('bp_change'),bpChange(bpBase,snapshot),{same:'Nothing that affects the bankroll needed differs from before this change.'});
  bpLast=snapshot;

  const need=b.credible;
  $('bp_need').textContent=need.buyIns==null?'Too large to compute':`${bpNeed(need.buyIns)} buy-ins`;
  $('bp_need_bb').textContent=need.bb==null?'':`${Math.ceil(bpUp(need.buyIns)*i.bbPerBuyIn-1e-7).toLocaleString()} bb`;
  const atYours=`At your ${bpBI(i.bank)} buy-ins, the posterior probability that risk is below ${tgt} is ${bpPctAgainst(risk.probAtMostTarget,i.credibility)}; the question asks for ${q}.`;
  $('bp_gap').className='bp-gap '+(need.met?'is-met':'is-short');
  const gapHead=document.createElement('strong'),gapRest=document.createElement('span');
  gapHead.textContent=need.met?`Your ${bpBI(i.bank)} buy-ins are enough.`:`You have ${bpBI(i.bank)}: ${bpBI(bpShort(need.buyIns,i.bank))} more needed.`;
  gapRest.textContent=' '+atYours;
  $('bp_gap').replaceChildren(gapHead,gapRest);
  $('bp_definition').textContent=`Given these ${i.hands.toLocaleString()} hands and this model, the posterior probability is at least ${q} that the chance of falling to ${thr} within the next ${horizon} is below ${tgt}. This is not average risk, and ${q} is not the chance of avoiding ruin.`;

  const weight=i.prior==='none'?'results only, no prior':`${Math.round(w.dataWeight*100)}% of the weight from your results`;
  $('bp_kpis').innerHTML=kpiCard('Win rate, 95% interval',`${bpSigned(w.interval[0])} to ${bpSigned(w.interval[1])}`,`bb/100 · posterior mean ${bpSigned(w.mean)}`)+
    kpiCard('Chance the win rate is above 0',bpPct(w.probPositive),weight)+
    kpiCard('Average risk',bpPct(risk.average),'')+
    kpiCard('Risk, 95% posterior interval',bpRange(risk.interval[0],risk.interval[1]),'')+
    kpiCard(`Risk, ${q} upper bound`,bpPctAgainst(risk.upper,i.target),`at your bankroll · limit ${tgt}`)+
    kpiCard('Risk if the observed win rate were exact',bpPct(risk.plugIn),'');

  const answer='<span class="bp-tag">this answer</span>';
  const compare=a=>{
    if(a.buyIns==null)return '—';
    if(!a.met)return `${bpBI(bpShort(a.buyIns,i.bank))} more`;
    const spare=bpSpare(a.buyIns,i.bank);return spare>0?`enough (${bpBI(spare)} to spare)`:'just enough';
  };
  $('bp_readings').innerHTML=[
    [`Risk below ${tgt} with ${q} posterior probability${answer}`,b.credible],
    [`Average risk below ${tgt}`,b.average],
    [`Risk below ${tgt} if ${bpSigned(i.winRate)} bb/100 were exact`,b.plugIn],
  ].map(([label,a],k)=>`<tr${k===0?' class="is-current"':''}><th scope="row">${label}</th><td class="num">${bpNeed(a.buyIns)} BI</td><td class="num">${compare(a)}</td></tr>`).join('');

  const labels={winRate:['Uncertain win rate','95% posterior interval'],volatility:['Volatility assumption',`${r.sources.items[1].values.map(v=>+v.toFixed(1)).join(', ')} bb/100`],prior:['Prior','none, weak, skeptical']};
  $('bp_sources').innerHTML=r.sources.items.map(s=>{
    const [lo,hi]=s.range,left=(lo*100).toFixed(2),width=Math.max(0,(hi-lo)*100).toFixed(2);
    return `<div class="bp-source${s.id===r.sources.widest?' is-widest':''}"><div class="bp-source-label">${labels[s.id][0]}<small>${labels[s.id][1]}</small></div><div class="bp-source-track" aria-hidden="true"><span class="bp-source-range" style="left:${left}%;width:${width}%"></span></div><div class="bp-source-value">${bpRange(lo,hi)}</div></div>`;
  }).join('');
  const widest=r.sources.items.find(s=>s.id===r.sources.widest),span=bpRange(widest.range[0],widest.range[1]);
  const fixedSd=i.sdSource==='assumed'?' A standard deviation from your tracker or your sessions can replace the assumption; the model still treats that number as fixed and does not count its own estimation error.'
    :i.sdSource==='sessions'?` The answer uses the volatility estimated from your sessions (${sd1(i.sd)}) as if it were exact; the rows for its 95% interval show what its estimation error could do.`
    :` The answer uses your tracker’s (${sd1(i.sd)}) as if it were exact; the model does not count its estimation error.`;
  $('bp_sources_text').textContent=r.sources.widest==='winRate'
    ?`Among the settings listed here, the win rate’s 95% posterior interval gives the widest range of risk (${span}), as in the case study’s tested scenarios. More hands would narrow it; more simulation would not.`
    :r.sources.widest==='volatility'
      ?`Among the settings listed here, changing the volatility gives the widest range of average risk (${span}). That is a spread over chosen values, a different kind of range from the win rate’s posterior interval.${fixedSd}`
      :`Among the settings listed here, changing the prior gives the widest range of average risk (${span}): with this few hands the prior still carries real weight.`;

  const head=cols=>`<tr>${cols.map((c,k)=>`<th scope="col"${k?' class="num"':''}>${c}</th>`).join('')}</tr>`;
  const mark=row=>row.current?'<span class="bp-tag">yours</span>':'';
  const interval=row=>`${bpSigned(row.interval[0])} to ${bpSigned(row.interval[1])}`;
  const margin=`± ${i.margin} at ${bpLevel(i.sampleLevel)}`;
  $('bp_sens_sd_head').innerHTML=head(['Volatility (bb/100)','Win rate, 95% interval','Average risk',`Risk, ${q} bound`,'Bankroll needed',`Hands for ${margin}`]);
  const boundText={low:'low end of your estimate',high:'high end of your estimate'};
  $('bp_sens_sd').innerHTML=r.sensitivity.volatility.map(row=>`<tr${row.current?' class="is-current"':''}><th scope="row">${sd1(row.sd)}${mark(row)}${row.bound?` <span class="dim">${boundText[row.bound]}</span>`:''}</th><td class="num">${interval(row)}</td><td class="num">${bpPct(row.averageRisk)}</td><td class="num">${bpPctAgainst(row.upperRisk,i.target)}</td><td class="num">${bpNeed(row.requiredBuyIns)} BI</td><td class="num">${bpHands(row.handsForMargin)}</td></tr>`).join('');
  $('bp_sens_prior_head').innerHTML=head(['Prior','Weight of your results','Win rate, 95% interval','Above 0','Average risk','Bankroll needed']);
  $('bp_sens_prior').innerHTML=r.sensitivity.prior.map(row=>`<tr${row.current?' class="is-current"':''}><th scope="row">${escapeHtml(row.label)}${mark(row)}</th><td class="num">${Math.round(row.dataWeight*100)}%</td><td class="num">${interval(row)}</td><td class="num">${bpPct(row.probPositive)}</td><td class="num">${bpPct(row.averageRisk)}</td><td class="num">${bpNeed(row.requiredBuyIns)} BI</td></tr>`).join('');
  $('bp_sens_n_head').innerHTML=head(['Hands played','Win rate, 95% interval','Above 0','Average risk',`Risk, ${q} bound`,'Bankroll needed']);
  $('bp_sens_n').innerHTML=r.sensitivity.sample.map(row=>`<tr${row.current?' class="is-current"':''}><th scope="row">${bpHands(row.hands)}${mark(row)}</th><td class="num">${interval(row)}</td><td class="num">${bpPct(row.probPositive)}</td><td class="num">${bpPct(row.averageRisk)}</td><td class="num">${bpPctAgainst(row.upperRisk,i.target)}</td><td class="num">${bpNeed(row.requiredBuyIns)} BI</td></tr>`).join('');

  const s=r.sampleSize;
  $('bp_sample_text').textContent=`With your ${i.hands.toLocaleString()} hands, a ${bpLevel(s.level)} interval for the win rate from the results alone is ± ${s.currentHalfWidth.toFixed(1)} bb/100. Narrowing it to ± ${s.margin} bb/100 takes about ${bpHands(s.totalHands)} hands in total${s.moreHands>0?`, ${bpHands(s.moreHands)} more than you have`:', which you already have'}. Volatility used: ${sdText}${i.seMultiplier>1?`; interval widened ×${i.seMultiplier.toFixed(2)} for changes over time`:''}.`;
  $('bp_model_text').textContent=`${r.model.name}, version ${r.model.version}. Likelihood: ${r.model.likelihood}. Posterior: ${r.model.posterior}. Risk: ${r.model.risk}. This page computes it live in JavaScript; in the fixed verification cases of checks/bankroll-posterior-python/, every table and chart value was recomputed by the Python research code (src/bayes.py, src/validation.py) with scipy and agrees.`;
  $('bp_posterior_cap').textContent=`Shaded: 95% interval. The answer uses the ${bpLevel(1-i.credibility)} point (${bpSigned(w.credible)} bb/100): risk at that win rate is the ${q} upper bound.`;
  renderBpCharts(r);
}
function renderBpCharts(r){
  if(!plotlyReady()){chartUnavailable('bp_posterior');chartUnavailable('bp_curve');return;}
  const i=r.inputs,w=r.winRate,compact=$('bp_curve').clientWidth<520;
  const start=w.mean-4*w.sd,end=w.mean+4*w.sd,density=x=>Math.exp(-.5*((x-w.mean)/w.sd)**2)/(w.sd*Math.sqrt(2*Math.PI));
  const xs=Array.from({length:241},(_,k)=>start+(end-start)*k/240);
  const inside=xs.filter(x=>x>=w.interval[0]&&x<=w.interval[1]);
  const postLay=layout('','True win rate (bb/100)','',{showlegend:false,margin:{l:24,r:14,t:26,b:46}});
  postLay.yaxis={showticklabels:false,showgrid:false,zeroline:false,fixedrange:true,rangemode:'tozero'};postLay.xaxis.fixedrange=true;
  const vline=(x,color,dash)=>({type:'line',x0:x,x1:x,yref:'paper',y0:0,y1:1,line:{color,dash,width:1.5}});
  postLay.shapes=[vline(0,C.muted,'dash'),vline(w.credible,BP_SERIES.upper.color,'dash')];
  postLay.annotations=[{x:w.credible,y:1,yref:'paper',yanchor:'bottom',text:`${bpLevel(1-i.credibility)} point ${bpSigned(w.credible)}`,showarrow:false,font:{color:C.text,size:11},xanchor:w.credible<w.mean?'right':'left'}];
  Plotly.react('bp_posterior',[
    {x:inside.concat(inside.slice().reverse()),y:inside.map(density).concat(inside.map(()=>0)),fill:'toself',fillcolor:tint(C.accent,.14),line:{color:'rgba(0,0,0,0)'},hoverinfo:'skip'},
    {x:xs,y:xs.map(density),mode:'lines',line:{color:C.accent,width:2},hovertemplate:'Win rate %{x:.1f} bb/100<extra></extra>'},
    {x:[i.winRate],y:[density(i.winRate)],mode:'markers',marker:{color:BP_SERIES.plugIn.color,size:9,line:{color:C.bg,width:2}},hovertemplate:`Observed ${bpSigned(i.winRate)} bb/100<extra></extra>`},
  ],postLay,CFG);
  $('bp_posterior').setAttribute('aria-label',`Posterior of the win rate: mean ${bpSigned(w.mean)} bb/100, 95% interval ${bpSigned(w.interval[0])} to ${bpSigned(w.interval[1])}. Observed ${bpSigned(i.winRate)}. The answer uses ${bpSigned(w.credible)}.`);

  const c=r.curve,b=r.bankroll;
  const names={upper:`Risk with ${bpLevel(i.credibility)} posterior probability (the answer)`,average:'Average risk',plugIn:'Observed win rate as exact'};
  const traces=['plugIn','average','upper'].map(key=>({x:c.bankroll,y:c[key],mode:'lines',name:names[key],line:{color:BP_SERIES[key].color,dash:BP_SERIES[key].dash,width:key==='upper'?2.6:2},hovertemplate:'%{x:.1f} buy-ins: %{y:.1%}<extra>'+names[key]+'</extra>'}));
  const crossings=[['plugIn',b.plugIn],['average',b.average],['upper',b.credible]].filter(([,a])=>a.buyIns!=null);
  traces.push({x:crossings.map(([,a])=>a.buyIns),y:crossings.map(()=>i.target),mode:'markers',showlegend:false,
    marker:{color:crossings.map(([k])=>BP_SERIES[k].color),size:10,line:{color:C.bg,width:2}},
    customdata:crossings.map(([k,a])=>`${names[k]}: ${bpNeed(a.buyIns)} buy-ins`),hovertemplate:'%{customdata}<extra>needed</extra>'});
  const lay=layout('','Bankroll (buy-ins)','Risk of ruin',{yaxis:{tickformat:'.0%',gridcolor:C.grid,range:[0,1.02],fixedrange:true},
    legend:{orientation:'h',x:0,y:1.02,yanchor:'bottom',font:{color:C.muted,size:compact?11:12}},margin:{l:56,r:14,t:compact?92:62,b:46}});
  lay.xaxis.fixedrange=true;lay.xaxis.rangemode='tozero';
  lay.shapes=[{type:'line',xref:'paper',x0:0,x1:1,y0:i.target,y1:i.target,line:{color:C.muted,dash:'dash',width:1}},
    {type:'line',x0:i.bank,x1:i.bank,yref:'paper',y0:0,y1:1,line:{color:C.muted,dash:'dot',width:1.2}}];
  lay.annotations=[{x:i.bank,y:1,yref:'paper',text:`yours ${bpBI(i.bank)}`,showarrow:false,xanchor:'left',yanchor:'top',xshift:4,font:{color:C.text,size:11}},
    {xref:'paper',x:1,y:i.target,text:`limit ${bpLevel(i.target)}`,showarrow:false,xanchor:'right',yanchor:'bottom',font:{color:C.text,size:11}}];
  Plotly.react('bp_curve',traces,lay,CFG);
  $('bp_curve').setAttribute('aria-label',`Risk against bankroll. Bankroll needed for risk below ${bpLevel(i.target)}: ${bpNeed(b.credible.buyIns)} buy-ins with ${bpLevel(i.credibility)} posterior probability, ${bpNeed(b.average.buyIns)} for average risk, ${bpNeed(b.plugIn.buyIns)} with the observed win rate taken as exact. You have ${bpBI(i.bank)}.`);
}
function setBkMode(mode){
  $('bp_view').hidden=mode!=='results';$('bk_sim_view').hidden=mode==='results';
  if(mode==='results'){if(!bpHasResult)runBp();}
  else if(!bkResultBasis)runBankroll();
  window.dispatchEvent(new Event('resize'));
}
document.querySelectorAll('input[name="bk_mode"]').forEach(radio=>radio.addEventListener('change',()=>setBkMode(radio.value)));
document.querySelectorAll('input[name="bp_sd_source"]').forEach(radio=>radio.addEventListener('change',()=>{
  const tracker=bpSdSource()==='tracker';$('bp_sd_tracker').hidden=!tracker;$('bp_sd_assumed').hidden=tracker;scheduleBp();
}));
document.querySelectorAll('.bpsdpreset').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.bpsdpreset').forEach(x=>x.setAttribute('aria-pressed',String(x===button)));scheduleBp();
}));
document.querySelectorAll('input[name="bp_prior"]').forEach(radio=>radio.addEventListener('change',scheduleBp));
BP_FIELDS.forEach(id=>$(id).addEventListener('input',scheduleBp));
$('bp_run').addEventListener('click',runBp);
// An edit begins when a control is focused or pressed (a click does not focus
// a button in every browser); later results are compared with what was shown then.
['focusin','pointerdown'].forEach(type=>$('bp_view').addEventListener(type,()=>{bpBase=bpLast;},true));

/* Imported sessions. The file is read in the browser with PokerSessions
   (standalone/shared/sessions.js); only the totals of the selection go to the
   server. Everything taken from the file is inserted as text, never as HTML. */
const SESSION_EXAMPLE=/*__SESSION_EXAMPLE__*/ null;
let bpSessionData=null;  // what parseCsv read, plus the file name
let bpSelection=null;    // summarize() of the selected sessions, with the sessions
let bpWidenChoice=null;  // null: follow the stability check
const bpInputMode=()=>document.querySelector('input[name="bp_input"]:checked').value;
const bpSessionsActive=()=>bpInputMode()==='sessions';
const bpWidenActive=()=>Boolean(bpSelection?.stability&&bpSelection.stability.multiplier>1&&(bpWidenChoice??bpSelection.stability.flag));
// Enough decimals that a p beside the 5% line never rounds across it.
const bpP=p=>{if(p<0.001)return 'p < 0.001';let d=p<0.1?3:2;while(d<6&&(+p.toFixed(d)<0.05)!==(p<0.05))d++;return `p = ${p.toFixed(d)}`;};
const bpKeyLabel=key=>key===''?'(none)':key;
function bpChips(boxId,listId,groups,name){
  const box=$(boxId),list=$(listId);
  box.hidden=groups.length<2&&(groups[0]?.key??'')==='';
  list.replaceChildren(...groups.map(g=>{
    const label=document.createElement('label'),input=document.createElement('input'),small=document.createElement('small');
    label.className='bp-chip';input.type='checkbox';input.checked=true;input.value=g.key;input.name=name;
    small.textContent=g.sessions.length.toLocaleString();
    label.append(input,document.createTextNode(bpKeyLabel(g.key)+' '),small);
    input.addEventListener('change',bpRenderSelection);
    return label;
  }));
}
function bpLoadSessions(name,text,example=false){
  const read=PokerSessions.parseCsv(text),status=$('bp_file_status');
  bpWidenChoice=null;
  if(read.error){
    bpSessionData=null;bpSelection=null;status.dataset.state='error';status.textContent=`${name}: ${read.error}`;
    $('bp_filters').hidden=true;$('bp_problems').hidden=true;scheduleBp();return;
  }
  bpSessionData={name,example,...read};
  status.dataset.state=read.sessions.length?'ok':'error';
  status.textContent=(example?'Example data: simulated sessions, not real results. ':`${name}: `)
    +`${read.sessions.length.toLocaleString()} sessions read`+(read.problems.length?`, ${read.problems.length.toLocaleString()} left out`:'')+'.';
  const problems=read.problems;
  $('bp_problems').hidden=!problems.length;
  $('bp_problems_summary').textContent=`${problems.length.toLocaleString()} row${problems.length===1?'':'s'} could not be read`;
  $('bp_problems_list').replaceChildren(...problems.slice(0,20).map(p=>Object.assign(document.createElement('li'),{textContent:`Line ${p.line}: ${p.message}.`})),
    ...(problems.length>20?[Object.assign(document.createElement('li'),{textContent:`…and ${(problems.length-20).toLocaleString()} more.`})]:[]));
  const stakes=PokerSessions.groupSessions(read.sessions,'stake'),games=PokerSessions.groupSessions(read.sessions,'game');
  bpChips('bp_stakes_box','bp_stakes',stakes,'bp_stake');bpChips('bp_games_box','bp_games',games,'bp_game');
  // Every session counts until a range of months is chosen; that leaves out
  // sessions without a date, and the note below says how many.
  const months=[...new Set(read.sessions.map(s=>s.date?.slice(0,7)).filter(Boolean))].sort();
  $('bp_period_box').hidden=!months.length;
  $('bp_period_on').checked=false;$('bp_period_range').hidden=true;bpInspectFlags=0;
  for(const [id,selected] of [['bp_from',months[0]],['bp_to',months.at(-1)]]){
    $(id).replaceChildren(...months.map(m=>Object.assign(document.createElement('option'),{value:m,textContent:m,selected:m===selected})));
  }
  const groupBy=$('bp_group_by');
  groupBy.querySelector('[value="stake"]').disabled=stakes.length<2;groupBy.querySelector('[value="game"]').disabled=games.length<2;
  ['month','quarter','year'].forEach(v=>groupBy.querySelector(`[value="${v}"]`).disabled=!months.length);
  groupBy.value=stakes.length>1?'stake':games.length>1?'game':months.length?'quarter':'stake';
  $('bp_filters').hidden=!read.sessions.length;
  if(read.sessions.length)bpRenderSelection();
  else{bpSelection=null;scheduleBp();}
}
function bpSelectedSessions(){
  const checked=name=>{const boxes=[...document.querySelectorAll(`input[name="${name}"]`)];return boxes.length?new Set(boxes.filter(b=>b.checked).map(b=>b.value)):null;};
  const byMonth=bpPeriodActive();
  return PokerSessions.filterSessions(bpSessionData.sessions,{stakes:checked('bp_stake'),games:checked('bp_game'),
    from:byMonth?$('bp_from').value:null,to:byMonth?$('bp_to').value:null});
}
const bpPeriodActive=()=>!$('bp_period_box').hidden&&$('bp_period_on').checked;
// What the dates do to the selection: with no range every session counts; with
// one, sessions without a date drop out, and the note offers to bring them back.
function bpPeriodNote(){
  const note=$('bp_period_note'),undated=bpSessionData.sessions.filter(s=>!s.date).length;
  const n=v=>`${v.toLocaleString()} session${v===1?'':'s'}`;
  if(!bpPeriodActive()){note.textContent=undated?`All dates, including ${n(undated)} without a date.`:'';return;}
  const from=$('bp_from').value,to=$('bp_to').value;
  const outside=bpSessionData.sessions.filter(s=>s.date&&(s.date.slice(0,7)<from||s.date.slice(0,7)>to)).length;
  const left=[undated&&`${n(undated)} without a date`,outside&&`${n(outside)} outside ${from} to ${to}`].filter(Boolean);
  if(!left.length){note.textContent='';return;}
  const all=Object.assign(document.createElement('button'),{type:'button',className:'bp-linkbtn',textContent:'Use all dates'});
  all.addEventListener('click',()=>{$('bp_period_on').checked=false;bpPeriodToggled();$('bp_period_on').focus();});
  note.replaceChildren(document.createTextNode(`Leaves out ${left.join(' and ')}. `),all);
}
function bpPeriodToggled(){$('bp_period_range').hidden=!$('bp_period_on').checked;bpRenderSelection();}
function bpSelectionDescription(){
  const part=(name,word)=>{const boxes=[...document.querySelectorAll(`input[name="${name}"]`)],on=boxes.filter(b=>b.checked);
    return !boxes.length||on.length===boxes.length?`all ${word}`:on.map(b=>bpKeyLabel(b.value)).join(', ');};
  return [part('bp_stake','stakes'),part('bp_game','games'),bpPeriodActive()?`${$('bp_from').value} to ${$('bp_to').value}`:''].filter(Boolean).join(' · ');
}
// The session checks sit folded under "Inspect assumptions"; the summary says
// how many flag, and the section opens by itself when one starts flagging.
let bpInspectFlags=0;
function bpInspectStatus(checks){
  const flags=checks.filter(li=>li.className==='flag').length,run=checks.filter(li=>li.className!=='na').length,status=$('bp_inspect_status');
  status.textContent=!checks.length?'':flags?`· ${flags} ${flags===1?'check flags':'checks flag'} a problem`:run?`· ${run} ${run===1?'check':'checks'}, no problem detected`:'· checks not run';
  status.className='bp-inspect-status'+(flags?' flag':'');
  if(flags&&!bpInspectFlags)$('bp_inspect').open=true;
  bpInspectFlags=flags;
}
function bpRenderSelection(){
  const chosen=bpSelectedSessions(),total=bpSessionData.sessions.length;
  bpWidenChoice=null;bpPeriodNote();
  if(chosen.length<2){
    bpSelection=null;$('bp_selection').textContent=`${chosen.length} of ${total.toLocaleString()} sessions selected: select at least two.`;
    $('bp_lengths').textContent='';$('bp_checks').replaceChildren();bpInspectStatus([]);$('bp_widen_box').hidden=true;$('bp_groups').replaceChildren();$('bp_groups_test').textContent='';
    scheduleBp();return;
  }
  const s=PokerSessions.summarize(chosen);
  bpSelection={...s,sessions:chosen};
  const strong=document.createElement('strong');strong.textContent=`${s.n.toLocaleString()} of ${total.toLocaleString()} sessions`;
  $('bp_selection').replaceChildren(strong,document.createTextNode(` · ${s.hands.toLocaleString()} hands · ${bpSigned(s.winRate)} bb/100 weighted by hands (standard error ${s.standardError.toFixed(1)}) · volatility ${s.sd.toFixed(1)} bb/100 (95% interval ${s.sdInterval[0].toFixed(1)} to ${s.sdInterval[1].toFixed(1)})`));
  const L=s.lengths;
  $('bp_lengths').textContent=L.min===L.max?`Every session has ${L.min.toLocaleString()} hands, so weighting by hands changes nothing.`
    :`Sessions of ${L.min.toLocaleString()} to ${L.max.toLocaleString()} hands (median ${Math.round(L.median).toLocaleString()}). Each counts in proportion to its hands: one ${L.max.toLocaleString()}-hand session weighs as much as ${Math.round(L.max/L.min).toLocaleString()} of ${L.min.toLocaleString()} hands.`;
  const item=(state,text,detail)=>{const li=document.createElement('li');li.className=state;li.textContent=text;if(detail){const small=document.createElement('small');small.textContent=detail;li.append(small);}return li;};
  const checks=[];
  const sc=s.scaling;
  if(!sc)checks.push(item('na','Spread against length: not checked.',L.min===L.max?'All sessions are the same length.':'It needs at least 20 sessions.'));
  else if(!sc.flag)checks.push(item('none',`No difference detected in how much short and long sessions swing per 100 hands: ${sc.short.sd.toFixed(0)} and ${sc.long.sd.toFixed(0)} bb/100.`,`Shorter half up to ${sc.short.maxHands.toLocaleString()} hands, longer half from ${sc.long.minHands.toLocaleString()}; ${bpP(sc.p)}. It flags below p = 0.01 when the two differ by more than about 12%; with few sessions or a small difference, it can miss one.`));
  else checks.push(item('flag',`${sc.ratio>1?'Short':'Long'} sessions swing more per 100 hands: ${sc.short.sd.toFixed(0)} against ${sc.long.sd.toFixed(0)} bb/100 (${bpP(sc.p)}).`,
    `The model expects the same. The volatility used (${s.sd.toFixed(1)}) mixes the two, so check the volatility rows in the results against the kind of sessions you will play.`));
  const st=s.stability;
  const order=st&&(st.ordered==='date'?'date order':chosen.some(x=>x.date)?'file order, as not every session has a date':'file order');
  if(!st)checks.push(item('na','Stability over time: not checked.','It needs at least 20 sessions.'));
  else if(!st.flag)checks.push(item('none',`No change in win rate detected between ${st.groups} blocks of sessions in ${order}.`,`${bpP(st.p)}. Finding none does not show the win rate was steady: with few sessions or a slow drift, this check often misses a change.`));
  else checks.push(item('flag',`The win rate changes over time more than chance allows: ${st.groups} blocks of sessions in ${order} (${bpP(st.p)}).`,
    'An interval that assumes a steady win rate is too narrow. Widening it (below) helps but does not fully fix it; selecting recent months may describe your current game better.'));
  $('bp_checks').replaceChildren(...checks);bpInspectStatus(checks);
  const canWiden=Boolean(st&&st.multiplier>1.0001);
  $('bp_widen_box').hidden=!canWiden;
  if(canWiden){$('bp_widen').checked=bpWidenActive();$('bp_widen_text').textContent=`Widen the win-rate interval ×${st.multiplier.toFixed(2)}, from the spread between the blocks${st.flag?' (suggested)':''}.`;}
  bpRenderGroups();
  scheduleBp();
}
function bpRenderGroups(){
  if(!bpSelection)return;
  const by=$('bp_group_by').value,compared=PokerSessions.compareGroups(bpSelection.sessions,by);
  $('bp_groups').replaceChildren(...compared.groups.map(g=>{
    const tr=document.createElement('tr'),th=document.createElement('th');th.scope='row';th.textContent=bpKeyLabel(g.key);tr.append(th);
    for(const text of [g.n.toLocaleString(),g.hands.toLocaleString(),g.sd==null?bpSigned(g.winRate):`${bpSigned(g.winRate)} ± ${g.standardError.toFixed(1)}`,g.sd==null?'—':g.sd.toFixed(0)]){
      const td=document.createElement('td');td.className='num';td.textContent=text;tr.append(td);
    }
    return tr;
  }));
  const t=compared.test;
  $('bp_groups_test').textContent=!t?'Only one group in the selection.'
    :t.p===null?'Win rate ± standard error, in bb/100. Do the groups differ? Not tested: every group has a single session, so there is no spread within groups to compare against.'
    :`Win rate ± standard error, in bb/100. Do the groups differ? ${bpP(t.p)}: ${t.p<0.05?(by==='stake'||by==='game'?'more than chance allows, so their combined win rate may describe none of them well; consider selecting one.':'more than chance allows: the win rate has changed over time, and recent months may describe your current game better.'):'no difference detected, though small groups can hide one.'}`;
}
document.querySelectorAll('input[name="bp_input"]').forEach(radio=>radio.addEventListener('change',()=>{
  const sessions=bpSessionsActive();$('bp_totals').hidden=sessions;$('bp_sessions').hidden=!sessions;scheduleBp();
}));
$('bp_file').addEventListener('change',async()=>{
  const file=$('bp_file').files[0];if(!file)return;
  $('bp_file').value='';
  if(file.size>10*1024*1024){$('bp_file_status').dataset.state='error';$('bp_file_status').textContent=`${file.name}: the file is too large (10 MB at most).`;return;}
  try{bpLoadSessions(file.name,await file.text());}
  catch{$('bp_file_status').dataset.state='error';$('bp_file_status').textContent=`${file.name}: the file could not be read.`;}
});
$('bp_example').addEventListener('click',()=>bpLoadSessions('sessions-example.csv',SESSION_EXAMPLE,true));
$('bp_template').addEventListener('click',()=>downloadText('sessions-template.csv',PokerSessions.TEMPLATE,'text/csv'));
['bp_from','bp_to'].forEach(id=>$(id).addEventListener('change',bpRenderSelection));
$('bp_period_on').addEventListener('change',bpPeriodToggled);
$('bp_group_by').addEventListener('change',bpRenderGroups);
$('bp_widen').addEventListener('change',()=>{bpWidenChoice=$('bp_widen').checked;scheduleBp();});

/* ================= 4. GTO TRAINER ================= */
const KUHN_LABELS={J:'J (bet/check first)',Q:'Q (bet/check first)',K:'K (bet/check first)',
  Jp:'J after opp check',Qp:'Q after opp check',Kp:'K after opp check',
  Jb:'J facing a bet',Qb:'Q facing a bet',Kb:'K facing a bet',
  Jpb:'J facing a bet (after checking)',Qpb:'Q facing a bet (after checking)',Kpb:'K facing a bet (after checking)'};
let gtoRequest=0;
let gtoController=null;
async function runGTO(){
  const iters=clamp(parseInt($('gto_iters').value)||300000,10000,500000);
  const seed=integerInput('gto_seed',42);
  $('gto_iters').value=iters;$('gto_seed').value=seed;
  $('gto_spin').style.display='block';
  setBusy($('gto_run'),true,'Training…');
  const request=++gtoRequest;
  gtoController?.abort();const controller=new AbortController();gtoController=controller;
  try{
    const r=await apiJSON('/api/gto',{iterations:iters,seed},60000,controller.signal);
    if(request!==gtoRequest)return;
    const exact=r.value;
    $('gto_kpis').innerHTML=kpiCard('Game value (P1)',exact.toFixed(4),'theory −0.0556')+
      kpiCard('|error vs −1/18|',Math.abs(exact-(-1/18)).toFixed(4),'')+
      kpiCard('Iterations',iters.toLocaleString(),'seed '+seed)+
      kpiCard('Info sets',Object.keys(r.strategy).length,'');
    const lay=layout('CFR convergence','Iterations','Game value (P1)');
    lay.shapes=[{type:'line',x0:r.history[0].iter,x1:iters,y0:-1/18,y1:-1/18,line:{color:C.pos,dash:'dash',width:1.4}}];
    if(plotlyReady())Plotly.react('gto_conv',[{x:r.history.map(h=>h.iter),y:r.history.map(h=>h.value),mode:'lines',line:{color:C.accent,width:2},name:'running value'}],lay,CFG);
    else chartUnavailable('gto_conv');
    const order=['J','Q','K','Jb','Qb','Kb','Jp','Qp','Kp','Jpb','Qpb','Kpb'];
    const rows=order.filter(k=>r.strategy[k]).map(k=>{const s=r.strategy[k];
      return `<tr><td>${KUHN_LABELS[k]||k}</td><td>${(s[1]*100).toFixed(1)}%</td><td>${(s[0]*100).toFixed(1)}%</td></tr>`;}).join('');
    $('gto_table').querySelector('tbody').innerHTML=rows;
    const bJ=r.strategy.J?r.strategy.J[1]:0, bK=r.strategy.K?r.strategy.K[1]:0, bQ=r.strategy.Q?r.strategy.Q[1]:0;
    const ratio=r.checks.kingJackRatio==null?'—':r.checks.kingJackRatio.toFixed(2);
    $('gto_check').textContent=`Reference checks: value ${exact.toFixed(4)} (theory −1/18 ≈ −0.0556) · bet K/J ratio ${ratio} (theory ≈ 3) · first Q bet ${(bQ*100).toFixed(1)}% (theory ≈ 0%). Compare the measured values with the references; these are convergence checks.`;
  }catch(error){if(request===gtoRequest)$('gto_check').textContent=errorMessage(error);}
  finally{if(request===gtoRequest){gtoController=null;$('gto_spin').style.display='none';setBusy($('gto_run'),false);}}
}
$('gto_run').addEventListener('click',runGTO);
$('gto').addEventListener('toggle',()=>{if($('gto').open)window.dispatchEvent(new Event('resize'));});

/* ================= 5. PREFLOP RANGE LIBRARY ================= */
const PF_ACTIONS=['raise','call','jam','fold'];
const PF_LABELS={raise:'Raise',call:'Call',jam:'Jam',fold:'Fold'};
// The fills are CSS tokens, defined with the rest of the preflop styles.
const PF_COLORS={raise:'var(--pf-raise)',call:'var(--pf-call)',jam:'var(--pf-jam)',fold:'var(--pf-fold)'};
let pfDataset=null;
let pfScenarios=[];
let pfScenario=null;
let pfSelectedHand='A5s';
let pfCompareHand='A5s';
let pfMode='library';
let pfRequest=0;
let pfCompareRequest=0;
let pfLoading=false;
let pfFailed=false;
let pfRequestedScenario='cash-6max-100-btn-rfi-25';
const pfCache=new Map();
/* Trainer: short practice sets. Each scenario keeps its own set until the page
   reloads, so switching scenarios never discards progress. A set mixes action
   questions with frequency questions on mixed-strategy hands, because a choice
   with any non-zero frequency counts as "in range" and is easy to get on a mixed
   hand without knowing the mix. The demo data has frequencies only (no EV or
   regret), so feedback never claims an EV loss or a GTO accuracy. */
const PF_SET_SIZES=[10,20,169];
let pfSetSize=20;
let pfSetSerial=0;
const pfSessions=new Map();

function pfHandMap(scenario){return new Map((scenario?.hands||[]).map(hand=>[hand.hand,hand]));}
function pfHand(scenario,name){return (scenario?.hands||[]).find(hand=>hand.hand===name)||scenario?.hands?.[0]||null;}
function pfSeed(text){return [...text].reduce((seed,char)=>(Math.imul(seed,31)+char.charCodeAt(0))>>>0,2166136261);}
function pfShuffled(items,seed){
  const out=items.slice();
  for(let index=out.length-1;index>0;index-=1){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const swapIndex=seed%(index+1);
    [out[index],out[swapIndex]]=[out[swapIndex],out[index]];
  }
  return out;
}
function pfIsMixed(hand){return PF_ACTIONS.filter(action=>hand.actions[action]>0).length>1;}
function pfMixText(hand){return PF_ACTIONS.filter(action=>hand.actions[action]>0).map(action=>`${PF_LABELS[action]} ${hand.actions[action]}%`).join(', ');}
// "about 6 times in 10" for 60%, "about 19 times in 20" for 95%: tenths when
// exact, otherwise twentieths, so a mixed 95% never reads as "10 in 10".
function pfHowOften(pct){
  const [count,out]=pct%10===0?[pct/10,10]:pct%5===0?[pct/5,20]:[Math.round(pct),100];
  return `about ${count} time${count===1?'':'s'} in ${out}`;
}
// Frequency questions ask about the most frequent non-fold action of a mixed hand.
function pfFrequencyAction(hand){return PF_ACTIONS.filter(action=>action!=='fold'&&hand.actions[action]>0).sort((a,b)=>hand.actions[b]-hand.actions[a])[0];}
// Four choices: the true frequency, "always" (100%, the classic misreading of a
// mixed hand) and two values 25-40 points away, all at least 15 points apart.
function pfFrequencyOptions(answer,seed){
  const picks=[answer,100];
  const fits=value=>value>=5&&value<=95&&picks.every(pick=>Math.abs(pick-value)>=15);
  for(const value of pfShuffled([-40,-25,25,40].map(delta=>answer+delta),seed))if(picks.length<4&&fits(value))picks.push(value);
  for(let value=5;picks.length<4&&value<=95;value+=5)if(fits(value))picks.push(value);
  return picks.sort((a,b)=>a-b);
}
// A set of `size` questions; below the full 169, about half are mixed hands.
// Every second mixed hand becomes a frequency question.
function pfBuildSet(scenario,size,serial){
  const hands=pfShuffled(scenario.hands,pfSeed(`${scenario.id}#${serial}`));
  let chosen=hands;
  if(size<hands.length){
    const mixed=hands.filter(pfIsMixed),pure=hands.filter(hand=>!pfIsMixed(hand));
    const mixedCount=Math.min(mixed.length,Math.ceil(size/2));
    const pick=mixed.slice(0,mixedCount).concat(pure.slice(0,size-mixedCount));
    pick.push(...mixed.slice(mixedCount,mixedCount+size-pick.length));
    chosen=pfShuffled(pick,pfSeed(`${scenario.id}#${serial}#order`));
  }
  let mixedSeen=0;
  return chosen.map(hand=>{
    if(pfIsMixed(hand)&&mixedSeen++%2===1){
      const action=pfFrequencyAction(hand);
      return {hand:hand.hand,kind:'frequency',action,options:pfFrequencyOptions(hand.actions[action],pfSeed(`${hand.hand}#${serial}`))};
    }
    return {hand:hand.hand,kind:'action'};
  });
}
// Items carry an origin when they did not come from the drawn set:
// 'missed' (retrying a missed question) or 'added' (Practice this spot).
function pfNewSession(scenario,items,retry=false){return {scenarioId:scenario.id,items,results:items.map(()=>null),index:0,size:items.length,retry,updatedAt:new Date().toISOString()};}
// Progress is saved in this browser so a set can be finished another day.
const PF_PROGRESS_KEY='poker-analytics.trainer-progress.v1';
let pfStorageOK=true;
const pfPreviousReviews=new Map();  // scenario id -> the finished set a retry or new set replaced
const pfResumePending=new Set();     // scenarios restored with an unfinished set, until the visitor chooses
let pfViewingPrevious=false;
function pfSessionShape(session){
  return Boolean(session)&&Array.isArray(session.items)&&Array.isArray(session.results)&&session.items.length>0&&
    session.items.length===session.results.length&&Number.isInteger(session.index)&&session.index>=0&&session.index<=session.items.length&&
    session.items.every(item=>item&&typeof item.hand==='string'&&(item.kind==='action'||(item.kind==='frequency'&&PF_ACTIONS.includes(item.action)&&Array.isArray(item.options)&&item.options.length===4)))&&
    session.results.every((result,index)=>index<session.index?Boolean(result)&&typeof result.ok==='boolean':result===null||typeof result?.ok==='boolean');
}
const pfSessionFits=(session,scenario)=>session.items.every(item=>scenario.hands.some(hand=>hand.hand===item.hand));
function savePfProgress(){
  const data={version:1,setSize:pfSetSize,serial:pfSetSerial,sessions:Object.fromEntries(pfSessions),previous:Object.fromEntries(pfPreviousReviews)};
  try{localStorage.setItem(PF_PROGRESS_KEY,JSON.stringify(data));pfStorageOK=true;}catch{pfStorageOK=false;}
}
function loadPfProgress(){
  let data=null;
  try{data=JSON.parse(localStorage.getItem(PF_PROGRESS_KEY)||'null');}catch{pfStorageOK=false;return;}
  if(!data||data.version!==1)return;
  if(PF_SET_SIZES.includes(data.setSize))pfSetSize=data.setSize;
  if(Number.isInteger(data.serial))pfSetSerial=Math.max(pfSetSerial,data.serial);
  for(const [id,session] of Object.entries(data.sessions||{})){
    if(!pfSessionShape(session))continue;
    pfSessions.set(id,session);
    if(session.results.some(Boolean)&&session.index<session.items.length)pfResumePending.add(id);
  }
  for(const [id,session] of Object.entries(data.previous||{}))if(pfSessionShape(session))pfPreviousReviews.set(id,session);
}
function pfTouch(session){session.updatedAt=new Date().toISOString();savePfProgress();}
function pfSessionFor(scenario){
  let session=pfSessions.get(scenario.id);
  // A saved set that no longer matches the scenario's hands is replaced.
  if(session&&!pfSessionFits(session,scenario)){pfSessions.delete(scenario.id);pfResumePending.delete(scenario.id);session=null;}
  if(!session){session=pfNewSession(scenario,pfBuildSet(scenario,pfSetSize,++pfSetSerial));pfSessions.set(scenario.id,session);savePfProgress();}
  return session;
}
// Starting a new set keeps a finished set's review available as "previous".
function pfReplaceSession(scenario,session){
  const current=pfSessions.get(scenario.id);
  if(current&&current.index>=current.items.length)pfPreviousReviews.set(scenario.id,current);
  pfSessions.set(scenario.id,session);pfResumePending.delete(scenario.id);pfViewingPrevious=false;
  savePfProgress();return session;
}
function pfStartNewSet(scenario){return pfReplaceSession(scenario,pfNewSession(scenario,pfBuildSet(scenario,pfSetSize,++pfSetSerial)));}
// "Retrying 5 missed questions + 1 added from the Library (QJs)."
function pfSetDescription(session){
  const sizeText=size=>size===169?'all 169 hands':`${size} question${size===1?'':'s'}`;
  const missed=session.items.filter(item=>item.origin==='missed').length,added=session.items.filter(item=>item.origin==='added');
  let text=session.retry?`Retrying ${missed} missed question${missed===1?'':'s'}`:`This set: ${sizeText(session.size)}`;
  if(added.length)text+=` + ${added.length} added from the Library (${added.map(item=>item.hand).join(', ')})`;
  return text+'.';
}
function pfSessionStats(session){
  const stats={answered:0,total:session.items.length,actionTotal:0,actionInRange:0,frequencyTotal:0,frequencyCorrect:0,mixedSeen:0,missed:[]};
  session.items.forEach((item,index)=>{
    const result=session.results[index];if(!result)return;
    stats.answered+=1;if(result.mixed)stats.mixedSeen+=1;
    if(item.kind==='action'){stats.actionTotal+=1;if(result.ok)stats.actionInRange+=1;}
    else{stats.frequencyTotal+=1;if(result.ok)stats.frequencyCorrect+=1;}
    if(!result.ok)stats.missed.push(item);
  });
  return stats;
}
// Score one answer. Returns null for an answer that does not fit the question.
function pfScoreAnswer(item,hand,answer,availability){
  if(item.kind==='action'){
    if(!PF_ACTIONS.includes(answer)||!availability[answer])return null;
    return {answer,ok:hand.actions[answer]>0,mixed:pfIsMixed(hand)};
  }
  const value=Number(answer);
  if(!item.options.includes(value))return null;
  return {answer:value,ok:value===hand.actions[item.action],mixed:true};
}
const pfFrequencyLabel=value=>value===100?'Always (100%)':`${value}%`;
function pfFeedback(item,result,hand){
  if(item.kind==='frequency'){
    const label=PF_LABELS[item.action],truth=hand.actions[item.action];
    if(result.ok)return {title:`Correct · ${label} ${truth}%`,body:`This demo range plays ${hand.hand} as ${label} ${pfHowOften(truth)}. Full mix: ${pfMixText(hand)}.`};
    return {title:`Not quite · the demo range uses ${label} ${truth}%`,
      body:`You chose ${pfFrequencyLabel(result.answer)}. ${result.answer===100?'This hand is mixed, so it is not played the same way every time. ':''}Full mix: ${pfMixText(hand)}, so ${label} comes up ${pfHowOften(truth)}.`};
  }
  const label=PF_LABELS[result.answer];
  if(!result.ok)return {title:'Not in this demo range',body:`${label}: 0%. This range plays ${hand.hand} as ${pfMixText(hand)}.`};
  if(!result.mixed)return {title:`In range · always ${label}`,body:`${pfMixText(hand)}. There is no mix to learn for this hand.`};
  return {title:'In range · mixed strategy',
    body:`${pfMixText(hand)}. ${label} is one of the actions this range uses, but one answer cannot show the mix: over many hands it plays ${label} ${pfHowOften(hand.actions[result.answer])}.`};
}

/* Matrix search and keyboard movement. */
// Parse "A5s", "ako", "77", "T9s" or "10 9 s" into a hand class.
function pfParseHand(text){
  const cleaned=String(text).toUpperCase().replace(/10/g,'T').replace(/[\s,]+/g,'');
  const match=cleaned.match(/^([2-9TJQKA])([2-9TJQKA])([SO])?$/);
  if(!match)return {error:'Type two ranks, for example A5s, AKo or 77.'};
  const [,first,second,suffix]=match;
  const high=RANKS.indexOf(first)>=RANKS.indexOf(second)?first:second,low=high===first?second:first;
  if(first===second)return {hand:first+second};
  if(!suffix)return {error:`Add s (suited) or o (offsuit): ${high}${low}s or ${high}${low}o.`};
  return {hand:high+low+suffix.toLowerCase()};
}
// Next cell for an arrow/Home/End key in the 13×13 matrix, or null for other keys.
function pfMatrixMove(row,column,key){
  const moves={ArrowUp:[row-1,column],ArrowDown:[row+1,column],ArrowLeft:[row,column-1],ArrowRight:[row,column+1],Home:[row,0],End:[row,12]};
  if(!moves[key])return null;
  const [nextRow,nextColumn]=moves[key];
  return [clamp(nextRow,0,12),clamp(nextColumn,0,12)];
}
function pfStrategyBackground(actions){
  let cursor=0;
  const stops=[];
  PF_ACTIONS.forEach(action=>{
    const value=Math.max(0,Number(actions[action])||0);
    if(!value)return;
    const next=Math.min(100,cursor+value);
    stops.push(`${PF_COLORS[action]} ${cursor}% ${next}%`);
    cursor=next;
  });
  if(cursor<100)stops.push(`${PF_COLORS.fold} ${cursor}% 100%`);
  return `linear-gradient(90deg,${stops.join(',')})`;
}
function pfActionAria(hand){
  return `${hand.hand}: `+PF_ACTIONS.filter(action=>hand.actions[action]>0).map(action=>`${PF_LABELS[action]} ${hand.actions[action]} percent`).join(', ');
}
function renderPfMatrix(targetId,scenario,selectedName=pfSelectedHand){
  const target=$(targetId);if(!target||!scenario)return;
  // Keyboard focus stays on the same hand when the matrix is re-rendered.
  const focusedHand=target.contains(document.activeElement)?document.activeElement.dataset.pfHand:null;
  // Roving tabindex: only the selected cell is in the Tab order; arrow keys move within the matrix.
  target.innerHTML=scenario.hands.map(hand=>{
    const active=hand.hand===selectedName;
    const mixed=PF_ACTIONS.filter(action=>hand.actions[action]>0).length>1;
    const dominant=PF_ACTIONS.reduce((best,action)=>hand.actions[action]>hand.actions[best]?action:best,'fold');
    const note=mixed?`<small>${hand.actions[dominant]}%</small>`:'';
    return `<button type="button" class="pf-cell${active?' is-selected':''}${hand.actions.jam>0?' has-jam':''}" data-pf-hand="${hand.hand}" data-row="${hand.row}" data-column="${hand.column}" tabindex="${active?0:-1}" style="background:${pfStrategyBackground(hand.actions)}" aria-label="${pfActionAria(hand)}" aria-pressed="${active}">${hand.hand}${note}</button>`;
  }).join('');
  if(!target.querySelector('.pf-cell[tabindex="0"]'))target.querySelector('.pf-cell')?.setAttribute('tabindex','0');
  if(focusedHand)target.querySelector(`[data-pf-hand="${focusedHand}"]`)?.focus();
}
function pfCardHtml(handName){
  const pair=handName.length===2;
  const suited=handName.endsWith('s');
  const rankA=handName[0],rankB=handName[1];
  const secondSuit=pair?'♥':suited?'♠':'♦';
  return `<div class="pf-card"><strong>${rankA}</strong><span>♠</span></div><div class="pf-card${secondSuit==='♥'||secondSuit==='♦'?' red':''}"><strong>${rankB}</strong><span>${secondSuit}</span></div>`;
}
function pfClassFromCards(first,second){
  const firstRank=first%13,secondRank=second%13;
  if(firstRank===secondRank)return RANKS[firstRank]+RANKS[secondRank];
  const high=Math.max(firstRank,secondRank),low=Math.min(firstRank,secondRank);
  const suited=Math.floor(first/13)===Math.floor(second/13);
  return RANKS[high]+RANKS[low]+(suited?'s':'o');
}
function pfCardsFromClass(handName){
  const firstRank=RANKS.indexOf(handName[0]),secondRank=RANKS.indexOf(handName[1]);
  if(handName.length===2)return [3*13+firstRank,2*13+secondRank];
  if(handName.endsWith('s'))return [3*13+firstRank,3*13+secondRank];
  return [3*13+firstRank,2*13+secondRank];
}
function setPfCardsFromClass(handName){
  [cardState.pf0,cardState.pf1]=pfCardsFromClass(handName);
  renderPfHandSlots();
}
function renderPfHandSlots(){
  const target=$('slots_preflop');if(!target)return;
  target.innerHTML=slotsHTML(SLOTS.preflop);
}
function syncPfHandFromCards(){
  if(cardState.pf0==null||cardState.pf1==null)return;
  const handName=pfClassFromCards(cardState.pf0,cardState.pf1);
  pfSelectedHand=handName;pfCompareHand=handName;
  renderPfLibrary();
  const describe=card=>RANKS[card%13]+SUIT_SYM[Math.floor(card/13)];
  $('pf_change_status').textContent=`${describe(cardState.pf0)} ${describe(cardState.pf1)} maps to ${handName}.`;
}
function pfActionRows(actions){
  return PF_ACTIONS.map(action=>`<div class="pf-action-row"><i class="pf-swatch ${action}"></i><span>${PF_LABELS[action]}</span><output>${actions[action]}%</output><span class="pf-mix-track"><i style="width:${actions[action]}%;background:${PF_COLORS[action]}"></i></span></div>`).join('');
}
function pfSummary(scenario){
  const totals={raise:0,call:0,jam:0,fold:0};
  let combos=0;
  scenario.hands.forEach(hand=>{
    combos+=hand.combos;
    PF_ACTIONS.forEach(action=>totals[action]+=hand.combos*hand.actions[action]/100);
  });
  const pct=action=>100*totals[action]/combos;
  return {vpip:100-pct('fold'),raise:pct('raise'),call:pct('call'),jam:pct('jam'),fold:pct('fold')};
}
function renderPfSummary(scenario,targetId='pf_summary'){
  const summary=pfSummary(scenario);
  $(targetId).innerHTML=`<div><span>VPIP</span><strong>${summary.vpip.toFixed(1)}%</strong></div>`+
    `<div class="raise"><span>Raise</span><strong>${summary.raise.toFixed(1)}%</strong></div>`+
    `<div class="call"><span>Call</span><strong>${summary.call.toFixed(1)}%</strong></div>`+
    `<div class="jam"><span>Jam</span><strong>${summary.jam.toFixed(1)}%</strong></div>`+
    `<div class="fold"><span>Fold</span><strong>${summary.fold.toFixed(1)}%</strong></div>`;
}
function pfScenarioAvailability(scenario){
  return Object.fromEntries(PF_ACTIONS.map(action=>[action,scenario.hands.some(hand=>hand.actions[action]>0)]));
}
function pfScenarioContext(scenario){
  const availability=pfScenarioAvailability(scenario);
  const used=PF_ACTIONS.filter(action=>availability[action]).map(action=>PF_LABELS[action]);
  if(scenario.situation==='First in'){
    return {
      title:'Why is Call unavailable?',
      text:`Everyone before you has folded, so there is no bet to call. This spot uses ${used.join(' or ')}.`,
    };
  }
  return {
    title:'You are facing an open raise',
    text:`There is already a bet to match, so Call is available. This demo scenario uses ${used.join(', ').replace(/, ([^,]*)$/,', or $1')}.`,
  };
}
function renderPfContext(scenario,targetId){
  const context=pfScenarioContext(scenario);
  $(targetId).innerHTML=`<strong>${context.title}</strong>${context.text}`;
}
function renderPfMeta(scenario){
  $('pf_meta').innerHTML=[
    ['Game',scenario.game],['Table',scenario.table],['Stack',scenario.stack+'bb'],['Hero',scenario.hero],
    ['Situation',scenario.situation],['Opponent',scenario.opponent],['Open size',scenario.openSize],
  ].map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
  renderPfContext(scenario,'pf_context_note');
}
function renderPfHandDetail(hand){
  if(!hand)return;
  renderPfHandSlots();$('pf_hand_name').textContent=hand.hand;
  $('pf_detail_mix').innerHTML=pfActionRows(hand.actions);
}
function fillPfScenarioSelects(){
  const options=pfScenarios.map(s=>`<option value="${s.id}">${s.title}</option>`).join('');
  ['pf_scenario','pf_trainer_select','pf_compare_a','pf_compare_b'].forEach(id=>{const el=$(id);if(el)el.innerHTML=options;});
  $('pf_scenario').value=pfScenario.id;
  $('pf_trainer_select').value=pfScenario.id;
  $('pf_compare_a').value=pfScenario.id;
  const counterpart=pfScenarios.find(s=>s.hero===pfScenario.hero&&s.situation===pfScenario.situation&&s.stack!==pfScenario.stack)||pfScenarios[1]||pfScenarios[0];
  $('pf_compare_b').value=counterpart.id;
}
function renderPfLibrary(){
  if(!pfScenario)return;
  $('pf_title').textContent=pfScenario.title;
  renderPfMeta(pfScenario);
  renderPfMatrix('pf_matrix',pfScenario,pfSelectedHand);
  renderPfSummary(pfScenario);
  renderPfHandDetail(pfHand(pfScenario,pfSelectedHand));
  $('pf_dataset_note').textContent=pfDataset.note;
}
async function getPfScenario(id){
  if(pfCache.has(id))return pfCache.get(id);
  const result=await apiJSON('/api/preflop',{scenarioId:id},15000);
  pfDataset=result.dataset;
  pfScenarios=result.scenarios;
  pfCache.set(result.scenario.id,result.scenario);
  return result.scenario;
}
async function loadPreflop(scenarioId){
  const request=++pfRequest;
  ++pfCompareRequest;pfLoading=true;pfFailed=false;
  pfRequestedScenario=scenarioId||pfRequestedScenario;
  $('preflop').setAttribute('aria-busy','true');$('pf_retry').hidden=true;
  document.querySelectorAll('.pf-cell,.pf-action-button').forEach(button=>button.disabled=true);
  $('pf_next_hand').disabled=true;
  $('pf_status').textContent='Loading demonstration range…';
  try{
    const scenario=await getPfScenario(pfRequestedScenario);
    if(request!==pfRequest)return;
    pfLoading=false;
    pfScenario=scenario;
    fillPfScenarioSelects();
    renderPfLibrary();
    if(pfMode==='trainer')renderPfTrainer();
    else if(pfMode==='compare')renderPfCompare();
    else $('pf_status').textContent='Library ready · select a hand or change the scenario';
  }catch(error){if(request===pfRequest){pfLoading=false;pfFailed=true;$('pf_status').textContent=errorMessage(error);$('pf_retry').hidden=false;if(pfMode==='trainer')renderPfTrainer();}}
  finally{if(request===pfRequest)$('preflop').setAttribute('aria-busy','false');}
}
function activatePfMode(mode){
  pfMode=mode;
  document.querySelectorAll('.pf-mode').forEach(button=>{
    const active=button.dataset.pfMode===mode;
    button.setAttribute('aria-selected',String(active));
    button.tabIndex=active?0:-1;
  });
  document.querySelectorAll('.pf-view').forEach(view=>{view.hidden=view.id!==`pf-view-${mode}`;});
  $('pf_find_form').hidden=mode==='trainer';
  $('pf_find_result').hidden=true;
  if(mode==='compare')renderPfCompare();
  if(mode==='trainer')renderPfTrainer();
  if(mode==='library'&&pfScenario&&!pfLoading&&!pfFailed){renderPfLibrary();$('pf_status').textContent='Library ready · select a hand or change the scenario';}
}
async function renderPfCompare(){
  if(!pfScenarios.length||pfLoading||pfFailed)return;
  const request=++pfCompareRequest;
  $('pf_status').textContent='Loading compared ranges…';
  try{
    const [scenarioA,scenarioB]=await Promise.all([getPfScenario($('pf_compare_a').value),getPfScenario($('pf_compare_b').value)]);
    if(request!==pfCompareRequest)return;
    $('pf_compare_title_a').textContent=scenarioA.title;
    $('pf_compare_title_b').textContent=scenarioB.title;
    renderPfMatrix('pf_matrix_a',scenarioA,pfCompareHand);
    renderPfMatrix('pf_matrix_b',scenarioB,pfCompareHand);
    const handA=pfHand(scenarioA,pfCompareHand),handB=pfHand(scenarioB,pfCompareHand);
    const deltas=PF_ACTIONS.map(action=>({action,value:handB.actions[action]-handA.actions[action]}));
    const largest=[...deltas].sort((a,b)=>Math.abs(b.value)-Math.abs(a.value))[0];
    const direction=largest.value===0?'is unchanged':`${largest.value>0?'increases':'decreases'} ${Math.abs(largest.value)} pp`;
    $('pf_delta').innerHTML=`<h3 tabindex="-1">${pfCompareHand}: ${PF_LABELS[largest.action]} ${direction}</h3><p>Range B minus Range A. Frequencies are from the demonstration dataset.</p><div class="pf-delta-grid">`+
      deltas.map(delta=>`<div class="pf-delta-item"><span>${PF_LABELS[delta.action]}</span><strong>${delta.value>0?'+':''}${delta.value} pp</strong></div>`).join('')+'</div>';
    if(pfMode==='compare')$('pf_status').textContent='Comparison ready · select any hand in either matrix';
  }catch(error){if(request===pfCompareRequest&&pfMode==='compare')$('pf_status').textContent=errorMessage(error);}
}
function trainerScenario(){return pfScenario||pfCache.values().next().value;}
function renderPfSetNote(session){
  const answered=session.results.some(Boolean),finished=session.index>=session.items.length;
  const sizeText=size=>size===169?'all 169 hands':`${size} questions`;
  const keep=pfStorageOK?'Each scenario’s progress is saved in this browser; clearing site data removes it.':'This browser blocks saving, so progress lasts until you reload.';
  let note=`${pfSetDescription(session)} ${keep}`,offer=false;
  if(!session.retry&&session.size!==pfSetSize&&answered&&!finished){note=`This set keeps its ${sizeText(session.size)}; your next set will have ${sizeText(pfSetSize)}. ${keep}`;offer=true;}
  $('pf_set_note').textContent=note;
  $('pf_start_set').hidden=!offer;
  $('pf_start_set').textContent=`Start a set of ${sizeText(pfSetSize)} now`;
  $('pf_set_size').value=String(pfSetSize);
}
function renderPfTrainerStats(session){
  const stats=pfSessionStats(session);
  $('pf_stat_progress').textContent=`${stats.answered} / ${stats.total}`;
  $('pf_stat_inrange').textContent=stats.actionTotal?`${stats.actionInRange} / ${stats.actionTotal}`:'—';
  $('pf_stat_frequency').textContent=stats.frequencyTotal?`${stats.frequencyCorrect} / ${stats.frequencyTotal}`:'—';
  $('pf_stat_mixed').textContent=String(stats.mixedSeen);
  return stats;
}
function renderPfReview(scenario,session,stats,previous=false){
  $('pf_review_title').textContent=(previous?'Previous ':'')+(session.retry?(previous?'retry':'Retry complete'):(previous?'set':'Set complete'))+(previous?' · review':'');
  $('pf_review_back').hidden=!previous;$('pf_retry_missed').hidden=previous;$('pf_new_set').hidden=previous;
  const parts=[];
  if(stats.actionTotal)parts.push(`${stats.actionInRange} of ${stats.actionTotal} action choices in range`);
  if(stats.frequencyTotal)parts.push(`${stats.frequencyCorrect} of ${stats.frequencyTotal} frequency questions correct`);
  parts.push(`${stats.mixedSeen} mixed-strategy hand${stats.mixedSeen===1?'':'s'} seen`);
  $('pf_review_summary').textContent=`${scenario.title}: ${parts.join(' · ')}.`;
  $('pf_review_rows').innerHTML=session.items.map((item,index)=>{
    const result=session.results[index],hand=pfHand(scenario,item.hand),frequency=item.kind==='frequency';
    const verdict=frequency?(result.ok?'Correct':`Off by ${Math.abs(result.answer-hand.actions[item.action])} pp`):(result.ok?(result.mixed?'In range · mixed':'In range'):'Not in range');
    const origin=item.origin==='added'?' · added':item.origin==='missed'?' · retry':'';
    return `<tr data-ok="${result.ok}"><td>${index+1}</td><th scope="row">${hand.hand}</th><td>${frequency?`How often ${PF_LABELS[item.action]}?`:'Action'}${origin}</td>`+
      `<td>${frequency?pfFrequencyLabel(result.answer):PF_LABELS[result.answer]}</td><td>${pfMixText(hand)}</td><td>${verdict}</td></tr>`;
  }).join('');
  const missed=stats.missed.length;
  $('pf_retry_missed').disabled=!missed;
  $('pf_retry_missed').textContent=missed?`Retry ${missed} missed`:'Nothing missed';
  $('pf_new_set').textContent=pfSetSize===169?'New 169-hand set':`New ${pfSetSize}-question set`;
  $('pf_status').textContent=previous?'Previous set · review':`Review · ${missed} missed of ${stats.total}`;
}
function renderPfSideExtras(scenario){
  const previous=pfPreviousReviews.get(scenario.id);
  $('pf_previous').hidden=!previous||pfViewingPrevious;
  if(previous){
    const stats=pfSessionStats(previous),parts=[];
    if(stats.actionTotal)parts.push(`${stats.actionInRange}/${stats.actionTotal} in range`);
    if(stats.frequencyTotal)parts.push(`${stats.frequencyCorrect}/${stats.frequencyTotal} frequency`);
    $('pf_previous_text').textContent=`Previous ${previous.retry?'retry':'set'}: ${parts.join(' · ')} · ${stats.missed.length} missed.`;
  }
  const resume=pfResumePending.has(scenario.id)?pfSessions.get(scenario.id):null;
  $('pf_resume').hidden=!resume;
  if(resume){
    const when=new Date(resume.updatedAt),stats=pfSessionStats(resume);
    $('pf_resume_text').textContent=`You have an unfinished set${Number.isNaN(when.getTime())?'':` from ${when.toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}`}: ${stats.answered} of ${stats.total} answered.`;
  }
}
function renderPfTrainer(){
  const scenario=trainerScenario();
  if(!scenario||pfLoading||pfFailed){
    document.querySelectorAll('.pf-action-button').forEach(button=>button.disabled=true);
    $('pf_frequency_options').hidden=true;$('pf_frequency_options').innerHTML='';
    $('pf_next_hand').disabled=true;$('pf_next_hand').textContent='Choose an answer first';
    $('pf_trainer_guidance').textContent=pfFailed?'Range unavailable. Retry loading above.':'Loading the training scenario…';
    return;
  }
  const session=pfSessionFor(scenario);
  $('pf_trainer_scenario').textContent=scenario.title+' · Demo strategy dataset';
  renderPfContext(scenario,'pf_trainer_context');
  renderPfSetNote(session);
  const stats=renderPfTrainerStats(session);
  if(pfViewingPrevious&&!pfPreviousReviews.has(scenario.id))pfViewingPrevious=false;
  renderPfSideExtras(scenario);
  const reviewing=session.index>=session.items.length||pfViewingPrevious;
  $('pf_question').hidden=reviewing;$('pf_review').hidden=!reviewing;
  if(pfViewingPrevious){const previous=pfPreviousReviews.get(scenario.id);renderPfReview(scenario,previous,pfSessionStats(previous),true);return;}
  if(reviewing){renderPfReview(scenario,session,stats);return;}
  const item=session.items[session.index],hand=pfHand(scenario,item.hand),result=session.results[session.index];
  const frequency=item.kind==='frequency',last=session.index===session.items.length-1;
  $('pf_question_count').textContent=`Question ${session.index+1} of ${session.items.length}${session.retry?' · retrying missed':''}`;
  $('pf_trainer_cards').innerHTML=pfCardHtml(hand.hand);
  $('pf_trainer_hand').textContent=hand.hand;
  $('pf_question_prompt').textContent=frequency?`In this demo range, how often is ${hand.hand} played as ${PF_LABELS[item.action]}?`:'What is your decision?';
  const availability=pfScenarioAvailability(scenario);
  $('pf_decision_actions').hidden=frequency;
  document.querySelectorAll('.pf-action-button').forEach(button=>{
    const unavailable=!availability[button.dataset.action];
    button.disabled=Boolean(result)||unavailable||frequency;
    button.hidden=unavailable;
    button.classList.toggle('is-chosen',!frequency&&result?.answer===button.dataset.action);
    button.classList.toggle('is-unavailable',unavailable);
    button.title=unavailable?'This action is not available in the selected scenario.':'';
  });
  $('pf_decision_actions').style.setProperty('--pf-choice-count',PF_ACTIONS.filter(action=>availability[action]).length);
  $('pf_frequency_options').hidden=!frequency;
  $('pf_frequency_options').innerHTML=frequency?item.options.map(value=>`<button type="button" class="pf-frequency-option${result?.answer===value?' is-chosen':''}" data-frequency="${value}"${result?' disabled':''}>${pfFrequencyLabel(value)}</button>`).join(''):'';
  $('pf_trainer_bar').innerHTML=PF_ACTIONS.filter(action=>hand.actions[action]>0).map(action=>`<span style="width:${hand.actions[action]}%;background:${PF_COLORS[action]}"></span>`).join('');
  $('pf_trainer_bar').setAttribute('aria-label',pfActionAria(hand));
  $('pf_trainer_bar').hidden=!result;
  if(result){
    const feedback=pfFeedback(item,result,hand);
    $('pf_feedback').className=`pf-feedback is-visible${result.ok?'':' is-miss'}`;
    $('pf_feedback').innerHTML=`<strong>${feedback.title}</strong><p>${feedback.body}</p>`;
  }else{$('pf_feedback').className='pf-feedback';$('pf_feedback').innerHTML='';}
  $('pf_trainer_guidance').textContent=result?hand.guidance:frequency?'Pick the frequency you expect. The full mix appears after you answer.':'Choose an action to reveal the demonstration frequencies.';
  $('pf_next_hand').disabled=!result;
  $('pf_next_hand').textContent=result?(last?'See review':'Next question'):'Choose an answer first';
  $('pf_status').textContent=result?(last?'Set finished · choose See review':'Answer recorded · choose Next question'):`Trainer ready · question ${session.index+1} of ${session.items.length}`;
}
function answerPfTrainer(answer){
  if(pfLoading||pfFailed)return;
  const scenario=trainerScenario();if(!scenario)return;
  const session=pfSessionFor(scenario),item=session.items[session.index];
  if(!item||session.results[session.index])return;
  const result=pfScoreAnswer(item,pfHand(scenario,item.hand),answer,pfScenarioAvailability(scenario));
  if(!result)return;
  session.results[session.index]=result;
  pfResumePending.delete(scenario.id);pfTouch(session);
  renderPfTrainer();
  $('pf_next_hand').focus?.();
}
function nextPfTrainerHand(){
  if(pfLoading||pfFailed)return;
  const scenario=trainerScenario();if(!scenario)return;
  const session=pfSessionFor(scenario);
  if(session.index>=session.items.length||!session.results[session.index])return;
  session.index+=1;pfTouch(session);
  renderPfTrainer();
  if(session.index>=session.items.length)$('pf_review_title').focus?.();
  else document.querySelector?.('#pf_decision_actions:not([hidden]) .pf-action-button:not([hidden]):not(:disabled), #pf_frequency_options:not([hidden]) button')?.focus();
}
function retryPfMissed(){
  const scenario=trainerScenario();if(!scenario||pfLoading||pfFailed)return;
  const missed=pfSessionStats(pfSessionFor(scenario)).missed;
  if(!missed.length)return;
  pfReplaceSession(scenario,pfNewSession(scenario,missed.map(item=>({...item,origin:'missed'})),true));
  renderPfTrainer();
}
function newPfSet(){
  const scenario=trainerScenario();if(!scenario||pfLoading||pfFailed)return;
  pfStartNewSet(scenario);renderPfTrainer();
}
// "Practice this spot": make the hand the next question of the current set
// without discarding progress (a finished set starts a new one first).
function practicePfHand(name){
  const scenario=trainerScenario();if(!scenario||!scenario.hands.some(hand=>hand.hand===name))return;
  let session=pfSessionFor(scenario);
  if(session.index>=session.items.length)session=pfStartNewSet(scenario);
  const at=session.results[session.index]?session.index+1:session.index;
  const existing=session.items.findIndex((item,index)=>index>=at&&item.hand===name&&!session.results[index]);
  const item=existing>=0?session.items.splice(existing,1)[0]:{hand:name,kind:'action',origin:'added'};
  if(existing>=0)session.results.splice(existing,1);
  session.items.splice(at,0,item);session.results.splice(at,0,null);
  session.index=at;pfResumePending.delete(scenario.id);pfViewingPrevious=false;pfTouch(session);
}
function selectPfHand(name,sourceId){
  pfSelectedHand=name;pfCompareHand=name;
  setPfCardsFromClass(name);
  $('pf_change_status').textContent='Click either card, or choose Change hand, to select exact cards.';
  if(sourceId==='pf_matrix')renderPfLibrary();
  else renderPfCompare();
}

const pfModeButtons=[...document.querySelectorAll('.pf-mode')];
pfModeButtons.forEach((button,index)=>{
  button.addEventListener('click',()=>activatePfMode(button.dataset.pfMode));
  button.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?pfModeButtons.length-1:(index+(event.key==='ArrowRight'?1:-1)+pfModeButtons.length)%pfModeButtons.length;
    pfModeButtons[next].focus();activatePfMode(pfModeButtons[next].dataset.pfMode);
  });
});
['pf_scenario','pf_trainer_select'].forEach(id=>$(id).addEventListener('change',()=>{pfViewingPrevious=false;loadPreflop($(id).value);}));
$('pf_retry').addEventListener('click',()=>loadPreflop(pfRequestedScenario));
['pf_compare_a','pf_compare_b'].forEach(id=>$(id).addEventListener('change',renderPfCompare));
$('pf_swap').addEventListener('click',()=>{const a=$('pf_compare_a').value;$('pf_compare_a').value=$('pf_compare_b').value;$('pf_compare_b').value=a;renderPfCompare();});
['pf_matrix','pf_matrix_a','pf_matrix_b'].forEach(id=>$(id).addEventListener('click',event=>{const cell=event.target.closest('[data-pf-hand]');if(cell&&!pfLoading&&!pfFailed){$('pf_find_result').hidden=cell.dataset.pfHand!==$('pf_find_result').dataset.hand||$('pf_find_result').hidden;selectPfHand(cell.dataset.pfHand,id);}}));
function handlePfMatrixKey(event){
  const cell=event.target.closest('.pf-cell');if(!cell)return;
  const next=pfMatrixMove(Number(cell.dataset.row),Number(cell.dataset.column),event.key);
  if(!next)return;
  event.preventDefault();
  const target=event.currentTarget.querySelector(`[data-row="${next[0]}"][data-column="${next[1]}"]`);
  if(!target||target===cell)return;
  event.currentTarget.querySelectorAll('.pf-cell[tabindex="0"]').forEach(other=>{other.tabIndex=-1;});
  target.tabIndex=0;target.focus();
}
['pf_matrix','pf_matrix_a','pf_matrix_b'].forEach(id=>$(id).addEventListener('keydown',handlePfMatrixKey));
$('pf_find_form').addEventListener('submit',event=>{
  event.preventDefault();
  const parsed=pfParseHand($('pf_find').value);
  if(parsed.error){$('pf_find_status').textContent=parsed.error;return;}
  if(!pfScenario||pfLoading||pfFailed){$('pf_find_status').textContent='The range is still loading.';return;}
  $('pf_find').value=parsed.hand;
  selectPfHand(parsed.hand,pfMode==='compare'?'pf_matrix_a':'pf_matrix');
  $('pf_find_status').textContent='';
  // A one-line answer right under the search box, so phones need no scrolling to see it.
  const mix=scenario=>pfMixText(pfHand(scenario,parsed.hand)).replace(/, /g,' / ');
  const scenarioA=pfCache.get($('pf_compare_a').value)||pfScenario,scenarioB=pfCache.get($('pf_compare_b').value)||pfScenario;
  $('pf_find_summary').textContent=pfMode==='compare'?`${parsed.hand} · A: ${mix(scenarioA)} · B: ${mix(scenarioB)}`:`${parsed.hand} · ${mix(pfScenario)}`;
  $('pf_find_result').hidden=false;$('pf_find_result').dataset.hand=parsed.hand;
});
$('pf_find_details').addEventListener('click',()=>{
  const target=pfMode==='compare'?$('pf_delta'):document.querySelector('.pf-detail');
  target?.scrollIntoView({behavior:reducedMotion()?'auto':'smooth',block:'start'});
  // Move focus with the view, so keyboard and screen-reader users land on the details too.
  (pfMode==='compare'?$('pf_delta').querySelector('h3'):$('pf_hand_name'))?.focus({preventScroll:true});
});
$('pf_find_locate').addEventListener('click',()=>{
  const hand=$('pf_find_result').dataset.hand;
  $(pfMode==='compare'?'pf_matrix_a':'pf_matrix').querySelector(`[data-pf-hand="${hand}"]`)?.focus();
});
// On phones the long scenario description starts folded.
if(typeof matchMedia==='function'&&matchMedia('(max-width:600px)').matches)$('pf_meta_details').open=false;
// In the one-column layout the hand details sit above the matrix. Move the element
// itself rather than using CSS order, so Tab and screen-reader order match the screen.
function placePfDetail(narrow){
  const library=document.querySelector('.pf-library'),detail=library?.querySelector(':scope>.pf-detail'),main=library?.querySelector(':scope>.pf-main');
  if(!detail||!main)return;
  const active=detail.contains(document.activeElement)?document.activeElement:null;
  if(narrow)library.insertBefore(detail,main);else main.after(detail);
  active?.focus({preventScroll:true});
}
if(typeof matchMedia==='function'){
  const oneColumn=matchMedia('(max-width:900px)');
  placePfDetail(oneColumn.matches);oneColumn.addEventListener('change',event=>placePfDetail(event.matches));
}
$('pf_compare_hand').addEventListener('click',()=>{pfCompareHand=pfSelectedHand;activatePfMode('compare');});
$('pf_change_hand').addEventListener('click',()=>{
  cardState.pf0=null;cardState.pf1=null;renderPfHandSlots();
  $('pf_change_status').textContent='Choose your first card; the second card picker opens automatically.';
  openPicker('pf0');
});
$('pf_practice_hand').addEventListener('click',()=>{practicePfHand(pfSelectedHand);activatePfMode('trainer');});
$('pf_decision_actions').addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(button)answerPfTrainer(button.dataset.action);});
$('pf_frequency_options').addEventListener('click',event=>{const button=event.target.closest('[data-frequency]');if(button)answerPfTrainer(Number(button.dataset.frequency));});
$('pf_next_hand').addEventListener('click',nextPfTrainerHand);
$('pf_retry_missed').addEventListener('click',retryPfMissed);
$('pf_new_set').addEventListener('click',newPfSet);
$('pf_start_set').addEventListener('click',newPfSet);
$('pf_set_size').addEventListener('change',()=>{
  pfSetSize=Number($('pf_set_size').value);
  const scenario=trainerScenario();if(!scenario||pfLoading||pfFailed)return;
  const session=pfSessionFor(scenario);
  // Only replace a set that has no answers yet or is finished; otherwise the
  // new size applies to the next set and the note offers to start it now.
  if(!session.results.some(Boolean)||session.index>=session.items.length)pfStartNewSet(scenario);
  else savePfProgress();
  renderPfTrainer();
});
$('pf_resume_continue').addEventListener('click',()=>{
  const scenario=trainerScenario();if(!scenario)return;
  pfResumePending.delete(scenario.id);renderPfTrainer();
  document.querySelector('#pf_decision_actions:not([hidden]) .pf-action-button:not([hidden]):not(:disabled), #pf_frequency_options:not([hidden]) button, #pf_next_hand:not(:disabled)')?.focus();
});
$('pf_resume_new').addEventListener('click',newPfSet);
$('pf_previous_view').addEventListener('click',()=>{pfViewingPrevious=true;renderPfTrainer();$('pf_review_title').focus();});
$('pf_review_back').addEventListener('click',()=>{pfViewingPrevious=false;renderPfTrainer();$('pf_previous_view').focus();});
loadPfProgress();
$('pf_view_range').addEventListener('click',()=>{
  const scenario=trainerScenario(),session=scenario&&pfSessionFor(scenario);
  const item=session?.items[Math.min(session.index,session.items.length-1)];
  if(item)pfSelectedHand=item.hand;
  setPfCardsFromClass(pfSelectedHand);activatePfMode('library');renderPfLibrary();
});

/* ================= RISK LAB (research dashboard) ================= */
const LAB_QUICK_PATHS=2000;
const LAB_DETAILED_PATHS=16000;
function labParams(paths,includeCurve=true){return {wr:+$('lab_wr').value,sd:+$('lab_sd').value,bank:(+$('lab_bank').value)*100,thr:0,
  hands:Math.round(+$('lab_hn').value),paths:paths,seed:labSeed,includeCurve};}
// The seed comes from a loaded comparison when there is one; presets and Clear restore 42.
let labSeed=42;
let labHasResult=false;
let labCurrentResult=null;
let labSavedA=null;
let labLoadCheck=null;
const LAB_INPUTS=[['Win rate (bb/100)','wr',v=>v.toFixed(1)],['Bankroll (BI)','bank',v=>(v/100).toFixed(0)],
  ['Swings (bb/100)','sd',v=>v.toFixed(0)],['Horizon (hands)','hands',v=>v.toLocaleString()]];
function labChangedInputs(a,b){return LAB_INPUTS.filter(([,key])=>a[key]!==b[key]).map(([label])=>label.replace(/ \(.*/,''));}
// Step of the four-step comparison guide: save A → change one input → compare (B running) → read B − A.
function labGuideStage(savedA,current,controls,liveState){
  if(!savedA)return 'save';
  if(!labChangedInputs(savedA.params,controls).length)return 'change';
  return liveState==='current'&&current&&!labChangedInputs(current.params,controls).length?'read':'compare';
}
function labDefaultName(params){return `${params.bank/100} BI · ${params.wr} bb/100 · ${params.sd} swings · ${Math.round(params.hands/1000)}k hands`;}
function labScenarioRecord(name,result){
  const p=result.params,m=result.metrics;
  return {name,
    inputs:{winrate_bb100:p.wr,std_bb100:p.sd,bankroll_bi:p.bank/100,ruin_threshold_bi:p.thr/100,hands:p.hands,paths:p.paths,seed:p.seed},
    results:{risk_of_ruin:m.risk,ci95_low:m.confidenceInterval[0],ci95_high:m.confidenceInterval[1],survival:m.survival,p95_max_drawdown_bi:m.p95Drawdown},
    model:result.model||null};
}
// Everything needed to understand a comparison later: inputs, results, seed and engine version.
function labComparisonRecord(nameA,a,nameB,b,savedAt){
  return {type:'poker-analytics/risk-lab-comparison',schema_version:1,saved_at:savedAt,
    a:labScenarioRecord(nameA,a),b:labScenarioRecord(nameB,b),
    difference:{risk_b_minus_a_pp:(b.metrics.risk-a.metrics.risk)*100,changed_inputs:labChangedInputs(a.params,b.params),
      note:'Difference of point estimates. Intervals describe Monte Carlo error only; no interval or significance test is given for the difference.'}};
}
function labComparisonCSV(record){
  // Text cells that start like a formula are prefixed so spreadsheets show them as text.
  const cell=value=>{
    if(value==null)return '';
    let text=String(value);
    if(typeof value==='string'&&/^[=+\-@]/.test(text))text="'"+text;
    return /[",\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;
  };
  const rows=[['field','A','B'],['name',record.a.name,record.b.name]];
  Object.keys(record.a.inputs).forEach(key=>rows.push([`input.${key}`,record.a.inputs[key],record.b.inputs[key]]));
  Object.keys(record.a.results).forEach(key=>rows.push([`result.${key}`,record.a.results[key],record.b.results[key]]));
  rows.push(['model.version',record.a.model?.version,record.b.model?.version],
    ['model.ruin_monitoring',record.a.model?.ruinMonitoring,record.b.model?.ruinMonitoring],
    ['difference.risk_b_minus_a_pp',record.difference.risk_b_minus_a_pp,''],
    ['difference.changed_inputs',record.difference.changed_inputs.join('; '),''],
    ['saved_at',record.saved_at,'']);
  return rows.map(row=>row.map(cell).join(',')).join('\n')+'\n';
}
// Why saved inputs cannot be put back into the Risk Lab controls ('' when they can).
function labInputsProblem(inputs){
  const fits=(value,low,high,step)=>value>=low&&value<=high&&Math.abs((value-low)/step-Math.round((value-low)/step))<1e-9;
  if(inputs.ruin_threshold_bi!==0)return 'Risk Lab uses a ruin threshold of 0 BI.';
  if(!fits(inputs.winrate_bb100,-5,10,0.5))return 'the win rate must be −5 to 10 bb/100 in steps of 0.5.';
  if(!fits(inputs.bankroll_bi,5,60,1))return 'the bankroll must be 5 to 60 BI.';
  if(!fits(inputs.std_bb100,60,160,5))return 'the swings must be 60 to 160 bb/100 in steps of 5.';
  if(!fits(inputs.hands,20000,300000,20000))return 'the horizon must be 20k to 300k hands in steps of 20k.';
  if(!Number.isInteger(inputs.paths)||inputs.paths<100||inputs.paths>40000)return 'paths must be 100 to 40,000.';
  if(!Number.isInteger(inputs.seed)||inputs.seed<-2147483648||inputs.seed>2147483647)return 'the seed must be a 32-bit integer.';
  return '';
}
const LAB_INPUT_KEYS=['winrate_bb100','std_bb100','bankroll_bi','ruin_threshold_bi','hands','paths','seed'];
const LAB_RESULT_KEYS=['risk_of_ruin','ci95_low','ci95_high','survival','p95_max_drawdown_bi'];
const LAB_MODEL_KEYS=['name','version','increments','ruinMonitoring','randomNumbers'];
// Check an imported comparison file and keep only the fields this page understands.
// Values a saved comparison cannot hold: probabilities outside 0-1, an interval
// that is reversed or misses its estimate, survival that is not 1 - risk, a
// negative drawdown, or inputs no simulation could have used.
function labRecordProblem(inputs,results){
  const close=(x,y)=>Math.abs(x-y)<=1e-9;
  const {risk_of_ruin:risk,ci95_low:low,ci95_high:high,survival}=results;
  const outside=['risk_of_ruin','ci95_low','ci95_high','survival'].find(k=>results[k]<0||results[k]>1);
  if(outside)return `${outside} must be between 0 and 1.`;
  if(!(low<=risk+1e-9&&risk<=high+1e-9))return 'the 95% interval must run from ci95_low up to ci95_high and contain risk_of_ruin.';
  if(!close(risk+survival,1))return 'survival must equal 1 − risk_of_ruin.';
  if(results.p95_max_drawdown_bi<0)return 'p95_max_drawdown_bi cannot be negative.';
  if(!(inputs.std_bb100>=0))return 'std_bb100 cannot be negative.';
  if(!(inputs.ruin_threshold_bi>=0&&inputs.bankroll_bi>inputs.ruin_threshold_bi))return 'bankroll_bi must be above ruin_threshold_bi, which cannot be negative.';
  if(!(inputs.hands>=1&&inputs.paths>=1&&Number.isInteger(inputs.paths)))return 'hands and paths must be positive, and paths a whole number.';
  return '';
}
function labValidateRecord(value){
  if(!value||typeof value!=='object'||value.type!=='poker-analytics/risk-lab-comparison'||value.schema_version!==1)
    return {error:'this file is not a Risk Lab comparison (expected type poker-analytics/risk-lab-comparison, schema 1).'};
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const sides={};
  for(const key of ['a','b']){
    const side=value[key],label=key.toUpperCase();
    if(!side||typeof side!=='object'||typeof side.name!=='string'||!side.inputs||!side.results)return {error:`${label} is missing its name, inputs or results.`};
    const bad=LAB_INPUT_KEYS.find(k=>!finite(side.inputs[k]))||LAB_RESULT_KEYS.find(k=>!finite(side.results[k]));
    if(bad)return {error:`${label}: ${bad} is missing or not a number.`};
    const problem=labRecordProblem(side.inputs,side.results);
    if(problem)return {error:`${label}: ${problem}`};
    const model=side.model&&typeof side.model==='object'?Object.fromEntries(LAB_MODEL_KEYS.filter(k=>typeof side.model[k]==='string').map(k=>[k,side.model[k].slice(0,160)])):null;
    sides[key]={name:side.name.slice(0,80),inputs:Object.fromEntries(LAB_INPUT_KEYS.map(k=>[k,side.inputs[k]])),
      results:Object.fromEntries(LAB_RESULT_KEYS.map(k=>[k,side.results[k]])),model:model&&Object.keys(model).length?model:null};
  }
  // Recomputed from the inputs; the file's own list is not trusted.
  const asParams=i=>({wr:i.winrate_bb100,sd:i.std_bb100,bank:i.bankroll_bi*100,hands:i.hands});
  const changed=labChangedInputs(asParams(sides.a.inputs),asParams(sides.b.inputs));
  return {record:{type:value.type,schema_version:1,saved_at:typeof value.saved_at==='string'?value.saved_at.slice(0,40):'',a:sides.a,b:sides.b,
    difference:{risk_b_minus_a_pp:(sides.b.results.risk_of_ruin-sides.a.results.risk_of_ruin)*100,changed_inputs:changed,
      note:'Difference of point estimates. Intervals describe Monte Carlo error only; no interval or significance test is given for the difference.'}}};
}
// Calculation engine versions (result.model.version from the server) after which the
// same inputs and seed give different numbers, and what changed in each.
const ENGINE_UPDATES=[{version:'2026-10-21',change:'ruin monitoring and random-number streams changed'}];
// After a load: what was recomputed, how it compares with the saved values, and under
// which calculation engine. "Engine", not "model": the model is the user's assumptions.
function labLoadMessage(name,checks,currentVersion){
  const pct=v=>(v*100).toFixed(2)+'%';
  const parts=checks.map(c=>Math.abs(c.now-c.saved)<1e-12?`${c.side} matches the saved ${pct(c.saved)}`:`${c.side} is ${pct(c.now)} now (saved ${pct(c.saved)})`);
  const versions=[...new Set(checks.map(c=>c.savedVersion||'unknown'))];
  const known=versions.filter(v=>v!=='unknown');
  const older=versions.some(v=>v!==currentVersion);
  const differs=checks.some(c=>Math.abs(c.now-c.saved)>=1e-12);
  let note='';
  if(older){
    const updates=ENGINE_UPDATES.filter(u=>u.version<=currentVersion&&(known.length<versions.length||known.some(v=>u.version>v)));
    note=(known.length?` It was saved with calculation engine ${versions.join(' / ')}.`:' The file does not say which calculation engine produced it.')+
      (updates.length?` The engine has been updated since (${updates.map(u=>`${u.version}: ${u.change}`).join('; ')}), so`:' With a different engine version,')+
      ' the numbers can differ although no input changed. The saved values stay under View saved results.';
  }else if(differs){
    note=' The recomputed values do not match the saved record, although the engine version and seeds are the same. Check the inputs, engine version and file contents; one possible cause is that the file was edited after saving.';
  }
  return `Loaded “${name}”. Recomputed with calculation engine ${currentVersion}: ${parts.join('; ')}.`+note;
}
const labSlug=text=>String(text).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'scenario';
function renderLabComparison(){
  if(!labSavedA||!labCurrentResult){$('lab_compare').hidden=true;return;}
  const a=labSavedA,b=labCurrentResult;
  $('lab_compare').hidden=false;
  $('lab_compare').dataset.state='current';
  $('lab_compare').setAttribute('aria-busy','false');
  $('lab_compare_state').textContent='A is saved. B follows the current simulation.';
  $('lab_a_risk').textContent=(a.metrics.risk*100).toFixed(1)+'%';
  $('lab_b_risk').textContent=(b.metrics.risk*100).toFixed(1)+'%';
  const interval=r=>`95% MC: ${r.metrics.confidenceInterval.map(v=>(v*100).toFixed(1)).join('–')}%`;
  $('lab_a_ci').textContent=interval(a);$('lab_b_ci').textContent=interval(b);
  const rows=LAB_INPUTS;
  const changes=rows.filter(([,key])=>a.params[key]!==b.params[key]);
  if(!$('lab_b_name').dataset.edited)$('lab_b_name').value='B · '+labDefaultName(b.params);
  setLabCompareActions(true);
  $('lab_compare_inputs').innerHTML=rows.map(([label,key,format])=>`<tr data-changed="${a.params[key]!==b.params[key]}"><th scope="row">${label}</th><td>${format(a.params[key])}</td><td>${format(b.params[key])}</td></tr>`).join('');
  const delta=(b.metrics.risk-a.metrics.risk)*100;
  const changedText=changes.length?`Changed: ${changes.map(row=>row[0].replace(/ \(.*/, '')).join(', ')}.`:'The scenario assumptions are identical.';
  $('lab_compare_delta').textContent=`B − A risk: ${signedValue(delta)} percentage points. ${changedText}`;
  $('lab_compare_precision').textContent=`A: ${a.params.paths.toLocaleString()} paths, seed ${a.params.seed} · B: ${b.params.paths.toLocaleString()} paths, seed ${b.params.seed}. ${changes.length>1?'Several inputs changed; this comparison cannot isolate one driver.':'Change one input at a time to examine its sensitivity.'}`;
  if(!plotlyReady()){chartUnavailable('lab_compare_chart');return;}
  const traces=[];
  [[a,C.median,'Saved A',tint(C.median,.12)],[b,C.accent,'Current B',tint(C.accent,.12)]].forEach(([r,color,name,fill])=>{
    const f=r.fan;
    traces.push({x:f.xs.concat(f.xs.slice().reverse()),y:f.p75.concat(f.p25.slice().reverse()),fill:'toself',fillcolor:fill,line:{color:'transparent'},hoverinfo:'skip',showlegend:false});
    traces.push({x:f.xs,y:f.p50,mode:'lines',name,line:{color,width:2.5},hovertemplate:`${name} median<br>%{x:,} hands<br>%{y:.1f} BI<extra></extra>`});
  });
  const lay=layout('','Hands played','Bankroll (BI)');
  lay.margin={l:52,r:12,t:38,b:48};lay.legend={orientation:'h',x:0,y:1.16,font:{color:C.muted,size:12}};
  lay.xaxis.tickformat='~s';lay.xaxis.fixedrange=true;lay.yaxis.fixedrange=true;lay.yaxis.rangemode='tozero';
  $('lab_compare_chart').setAttribute('aria-label',`Saved A risk ${(a.metrics.risk*100).toFixed(1)} percent; current B risk ${(b.metrics.risk*100).toFixed(1)} percent. ${changedText} Lines show median paths with middle 50 percent bands.`);
  Plotly.react('lab_compare_chart',traces,lay,CFG);
}
function setLabCompareActions(enabled){['lab_save_comparison','lab_export_json','lab_export_csv'].forEach(id=>{$(id).disabled=!enabled;});}
function openLabAssumptions(){$('lab_adjust').open=true;$('lab_adjust').scrollIntoView({behavior:reducedMotion()?'auto':'smooth',block:'start'});$('lab_wr').focus({preventScroll:true});}
function showLabComparison(){if(!$('lab_compare').hidden)$('lab_compare').scrollIntoView({behavior:reducedMotion()?'auto':'smooth',block:'start'});}
function setLabSavedA(snapshot,name){
  labSavedA=snapshot;
  $('lab_a_name').value=name||'A · '+labDefaultName(snapshot.params);delete $('lab_a_name').dataset.edited;
  delete $('lab_b_name').dataset.edited;
  $('lab_save_a').textContent='Replace A with this result';
  $('lab_save_hint').textContent='A saved. Change one assumption; the comparison with B appears below.';
  $('lab_save_next').hidden=false;$('lab_view_compare').hidden=false;
}
// Saving A no longer jumps away: the next step is offered right here.
$('lab_save_a').addEventListener('click',()=>{
  if(!labCurrentResult||$('lab_live').dataset.state!=='current')return;
  setLabSavedA(structuredClone(labCurrentResult));
  renderLabComparison();renderLabGuide();
});
$('lab_clear_a').addEventListener('click',()=>{
  labSavedA=null;labSeed=42;$('lab_compare').hidden=true;$('lab_save_a').textContent='Save this result as A';
  $('lab_save_hint').textContent='';
  $('lab_save_next').hidden=true;$('lab_view_compare').hidden=true;
  renderLabGuide();$('lab_save_a').focus();
});
$('lab_edit_b').addEventListener('click',openLabAssumptions);
$('lab_save_next').addEventListener('click',openLabAssumptions);
$('lab_view_compare').addEventListener('click',showLabComparison);
['lab_a_name','lab_b_name'].forEach(id=>$(id).addEventListener('input',()=>{$(id).dataset.edited='true';}));

/* Four-step guide for first-time visitors. Hiding it is remembered in this browser only. */
const LAB_GUIDE_STEPS=['save','change','compare','read'];
const LAB_GUIDE_KEY='poker-analytics.risk-lab-guide-hidden';
function renderLabGuide(){
  const controls=labParams(0),stage=labGuideStage(labSavedA,labCurrentResult,controls,$('lab_live').dataset.state);
  const at=LAB_GUIDE_STEPS.indexOf(stage);
  // A step's button hides once the step is done; keep keyboard focus in the guide.
  const focused=document.activeElement,stepButtonFocused=focused?.closest?.('.lab-guide-steps li')&&focused.tagName==='BUTTON';
  LAB_GUIDE_STEPS.forEach((step,index)=>{
    const item=$(`lab_step_${step}`),status=index<at?'done':index===at?'current':'todo';
    item.dataset.status=status;
    if(status==='current')item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');
  });
  if(stage==='read'){
    const changed=labChangedInputs(labSavedA.params,labCurrentResult.params);
    const delta=(labCurrentResult.metrics.risk-labSavedA.metrics.risk)*100;
    $('lab_guide_result').textContent=`B − A: ${signedValue(delta)} percentage points after changing ${changed.join(', ').toLowerCase()}. That is how sensitive this model is to the assumption, not a measured real-world effect.${changed.length>1?' Several inputs changed, so the difference cannot be attributed to one of them.':''}`;
  }else $('lab_guide_result').textContent='B − A shows how much the model’s risk moves when one assumption changes.';
  $('lab_guide_save').disabled=$('lab_save_a').disabled;
  if(stepButtonFocused&&focused.closest('li').dataset.status!=='current')($(`lab_step_${stage}`).querySelector('.btn')||$('lab_guide_result')).focus();
}
function setLabGuideHidden(hidden,remember=true){
  $('lab_guide').hidden=hidden;$('lab_guide_show').hidden=!hidden;
  if(remember){try{if(hidden)localStorage.setItem(LAB_GUIDE_KEY,'1');else localStorage.removeItem(LAB_GUIDE_KEY);}catch{}}
}
$('lab_guide_hide').addEventListener('click',()=>{setLabGuideHidden(true);$('lab_guide_show').focus();});
$('lab_guide_show').addEventListener('click',()=>{setLabGuideHidden(false);$('lab_guide_hide').focus();});
$('lab_guide_save').addEventListener('click',()=>{if(!$('lab_save_a').disabled)$('lab_save_a').click();});
$('lab_guide_change').addEventListener('click',openLabAssumptions);
$('lab_guide_compare').addEventListener('click',showLabComparison);
{let hidden=false;try{hidden=localStorage.getItem(LAB_GUIDE_KEY)==='1';}catch{}setLabGuideHidden(hidden,false);}

/* Saved comparisons live in this browser's storage; downloads carry the same record. */
const LAB_STORE_KEY='poker-analytics.risk-lab-comparisons.v1';
const LAB_STORE_LIMIT=20;
function readLabSaved(){try{const list=JSON.parse(localStorage.getItem(LAB_STORE_KEY)||'[]');return Array.isArray(list)?list:[];}catch{return null;}}
function writeLabSaved(list){try{localStorage.setItem(LAB_STORE_KEY,JSON.stringify(list));return true;}catch{return false;}}
function currentLabRecord(){
  if(!labSavedA||!labCurrentResult)return null;
  return labComparisonRecord($('lab_a_name').value.trim()||'A',labSavedA,$('lab_b_name').value.trim()||'B',labCurrentResult,new Date().toISOString());
}
const labSavedOpen=new Set();   // entries whose saved results are expanded
function labSavedDetail(entry){
  const r=entry.record,pct=v=>(v*100).toFixed(2)+'%';
  const rows=[['Win rate (bb/100)',x=>x.inputs.winrate_bb100],['Swings (bb/100)',x=>x.inputs.std_bb100],['Bankroll (BI)',x=>x.inputs.bankroll_bi],
    ['Horizon (hands)',x=>x.inputs.hands.toLocaleString()],['Paths · seed',x=>`${x.inputs.paths.toLocaleString()} · ${x.inputs.seed}`],
    ['Risk of ruin',x=>pct(x.results.risk_of_ruin)],['95% MC interval',x=>`${pct(x.results.ci95_low)}–${pct(x.results.ci95_high)}`],
    ['Survival',x=>pct(x.results.survival)],['P95 max drawdown',x=>`${x.results.p95_max_drawdown_bi.toFixed(1)} BI`],['Calculation engine',x=>x.model?.version||'unknown']];
  const problem=labInputsProblem(r.a.inputs)||labInputsProblem(r.b.inputs);
  return `<table class="lab-saved-table"><caption>Values as saved${r.saved_at?` on ${escapeHtml(r.saved_at.slice(0,16).replace('T',' '))} UTC`:''}</caption>`+
    `<thead><tr><th scope="col"></th><th scope="col">A · ${escapeHtml(r.a.name)}</th><th scope="col">B · ${escapeHtml(r.b.name)}</th></tr></thead><tbody>`+
    rows.map(([label,get])=>`<tr><th scope="row">${label}</th><td>${escapeHtml(get(r.a))}</td><td>${escapeHtml(get(r.b))}</td></tr>`).join('')+
    `</tbody></table><p class="cap">These are the saved numbers; they are not recalculated. Recompute in Risk Lab runs the current calculation engine.${problem?` This comparison cannot be loaded into the controls: ${escapeHtml(problem)}`:''}</p>`;
}
function renderLabSaved(message=null){
  const list=readLabSaved();
  if(message!=null)$('lab_saved_status').textContent=message;
  const items=list||[],current=labCurrentResult?.model?.version;
  $('lab_saved_empty').hidden=items.length>0;
  $('lab_saved_empty').textContent=list?'No saved comparisons yet. Compare A with B, then choose Save comparison.':'This browser does not allow saving here. Downloads still work.';
  $('lab_saved_list').innerHTML=items.map(entry=>{
    const r=entry.record,pct=v=>(v*100).toFixed(1)+'%',id=escapeHtml(entry.id),open=labSavedOpen.has(entry.id);
    const versions=[r.a.model?.version,r.b.model?.version];
    const older=current&&versions.some(v=>v!==current);
    const problem=labInputsProblem(r.a.inputs)||labInputsProblem(r.b.inputs);
    return `<li><div class="lab-saved-head"><div><strong>${escapeHtml(r.a.name)} → ${escapeHtml(r.b.name)}</strong>`+
      `<span>Risk ${pct(r.a.results.risk_of_ruin)} → ${pct(r.b.results.risk_of_ruin)} (${escapeHtml(signedValue(r.difference.risk_b_minus_a_pp))} pp)${r.saved_at?` · saved ${escapeHtml(r.saved_at.slice(0,16).replace('T',' '))} UTC`:''}${entry.imported?' · imported':''}</span>`+
      `<span>Calculation engine A ${escapeHtml(versions[0]||'unknown')} · B ${escapeHtml(versions[1]||'unknown')}${older?` · not the current engine ${escapeHtml(current)}`:''}</span></div>`+
      `<div class="lab-saved-actions"><button type="button" class="btn ghost" data-view="${id}" aria-expanded="${open}" aria-controls="lab_saved_detail_${id}">View saved results</button>`+
      `<button type="button" class="btn ghost" data-load="${id}"${problem?` disabled title="${escapeHtml(problem)}"`:''}>Recompute in Risk Lab</button>`+
      `<button type="button" class="btn ghost" data-json="${id}">JSON</button><button type="button" class="btn ghost" data-delete="${id}">Delete</button></div></div>`+
      `<div class="lab-saved-detail" id="lab_saved_detail_${id}"${open?'':' hidden'}>${open?labSavedDetail(entry):''}</div></li>`;
  }).join('');
}
function addLabSavedEntry(entry,message){
  const list=readLabSaved();
  if(!list){renderLabSaved('This browser does not allow saving here. Use Download JSON or CSV instead.');return false;}
  list.unshift(entry);
  const dropped=list.length>LAB_STORE_LIMIT?list.splice(LAB_STORE_LIMIT).length:0;
  if(!writeLabSaved(list)){renderLabSaved('Saving failed (storage may be full or blocked). Use Download JSON or CSV instead.');return false;}
  renderLabSaved(message+(dropped?` The oldest saved comparison was removed to stay within ${LAB_STORE_LIMIT}.`:''));
  return true;
}
const labEntryId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
// Restore A (from its snapshot when it was saved under the current engine, otherwise
// recomputed from its own inputs and seed), then recompute B with its saved seed.
async function loadLabEntry(entry){
  const r=entry.record,a=r.a.inputs,b=r.b.inputs,name=`${r.a.name} → ${r.b.name}`;
  const problem=labInputsProblem(a)||labInputsProblem(b);
  if(problem){renderLabSaved(`“${name}” can be viewed but not loaded here: ${problem}`);return;}
  const currentVersion=labCurrentResult?.model?.version,checks=[];
  if(entry.snapshotA&&currentVersion&&r.a.model?.version===currentVersion)setLabSavedA(structuredClone(entry.snapshotA),r.a.name);
  else{
    renderLabSaved(`Loading “${name}”: recomputing A with the current calculation engine…`);
    try{
      const fresh=await apiJSON('/api/risk-lab',{wr:a.winrate_bb100,sd:a.std_bb100,bank:a.bankroll_bi*100,thr:0,hands:a.hands,paths:a.paths,seed:a.seed,includeCurve:false},70000);
      setLabSavedA(fresh,r.a.name);
      checks.push({side:'A',saved:r.a.results.risk_of_ruin,now:fresh.metrics.risk,savedVersion:r.a.model?.version});
    }catch(error){renderLabSaved(`Could not recompute A: ${errorMessage(error)}`);return;}
  }
  $('lab_b_name').value=r.b.name;$('lab_b_name').dataset.edited='true';
  $('lab_wr').value=b.winrate_bb100;$('lab_sd').value=b.std_bb100;$('lab_bank').value=b.bankroll_bi;$('lab_hn').value=b.hands;
  labSeed=b.seed;
  document.querySelectorAll('.labpreset').forEach(x=>x.setAttribute('aria-pressed','false'));
  document.querySelectorAll('.sdpreset').forEach(x=>x.setAttribute('aria-pressed',String(Number(x.dataset.sd)===b.std_bb100)));
  labLoadCheck={name,inputs:b,checks,saved:r.b.results.risk_of_ruin,savedVersion:r.b.model?.version};
  renderLabSaved(`Loading “${name}”: recomputing B with its saved seed ${b.seed}…`);
  runLab(b.paths);
}
function downloadLabRecord(record,format){
  const base=`risk-lab-${labSlug(record.a.name)}-vs-${labSlug(record.b.name)}`;
  if(format==='csv')downloadText(base+'.csv',labComparisonCSV(record),'text/csv;charset=utf-8');
  else downloadText(base+'.json',JSON.stringify(record,null,2)+'\n','application/json');
}
$('lab_export_json').addEventListener('click',()=>{const record=currentLabRecord();if(record)downloadLabRecord(record,'json');});
$('lab_export_csv').addEventListener('click',()=>{const record=currentLabRecord();if(record)downloadLabRecord(record,'csv');});
$('lab_save_comparison').addEventListener('click',()=>{
  const record=currentLabRecord();if(!record)return;
  const a=labSavedA;
  // A is stored with the summary its chart needs; B is recomputed from its inputs and seed on load.
  addLabSavedEntry({id:labEntryId(),record,snapshotA:{params:a.params,metrics:a.metrics,model:a.model||null,fan:{xs:a.fan.xs,p25:a.fan.p25,p50:a.fan.p50,p75:a.fan.p75}}},
    `Saved “${record.a.name} → ${record.b.name}” in this browser.`);
});
$('lab_import').addEventListener('click',()=>$('lab_import_file').click());
$('lab_import_file').addEventListener('change',async()=>{
  const file=$('lab_import_file').files?.[0];$('lab_import_file').value='';
  if(!file)return;
  if(file.size>262144){renderLabSaved('Not imported: the file is too large to be a Risk Lab comparison.');return;}
  let parsed;
  try{parsed=JSON.parse(await file.text());}catch{renderLabSaved('Not imported: the file is not valid JSON.');return;}
  const checked=labValidateRecord(parsed);
  if(checked.error){renderLabSaved(`Not imported: ${checked.error}`);return;}
  const r=checked.record;
  if((readLabSaved()||[]).some(entry=>JSON.stringify(entry.record)===JSON.stringify(r))){renderLabSaved('This comparison is already in the list.');return;}
  addLabSavedEntry({id:labEntryId(),record:r,snapshotA:null,imported:true},`Imported “${r.a.name} → ${r.b.name}”. View saved results shows the numbers in the file; Recompute in Risk Lab runs the current calculation engine.`);
});
$('lab_saved_list').addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  const list=readLabSaved()||[],id=button.dataset.view||button.dataset.load||button.dataset.json||button.dataset.delete;
  const entry=list.find(item=>item.id===id);if(!entry)return;
  if(button.dataset.view){
    if(labSavedOpen.has(id))labSavedOpen.delete(id);else labSavedOpen.add(id);
    renderLabSaved();$('lab_saved_list').querySelector(`[data-view="${CSS.escape(id)}"]`)?.focus();return;
  }
  if(button.dataset.json){downloadLabRecord(entry.record,'json');return;}
  if(button.dataset.delete){writeLabSaved(list.filter(item=>item.id!==id));labSavedOpen.delete(id);renderLabSaved(`Deleted “${entry.record.a.name} → ${entry.record.b.name}”.`);return;}
  loadLabEntry(entry);
});
renderLabSaved();
function renderUncertaintyReference(){
  const {result:r,provenance}=UNCERTAINTY_REFERENCE;
  const cfg=provenance.parameters.config,estimate=r.estimate,post=r.posterior,risk=r.risk;
  const pct=v=>(v*100).toFixed(1)+'%';
  $('lab_u_plugin').textContent=pct(risk.plug_in_risk);
  $('lab_u_integrated').textContent=pct(risk.expected_risk);
  $('lab_u_delta').textContent=`In this saved case, average model risk is ${((risk.expected_risk-risk.plug_in_risk)*100).toFixed(1)} percentage points higher when I account for win-rate uncertainty.`;
  const ci=risk.credible_intervals.ci_95;
  $('lab_u_interval').textContent=`95% posterior interval for model risk: ${pct(ci[0])}–${pct(ci[1])}`;
  $('lab_u_posterior_note').textContent=`Posterior mean ${post.mean.toFixed(2)} bb/100 · posterior SD ${post.std.toFixed(2)} bb/100. Probability that the win rate is above zero: ${pct(post.prob_positive)}.`;
  $('lab_u_settings').textContent=`Fixed case · ${estimate.total_hands.toLocaleString()} synthetic hands · ${cfg.risk.bankroll_bb/100} BI · ${cfg.risk.n_hands.toLocaleString()}-hand horizon · ${risk.n_draws.toLocaleString()} posterior draws`;
  const sources=[
    ['Synthetic history',`${cfg.data.n_blocks} blocks × ${cfg.data.block_hands.toLocaleString()} hands; generating win rate ${cfg.data.true_winrate} and SD ${cfg.data.true_std} bb/100; seed ${cfg.data.seed}.`],
    ['Observed estimate',`${estimate.winrate_bb100.toFixed(2)} bb/100; estimated SD ${estimate.std_bb100.toFixed(2)} bb/100.`],
    ['Estimation uncertainty',`Standard error ${estimate.se_winrate_adjusted.toFixed(2)} bb/100${estimate.se_multiplier>1?`, widened ×${estimate.se_multiplier.toFixed(2)}`:''}. Stability check: ${!estimate.stability_groups?'not run (fewer than 20 blocks)'
      :estimate.stability_flag?`the win rate differs between ${estimate.stability_groups} consecutive groups of blocks more than chance allows (${bpP(estimate.stability_p)})`
      :`no change detected between ${estimate.stability_groups} consecutive groups of blocks (${bpP(estimate.stability_p)}), which is no evidence the win rate was steady`}. This SE enters the posterior.`],
    ['Prior',`Normal with mean ${r.prior.mean} and SD ${r.prior.std} bb/100.`],
    ['Risk calculation',`Finite-horizon Brownian first-passage model; threshold ${cfg.risk.ruin_threshold_bb} bb; estimated volatility held fixed; posterior draw seed ${cfg.seed}.`],
    ['Saved output',`${provenance.timestamp_utc.slice(0,10)} UTC. The page reads the existing result and settings; this presentation update does not rerun the analysis.`],
  ];
  $('lab_u_source').innerHTML=sources.map(([key,value])=>`<dt>${key}</dt><dd>${value}</dd>`).join('');
  if(!plotlyReady()){chartUnavailable('lab_u_risk_chart');chartUnavailable('lab_u_posterior');return;}
  const riskLay=layout('','Risk of hitting zero (%)','');
  riskLay.margin={l:15,r:30,t:12,b:44};riskLay.showlegend=false;
  riskLay.xaxis.range=[0,100];riskLay.xaxis.dtick=25;riskLay.xaxis.fixedrange=true;
  riskLay.yaxis={showticklabels:false,showgrid:false,zeroline:false,fixedrange:true};
  Plotly.react('lab_u_risk_chart',[{type:'bar',orientation:'h',x:[risk.expected_risk*100,risk.plug_in_risk*100],y:['With uncertainty','One estimate'],marker:{color:[C.accent,C.median]},text:[pct(risk.expected_risk),pct(risk.plug_in_risk)],textposition:'outside',textfont:{color:C.text,size:13},cliponaxis:false,hovertemplate:'%{y}<br>Risk %{x:.1f}%<extra></extra>'}],riskLay,CFG);
  const start=post.mean-4*post.std,end=post.mean+4*post.std;
  const xs=Array.from({length:241},(_,i)=>start+(end-start)*i/240);
  const density=xs.map(x=>Math.exp(-.5*((x-post.mean)/post.std)**2)/(post.std*Math.sqrt(2*Math.PI)));
  const postLay=layout('','Win rate (bb/100)','Density');
  postLay.margin={l:50,r:12,t:12,b:49};postLay.showlegend=false;postLay.xaxis.fixedrange=true;postLay.yaxis.fixedrange=true;postLay.yaxis.rangemode='tozero';
  postLay.shapes=[{type:'line',x0:0,x1:0,yref:'paper',y0:0,y1:1,line:{color:C.muted,dash:'dash',width:1.5}}];
  Plotly.react('lab_u_posterior',[{x:xs,y:density,mode:'lines',fill:'tozeroy',fillcolor:tint(C.accent,.12),line:{color:C.accent,width:2.4},hovertemplate:'Win rate %{x:.2f} bb/100<br>Density %{y:.3f}<extra></extra>'},
    {x:[post.mean],y:[1/(post.std*Math.sqrt(2*Math.PI))],mode:'markers',marker:{color:C.accent,size:7},hovertemplate:'Posterior mean %{x:.2f} bb/100<extra></extra>'}],postLay,CFG);
}
function markLabPending(message,busy=true){
  $('lab_live').dataset.state=labHasResult?'pending':'loading';
  $('lab_live').setAttribute('aria-busy',String(busy));
  $('lab_run_state').textContent=(labHasResult?'Previous calculation · ':'')+message;
  $('lab_save_a').disabled=true;
  if(labHasCurve)$('lab_curve_context').textContent='Previous calculation · waiting for the updated assumptions.';
  if(labSavedA){$('lab_compare').dataset.state='pending';$('lab_compare').setAttribute('aria-busy',String(busy));$('lab_compare_state').textContent='A stays saved. B shows the previous calculation until the update completes.';setLabCompareActions(false);}
  renderLabGuide();
}
function updateLabLabels(){
  $('lab_wr_v').textContent=(+$('lab_wr').value).toFixed(1)+' bb/100';
  $('lab_bank_v').textContent=(+$('lab_bank').value)+' buy-ins';
  $('lab_sd_v').textContent=(+$('lab_sd').value)+' bb/100';
  $('lab_hn_v').textContent=(Math.round(+$('lab_hn').value/1000))+'k hands';
  $('lab_input_context').textContent=`${$('lab_bank').value} BI · ${$('lab_wr').value} bb/100 · ${Math.round(+$('lab_hn').value/1000)}k hands`;
}
function renderLab(result){
  labCurrentResult=result;
  const div=100,p=result.params,r=result.fan,ror=result.metrics.risk,[lo,hi]=result.metrics.confidenceInterval;
  $('lab_fan_note').textContent=`Bands summarise ${r.paths.length} stored example paths. Risk uses all ${p.paths.toLocaleString()} simulated runs.`;
  $('lab_ror').textContent=(ror*100).toFixed(1)+'%';
  $('lab_ci').textContent=`95% Monte Carlo interval: ${(lo*100).toFixed(1)}–${(hi*100).toFixed(1)}%`;
  $('lab_surv').textContent=(result.metrics.survival*100).toFixed(1)+'%';
  $('lab_dd').textContent=result.metrics.p95Drawdown.toFixed(1)+' BI';
  $('lab_paths').textContent=p.paths.toLocaleString();$('lab_seed').textContent=String(p.seed);
  const riskCount=Math.round(ror*100);
  $('lab_insight').className='lab-insight';
  $('lab_insight').textContent=`About ${riskCount} in 100 simulated bankrolls hit zero within ${Math.round(p.hands/1000)}k hands at these settings.`;
  $('lab_active_scenario').textContent=`${p.bank/100} buy-ins · ${p.wr} bb/100 edge · ${p.sd} bb/100 swings · ${Math.round(p.hands/1000)}k hands`;
  labHasResult=true;
  $('lab_live').dataset.state='current';
  $('lab_live').setAttribute('aria-busy','false');
  $('lab_run_state').textContent='';
  $('lab_save_a').disabled=false;
  renderLabComparison();
  renderLabGuide();
  renderLabSaved();
  if(labLoadCheck){
    const check=labLoadCheck;labLoadCheck=null;
    const i=check.inputs;
    // Only report on the run that used exactly the saved inputs and seed.
    if(i.winrate_bb100===p.wr&&i.std_bb100===p.sd&&i.bankroll_bi===p.bank/100&&i.hands===p.hands&&i.paths===p.paths&&i.seed===p.seed){
      renderLabSaved(labLoadMessage(check.name,check.checks.concat({side:'B',saved:check.saved,now:ror,savedVersion:check.savedVersion}),result.model?.version||'unknown'));
    }
  }
  $('lab_fan').setAttribute('aria-label',$('lab_insight').textContent+' Shaded bands show the middle 50 and 90 percent of stored paths; selected example paths and the median show how bankroll changes over time.');
  if(!plotlyReady()){chartUnavailable('lab_fan');return;}
  const tr=[],L=r.xs.length,p05=r.p05,p25=r.p25,p50=r.p50,p75=r.p75,p95=r.p95;
  if(r.paths.length>=20){
    tr.push({x:r.xs.concat(r.xs.slice().reverse()),y:p95.concat(p05.slice().reverse()),fill:'toself',fillcolor:tint(C.accent,.08),line:{color:'rgba(0,0,0,0)'},hoverinfo:'skip',showlegend:false});
    tr.push({x:r.xs.concat(r.xs.slice().reverse()),y:p75.concat(p25.slice().reverse()),fill:'toself',fillcolor:tint(C.accent,.2),line:{color:'rgba(0,0,0,0)'},hoverinfo:'skip',showlegend:false});
  }
  const compact=$('lab_fan').clientWidth<620,target=Math.min(compact?8:14,r.paths.length);
  const ruinedPool=[],safePool=[];
  r.ruinFlags.forEach((ruined,index)=>(ruined?ruinedPool:safePool).push(index));
  let ruinedShown=0;
  if(ruinedPool.length&&safePool.length&&target>1)ruinedShown=clamp(Math.round(target*ror),1,target-1);
  else if(ruinedPool.length)ruinedShown=target;
  const pickEven=(pool,count)=>{
    if(count<=0||!pool.length)return [];
    if(count>=pool.length)return pool.slice();
    if(count===1)return [pool[Math.floor((pool.length-1)/2)]];
    return Array.from({length:count},(_,i)=>pool[Math.round(i*(pool.length-1)/(count-1))]);
  };
  const displayIndices=pickEven(ruinedPool,ruinedShown).concat(pickEven(safePool,target-ruinedShown)).sort((a,b)=>a-b),shown=displayIndices.length;
  $('lab_chart_meta').textContent=`${shown} example paths · ${Math.round(p.hands/1000)}k hands`;
  displayIndices.forEach((pathIndex,displayIndex)=>{
    const ruined=r.ruinFlags[pathIndex];
    tr.push({x:r.xs,y:r.paths[pathIndex],mode:'lines',
      line:{color:ruined?tint(C.ruin,.5):tint(C.accent,.35),width:ruined?1.1:0.9,dash:ruined?'dot':'solid'},
      text:Array(L).fill(ruined?'Reached ruin':'Survived horizon'),
      hovertemplate:`Example ${displayIndex+1}<br>%{x:,} hands<br>%{y:.1f} BI<br>%{text}<extra></extra>`,showlegend:false});
  });
  tr.push({x:r.xs,y:p50,mode:'lines',line:{color:C.median,width:3},
    hovertemplate:'Median<br>%{x:,} hands<br>%{y:.1f} BI<extra></extra>',showlegend:false});
  tr.push({x:[0,p.hands],y:[p50[0],p50[L-1]],mode:'markers',marker:{color:C.median,size:[6,8],line:{color:C.bg,width:1.5}},hoverinfo:'skip',showlegend:false});
  const lay=layout('','Hands played','Bankroll (buy-ins)');
  lay.margin=compact?{l:48,r:12,t:15,b:46}:{l:60,r:24,t:18,b:52};lay.showlegend=false;lay.hovermode='closest';lay.yaxis.rangemode='tozero';
  lay.xaxis.tickformat='~s';lay.xaxis.fixedrange=true;lay.xaxis.automargin=true;
  lay.yaxis.fixedrange=true;lay.yaxis.automargin=true;
  lay.shapes=[{type:'line',x0:0,x1:p.hands,y0:p.bank/div,y1:p.bank/div,line:{color:C.muted,dash:'dot',width:1}},
              {type:'line',x0:0,x1:p.hands,y0:p.thr/div,y1:p.thr/div,line:{color:C.ruin,dash:'dash',width:1.4}}];
  lay.annotations=[
    {x:0,y:p.bank/div,xanchor:'left',yanchor:'bottom',xshift:8,yshift:7,text:`START ${(p.bank/div).toFixed(0)} BI`,showarrow:false,bgcolor:tint(C.bg,.85),borderpad:3,font:{color:C.muted,size:11,family:FONT.mono,weight:700}},
    {x:0,y:p.thr/div,xanchor:'left',yanchor:'bottom',xshift:8,yshift:7,text:'0 BI · RUIN',showarrow:false,bgcolor:tint(C.bg,.85),borderpad:3,font:{color:C.ruin,size:11,family:FONT.mono,weight:700}},
    {x:p.hands,y:p50[L-1],xanchor:'right',yanchor:'bottom',xshift:-7,yshift:8,text:`MEDIAN ${p50[L-1].toFixed(1)} BI`,showarrow:false,bgcolor:tint(C.bg,.88),bordercolor:tint(C.median,.45),borderwidth:1,borderpad:4,font:{color:C.median,size:compact?11:12,family:FONT.mono,weight:700}}
  ];
  Plotly.react('lab_fan',tr,lay,CFG);
}
// Risk-versus-bankroll traces: the pointwise 95% Wilson band, the Monte Carlo
// estimate (the same simulated swings at every bankroll, so it cannot rise with
// a larger bankroll) and the finite-horizon Brownian benchmark.
function riskCurveTraces(curve){
  const traces=[];
  if(curve.lower&&curve.upper)traces.push({x:curve.xs.concat(curve.xs.slice().reverse()),y:curve.upper.concat(curve.lower.slice().reverse()),fill:'toself',fillcolor:C.band,line:{color:'rgba(0,0,0,0)'},hoverinfo:'skip',name:'95% interval'});
  traces.push({x:curve.xs,y:curve.monteCarlo,customdata:curve.lower?curve.xs.map((_,i)=>[curve.lower[i],curve.upper[i]]):undefined,
    hovertemplate:curve.lower?'%{y:.1%} (95%: %{customdata[0]:.1%}–%{customdata[1]:.1%})<extra>Monte Carlo</extra>':undefined,
    mode:'lines+markers',line:{color:C.accent,width:2.2},name:'Monte Carlo'});
  traces.push({x:curve.xs,y:curve.analytical,mode:'lines',line:{color:C.muted,dash:'dash',width:1.5},name:'Brownian (finite)'});
  return traces;
}
function renderLabCurve(p,curve){
  $('lab_curve_context').textContent=`${curve.pathsPerPoint} Monte Carlo paths per point, with the same simulated swings at every bankroll`;
  if(!plotlyReady()){chartUnavailable('lab_curve');return;}
  const div=100;
  const compact=$('lab_curve').clientWidth<620;
  const lay=layout('','Bankroll (buy-ins)','Risk of ruin',{yaxis:{tickformat:'.0%',gridcolor:C.grid}});
  // The legend sits below the x-axis title; three entries need the extra room.
  lay.margin=compact?{l:48,r:12,t:14,b:120}:{l:62,r:22,t:18,b:92};
  lay.legend={orientation:'h',x:0,y:compact?-.5:-.34,xanchor:'left',yanchor:'top',font:{color:C.muted,size:compact?11:12}};
  lay.shapes=[{type:'line',x0:p.bank/div,x1:p.bank/div,yref:'paper',y0:0,y1:1,line:{color:C.median,dash:'dot',width:1.3}}];
  Plotly.react('lab_curve',riskCurveTraces(curve),lay,CFG);
}
let _labT=null;
let labRequest=0;
let labController=null;
let labTrigger=null;
let labHasCurve=false;
let labCurveKey=null;
async function runLab(paths,trigger=null){
  const p=labParams(paths||LAB_QUICK_PATHS);
  const key=[p.wr,p.sd,p.bank,p.hands].join('|');
  p.includeCurve=!(trigger&&labHasCurve&&labCurveKey===key);
  updateLabLabels();
  markLabPending('updating simulation…');
  labController?.abort();
  if(labTrigger)setBusy(labTrigger,false);
  const controller=new AbortController();labController=controller;labTrigger=trigger;
  $('lab_status').textContent='Running '+p.paths.toLocaleString()+' paths…';
  if(trigger)setBusy(trigger,true,`Running ${Math.round(p.paths/1000)}k paths…`);
  const request=++labRequest;
  try{
    const result=await apiJSON('/api/risk-lab',p,70000,controller.signal);
    if(request!==labRequest)return;
    renderLab(result);
    if(result.curve){renderLabCurve(result.params,result.curve);labHasCurve=true;labCurveKey=key;}
    else if(labCurveKey===key)$('lab_curve_context').textContent='Retained curve for these assumptions';
    $('lab_status').textContent=p.paths===LAB_DETAILED_PATHS?'Detailed run complete':'Quick run complete';
  }catch(error){if(request===labRequest){
    $('lab_status').textContent=errorMessage(error);
    $('lab_live').dataset.state='error';$('lab_live').setAttribute('aria-busy','false');
    $('lab_run_state').textContent=labHasResult?'Update failed · showing the previous calculation':'Update failed · no result yet';
    if(labSavedA){$('lab_compare').setAttribute('aria-busy','false');$('lab_compare_state').textContent='Update failed. A stays saved; B is the previous result.';}
    if(!labHasResult){$('lab_insight').className='lab-insight is-error';$('lab_insight').textContent=errorMessage(error);}
    renderLabGuide();
  }}
  finally{if(request===labRequest){labController=null;labTrigger=null;if(trigger)setBusy(trigger,false);}}
}
document.querySelectorAll('.labpreset').forEach(button=>button.addEventListener('click',()=>{
  labSeed=42;
  $('lab_wr').value=button.dataset.wr;$('lab_bank').value=button.dataset.bank;$('lab_sd').value=button.dataset.sd;$('lab_hn').value=button.dataset.hands;
  document.querySelectorAll('.labpreset').forEach(x=>x.setAttribute('aria-pressed',String(x===button)));
  document.querySelectorAll('.sdpreset').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.sd===button.dataset.sd)));runLab(LAB_QUICK_PATHS);
}));
document.querySelectorAll('.sdpreset').forEach(button=>button.addEventListener('click',()=>{
  $('lab_sd').value=button.dataset.sd;document.querySelectorAll('.sdpreset').forEach(x=>x.setAttribute('aria-pressed',String(x===button)));
  document.querySelectorAll('.labpreset').forEach(x=>x.setAttribute('aria-pressed','false'));runLab(LAB_QUICK_PATHS);
}));
['lab_wr','lab_sd','lab_bank','lab_hn'].forEach(id=>{
  const input=$(id);
  input.addEventListener('input',()=>{
    document.querySelectorAll('.labpreset').forEach(x=>x.setAttribute('aria-pressed','false'));
    if(id==='lab_sd')document.querySelectorAll('.sdpreset').forEach(x=>x.setAttribute('aria-pressed','false'));
    updateLabLabels();clearTimeout(_labT);
    // Discard an in-flight response for inputs that have since changed.
    ++labRequest;labController?.abort();labController=null;
    if(labTrigger){setBusy(labTrigger,false);labTrigger=null;}
    markLabPending('release slider to update',false);
    $('lab_status').textContent='Release the slider to update the simulation.';
  });
  input.addEventListener('change',()=>{clearTimeout(_labT);_labT=setTimeout(()=>runLab(LAB_QUICK_PATHS),80);});
});
$('lab_hp').addEventListener('click',()=>runLab(LAB_DETAILED_PATHS,$('lab_hp')));

/* ================= press Enter to run ================= */
[[['eq_trials','eq_seed'],runEquity],
 [['ev_pot','ev_bet','ev_eq'],runEV],
 [['bk_wr','bk_sd','bk_bank','bk_thr','bk_hands','bk_paths','bk_seed'],runBankroll],
 [['gto_iters','gto_seed'],runGTO]].forEach(([ids,fn])=>ids.forEach(id=>{
  const el=$(id); if(el) el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();fn();}});
}));

/* ================= initial state ================= */
const initializedModules=new Set();
function initializeModule(id){
  if(initializedModules.has(id))return;
  initializedModules.add(id);
  if(id==='risklab'){renderUncertaintyReference();runLab(LAB_QUICK_PATHS);}
  else if(id==='equity')runEquity();
  else if(id==='ev'){if(window.__lastEquity==null)runEquity();else runEV();}
  else if(id==='bankroll'){if(bkMode()==='results')runBp();else runBankroll();}
  else if(id==='preflop')loadPreflop();
}
tabs.forEach(tab=>tab.addEventListener('click',()=>initializeModule(tab.dataset.mod)));
renderSlots();initializeModule(initialTab.dataset.mod);
