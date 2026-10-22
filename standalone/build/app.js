/* ================= Poker Analytics Suite — public UI logic =================
   Core calculations run on the private same-origin API and are deliberately
   excluded from the browser bundle. */
"use strict";

/* ---------- shared: Plotly theme ---------- */
const RANKS="23456789TJQKA";
const C={bg:'#0B1220',grid:'#243247',accent:'#38BDF8',ruin:'#F87171',pos:'#4ADE80',
  median:'#FBBF24',text:'#E6EDF3',muted:'#94A3B8',band:'rgba(56,189,248,0.16)'};
const CFG={displayModeBar:false,responsive:true};
const UNCERTAINTY_REFERENCE=/*__UNCERTAINTY_REFERENCE__*/ null;
function layout(title,xt,yt,extra){return Object.assign({title:{text:title,font:{color:C.text,size:16}},
  paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',font:{color:C.muted,size:13},
  margin:{l:62,r:18,t:44,b:48},xaxis:{title:xt,gridcolor:C.grid,zerolinecolor:C.grid},
  yaxis:{title:yt,gridcolor:C.grid,zerolinecolor:C.grid},legend:{font:{color:C.muted}}},extra||{});}
const $=id=>document.getElementById(id);
function kpiCard(l,v,s){return `<div class="kpi"><div class="kl">${l}</div><div class="kv">${v}</div><div class="ks">${s||''}</div></div>`;}
const numberRollRAF=new WeakMap();
const reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
if(typeof matchMedia==='function'&&matchMedia('(pointer:fine)').matches&&!reducedMotion()){
  let pointerFrame=0,pointerX=innerWidth/2,pointerY=innerHeight*.18;
  document.addEventListener('pointermove',event=>{
    pointerX=event.clientX;pointerY=event.clientY;
    if(pointerFrame)return;
    pointerFrame=requestAnimationFrame(()=>{
      document.documentElement.style.setProperty('--pointer-x',pointerX+'px');
      document.documentElement.style.setProperty('--pointer-y',pointerY+'px');
      pointerFrame=0;
    });
  },{passive:true});
}
function parseRollingNumber(text){
  const m=String(text).trim().match(/^([+\-−]?)([\d,]+(?:\.\d+)?)(.*)$/);
  if(!m||/\d/.test(m[3]))return null;
  const magnitude=Number(m[2].replaceAll(',',''));if(!Number.isFinite(magnitude))return null;
  const negative=m[1]==='-'||m[1]==='−';
  return {value:negative?-magnitude:magnitude,positive:m[1]==='+',minus:m[1]==='−'?'−':'-',decimals:(m[2].split('.')[1]||'').length,grouped:m[2].includes(','),suffix:m[3]};
}
function rollingText(spec,value){
  const abs=Math.abs(value),opts={minimumFractionDigits:spec.decimals,maximumFractionDigits:spec.decimals,useGrouping:spec.grouped};
  const digits=spec.grouped?abs.toLocaleString('en-US',opts):abs.toFixed(spec.decimals);
  return (value<0?spec.minus:spec.positive?'+':'')+digits+spec.suffix;
}
function rollNumber(el,finalText){
  if(!el)return;const text=String(finalText),spec=parseRollingNumber(text),old=numberRollRAF.get(el);
  if(old)cancelAnimationFrame(old);
  if(!spec){el.textContent=text;return;}
  const current=Number(el.dataset.rollCurrent),from=Number.isFinite(current)?current:0,to=spec.value;
  el.dataset.rollTarget=String(to);el.setAttribute('aria-label',text);
  if(reducedMotion()||!('requestAnimationFrame' in globalThis)||Math.abs(to-from)<1e-9){el.textContent=text;el.dataset.rollCurrent=String(to);el.classList.remove('is-counting');return;}
  const start=performance.now(),duration=650;el.classList.add('is-counting');
  const tick=now=>{const t=Math.min(1,(now-start)/duration),eased=1-Math.pow(1-t,3),value=from+(to-from)*eased;
    el.textContent=rollingText(spec,value);el.dataset.rollCurrent=String(value);
    if(t<1)numberRollRAF.set(el,requestAnimationFrame(tick));
    else{el.textContent=text;el.dataset.rollCurrent=String(to);el.classList.remove('is-counting');numberRollRAF.delete(el);}
  };
  numberRollRAF.set(el,requestAnimationFrame(tick));
}
function rollKpis(containerId){requestAnimationFrame(()=>document.querySelectorAll(`#${containerId} .kv`).forEach(el=>rollNumber(el,el.textContent)));}
function animateResultBar(el){if(!el||reducedMotion()||typeof el.animate!=='function')return;el.animate([{transform:'scaleX(.04)'},{transform:'scaleX(1)'}],{duration:520,easing:'cubic-bezier(.2,.75,.25,1)'});}
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
const randomOpponents=[false,false,false,false,false];
let activeSlot=null;
let pickerReturnFocus=null;
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
function renderOpponents(){
  $('opponents_list').innerHTML=activeOpponents.map((idx,position)=>{
    const random=randomOpponents[idx];
    return `<div class="opponent-row" data-opponent="${idx}"><div class="opponent-head"><strong>Opponent ${position+1}</strong><div class="opp-actions"><label><input type="checkbox" data-random-opponent="${idx}"${random?' checked':''}> unknown / random hand</label>${activeOpponents.length>1?`<button type="button" class="opp-remove" data-remove-opponent="${idx}" aria-label="Remove opponent ${position+1}">Remove</button>`:''}</div></div>${random?'<div class="random-hand-placeholder">Two legal cards will be dealt privately on every simulation trial.</div>':`<div class="slots" id="slots_opp_${idx}">${slotsHTML(opponentSlots(idx))}</div>`}</div>`;
  }).join('');
  $('eq_opp_count').textContent=activeOpponents.length+' of 5';$('eq_add_opp').disabled=activeOpponents.length>=5;
}
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
  requestAnimationFrame(()=>$('pgrid').querySelector('.pcard:not(:disabled)')?.focus());
}
function closePicker(){$('picker').classList.remove('on');if(pickerReturnFocus?.isConnected)pickerReturnFocus.focus();}
function fillSlot(idx){
  const g=groupOf(activeSlot); cardState[activeSlot]=idx;
  if(g==='preflop'){renderPfHandSlots();syncPfHandFromCards();}
  else{renderSlots();markEquityDirty();}
  const el=$('slot_'+activeSlot); if(el) el.classList.add('pop');
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
  const remove=e.target.closest('[data-remove-opponent]');if(remove){const idx=+remove.dataset.removeOpponent;activeOpponents=activeOpponents.filter(x=>x!==idx);opponentSlots(idx).forEach(s=>cardState[s]=null);randomOpponents[idx]=false;renderSlots();runEquity();return;}
  handleSlotClick(e);
});
$('opponents_list').addEventListener('change',e=>{const box=e.target.closest('[data-random-opponent]');if(!box)return;const idx=+box.dataset.randomOpponent;randomOpponents[idx]=box.checked;if(box.checked)opponentSlots(idx).forEach(s=>cardState[s]=null);renderOpponents();box.checked?runEquity():markEquityDirty();});
$('eq_add_opp').addEventListener('click',()=>{const idx=[0,1,2,3,4].find(i=>!activeOpponents.includes(i));if(idx==null)return;activeOpponents.push(idx);renderOpponents();markEquityDirty();});
$('pgrid').addEventListener('click',e=>{const c=e.target.closest('.pcard');
  if(c&&!c.classList.contains('used')) fillSlot(+c.dataset.card);});
$('pickclose').addEventListener('click',closePicker);
$('picker').addEventListener('click',e=>{if(e.target.id==='picker')closePicker();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('picker').classList.contains('on'))closePicker();});
function clearEquityCards(){Object.keys(cardState).filter(k=>groupOf(k)!=='preflop').forEach(k=>cardState[k]=null);}
$('eq_clear').addEventListener('click',()=>{clearEquityCards();activeOpponents=[0];randomOpponents.fill(false);renderSlots();markEquityDirty();});
// one-click example matchups (beginner friendly)
const EXAMPLES={
  aakk:{hero:[51,38],vill:[50,24],random:false},   // A♠A♥ vs K♠K♦
  aks22:{hero:[38,37],vill:[0,13],random:false},   // A♥K♥ vs 2♣2♦
  random:{hero:[51,50],random:true}                // A♠K♠ vs random
};
document.querySelectorAll('.exbtn').forEach(b=>b.addEventListener('click',()=>{
  const ex=EXAMPLES[b.dataset.ex]; if(!ex) return;
  clearEquityCards();markEquityDirty();
  activeOpponents=[0];randomOpponents.fill(false);
  cardState.hero0=ex.hero[0]; cardState.hero1=ex.hero[1];
  if(ex.vill){cardState.opp0a=ex.vill[0]; cardState.opp0b=ex.vill[1];}
  randomOpponents[0]=!!ex.random;
  renderSlots(); runEquity(true);
}));

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
    if(randomOpponents[idx]){opponents.push(null);continue;}
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
    const {result:res,methodText:methodTxt}=await apiJSON('/api/equity',{hero,opponents,board,trials,seed},60000,controller.signal);
    if(request!==equityRequest)return;
    const eqp=res.equity*100, w=res.win/res.trials*100, t=res.tie/res.trials*100, l=res.lose/res.trials*100;
    // plain-language verdict for beginners
    let vtxt, tone;
    const field=` against ${opponents.length} opponent${opponents.length===1?'':'s'}`;
    if(eqp>=55){vtxt=`You're the favourite${field}: about ${Math.round(eqp)}% of the pot on average.`;tone='positive';}
    else if(eqp>=35){vtxt=`This is a competitive spot${field}: about ${Math.round(eqp)}% of the pot on average.`;tone='caution';}
    else{vtxt=`You're the underdog${field}: about ${Math.round(eqp)}% of the pot on average.`;tone='negative';}
    const vd=$('eq_verdict'); vd.style.display='block';
    vd.className='result-insight result-dim '+tone;vd.textContent=vtxt;
    $('eq_kpis').innerHTML=kpiCard('Equity',eqp.toFixed(1)+'%','expected share of pot')+
      kpiCard('Win',w.toFixed(1)+'%','')+kpiCard('Tie / Lose',t.toFixed(1)+'% / '+l.toFixed(1)+'%','');
    rollKpis('eq_kpis');
    $('eq_method').textContent=methodTxt;
    $('eq_bars').innerHTML=`<span style="width:${w}%;background:${C.pos}"></span><span style="width:${t}%;background:${C.muted}"></span><span style="width:${l}%;background:${C.ruin}"></span>`;
    $('eq_bars').setAttribute('aria-label',`Equity result: win ${w.toFixed(1)} percent, tie ${t.toFixed(1)} percent, lose ${l.toFixed(1)} percent`);
    $('eq_legend').innerHTML=`<span style="color:${C.pos}">■ win</span>&nbsp;&nbsp;<span style="color:${C.muted}">■ tie</span>&nbsp;&nbsp;<span style="color:${C.ruin}">■ lose</span>`;
    $('eq_note').innerHTML=res.method==='exact'
      ?'Exact result — no simulation noise.'
      :'Monte Carlo estimate; conservative approximate standard error ≈ '+(Math.sqrt(res.equity*(1-res.equity)/res.trials)*100).toFixed(2)+' pp (allows for fractional split pots).';
    window.__lastEquity=eqp;
    $('eq_toev').disabled=false;
    const cardText=i=>RANKS[i%13]+SUIT_SYM[Math.floor(i/13)];
    const opponentText=opponents.map((hand,index)=>hand?hand.map(cardText).join(' '):`Opponent ${index+1} random`).join(' · ');
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
function renderEVSensitivity(){
  if(!evCurrentResult)return;
  const r=evCurrentResult,current=r.equity*100,test=evTestPct??current,q=test/100;
  const testEV=q*r.pot-(1-q)*r.call;
  $('ev_test_pct').textContent=test.toFixed(1)+'%';
  $('ev_test_result').textContent=`At ${test.toFixed(1)}% equity: ${evAmount(testEV)} EV per call.`;
  $('ev_sensitivity_note').textContent=`Pot ${r.pot.toLocaleString()} bb · call ${r.call.toLocaleString()} bb held fixed. Each +1 percentage point of equity adds ${((r.pot+r.call)/100).toLocaleString('en-US',{maximumFractionDigits:4})} bb to EV. The slider tests an assumption; it does not recalculate the cards.`;
  $('ev_sensitivity_chart').setAttribute('aria-label',`EV increases linearly with equity at pot ${r.pot} bb and call ${r.call} bb. Break-even ${(r.requiredEquity*100).toFixed(1)} percent. Current EV ${r.evCall.toFixed(2)} bb; test EV ${testEV.toFixed(2)} bb.`);
  if(!plotlyReady()){chartUnavailable('ev_sensitivity_chart');return;}
  const threshold=r.requiredEquity*100;
  const traces=[
    {x:[0,threshold],y:[-r.call,0],mode:'lines',line:{color:C.ruin,width:2.4},hovertemplate:'Equity %{x:.1f}%<br>EV %{y:.2f} bb<extra></extra>'},
    {x:[threshold,100],y:[0,r.pot],mode:'lines',line:{color:C.pos,width:2.4},hovertemplate:'Equity %{x:.1f}%<br>EV %{y:.2f} bb<extra></extra>'},
    {x:[current],y:[r.evCall],mode:'markers',marker:{size:11,color:C.accent,line:{color:C.text,width:1.5}},hovertemplate:'Current equity %{x:.1f}%<br>EV %{y:.2f} bb<extra></extra>'},
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
  evResultBasis=`${source} · equity ${(result.equity*100).toFixed(1)}% · pot ${result.pot.toLocaleString()} bb · call ${result.call.toLocaleString()} bb`;
  const gap=(result.equity-result.requiredEquity)*100,zero=Math.abs(result.evCall)<1e-9;
  $('ev_main_value').textContent=evAmount(zero?0:result.evCall);
  $('ev_gap').textContent=signedValue(Math.abs(gap)<1e-9?0:gap)+' pp';
  $('ev_gap_note').textContent=Math.abs(gap)<1e-9?'At break-even':gap>0?'Above break-even':'Below break-even';
  $('ev_current_pct').textContent=(result.equity*100).toFixed(1)+'%';
  $('ev_threshold_pct').textContent=(result.requiredEquity*100).toFixed(1)+'%';
  $('ev_verdict').textContent=zero?'Break-even in this model':result.evCall>0?'Positive EV relative to folding (0 bb)':'Negative EV relative to folding (0 bb)';
  $('ev_results').classList.toggle('is-positive',!zero&&result.evCall>0);
  $('ev_results').classList.toggle('is-negative',!zero&&result.evCall<0);
  setEVState('current');
  evTestPct=result.equity*100;
  $('ev_test_equity').value=(result.equity*100).toFixed(1);
  $('ev_expl').textContent=`EV = equity × ${result.pot} − (1 − equity) × ${result.call} bb. Equity uses a 0–1 fraction. This assumes a fixed eligible pot and no future betting, rake or side pots. The curve explores equity assumptions; it is not a confidence interval.`;
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
  $('bk_insight').className='result-insight result-dim '+riskTone;
  $('bk_insight').textContent=`About ${rorCount} in 100 simulated bankrolls reach the ruin threshold within ${Math.round(p.hands/1000)}k hands under these assumptions.`;
  $('bk_kpis').innerHTML=kpiCard('Risk of ruin',(ror*100).toFixed(1)+'%','over '+p.hands.toLocaleString()+' hands')+
    kpiCard('P95 max drawdown',p95.toFixed(1)+' BI','95% of paths never fall further from a peak')+
    kpiCard('Median terminal',med.toFixed(1)+' BI','')+
    kpiCard('Prob. profit',(pp*100).toFixed(1)+'%','')+
    kpiCard('Brownian (finite)',(metrics.brownian*100).toFixed(1)+'%','analytical check')+
    kpiCard('Paths',p.paths.toLocaleString(),'seed '+p.seed);
  rollKpis('bk_kpis');
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
      kpiCard('|error vs −1/18|',Math.abs(exact-(-1/18)).toFixed(4),'lower is better')+
      kpiCard('Iterations',iters.toLocaleString(),'seed '+seed)+
      kpiCard('Info sets',Object.keys(r.strategy).length,'');
    rollKpis('gto_kpis');
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
const PF_COLORS={raise:'#38BDF8',call:'#22C55E',jam:'#EC4899',fold:'#4B5563'};
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
function pfNewSession(scenario,items,retry=false){return {scenarioId:scenario.id,items,results:items.map(()=>null),index:0,size:items.length,retry};}
function pfSessionFor(scenario){
  let session=pfSessions.get(scenario.id);
  if(!session){session=pfNewSession(scenario,pfBuildSet(scenario,pfSetSize,++pfSetSerial));pfSessions.set(scenario.id,session);}
  return session;
}
function pfStartNewSet(scenario){const session=pfNewSession(scenario,pfBuildSet(scenario,pfSetSize,++pfSetSerial));pfSessions.set(scenario.id,session);return session;}
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
  $(targetId).innerHTML=`<div class="label"><span>Range summary</span><strong>${scenario.stack}bb</strong></div>`+
    `<div><span>VPIP</span><strong>${summary.vpip.toFixed(1)}%</strong></div>`+
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
  $('pf_mix_hand').textContent=hand.hand;$('pf_hand_mix').innerHTML=pfActionRows(hand.actions);
  renderPfHandSlots();$('pf_hand_name').textContent=hand.hand;
  $('pf_detail_mix').innerHTML=pfActionRows(hand.actions);
  $('pf_guidance').textContent=hand.guidance;
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
    else $('pf_status').textContent=`${pfScenarios.length} demo scenarios · 169 starting hands`;
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
    $('pf_delta').innerHTML=`<h3>${pfCompareHand}: ${PF_LABELS[largest.action]} ${direction}</h3><p>Range B minus Range A. Frequencies are from the demonstration dataset.</p><div class="pf-delta-grid">`+
      deltas.map(delta=>`<div class="pf-delta-item"><span>${PF_LABELS[delta.action]}</span><strong style="color:${PF_COLORS[delta.action]}">${delta.value>0?'+':''}${delta.value} pp</strong></div>`).join('')+'</div>';
    if(pfMode==='compare')$('pf_status').textContent='Comparison ready · select any hand in either matrix';
  }catch(error){if(request===pfCompareRequest&&pfMode==='compare')$('pf_status').textContent=errorMessage(error);}
}
function trainerScenario(){return pfScenario||pfCache.values().next().value;}
function renderPfSetNote(session){
  const answered=session.results.some(Boolean),finished=session.index>=session.items.length;
  const sizeText=size=>size===169?'all 169 hands':`${size} questions`;
  let note='Each scenario keeps its own set until you reload the page.',offer=false;
  if(session.added?.length)note=`Added ${session.added.join(', ')} from the Library to this set. `+note;
  if(session.retry)note=`Retrying ${session.items.length} missed question${session.items.length===1?'':'s'}. `+note;
  else if(session.size!==pfSetSize&&answered&&!finished){note=`This set keeps its ${sizeText(session.size)}; your next set will have ${sizeText(pfSetSize)}.`;offer=true;}
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
function renderPfReview(scenario,session,stats){
  $('pf_review_title').textContent=session.retry?'Retry complete':'Set complete';
  const parts=[];
  if(stats.actionTotal)parts.push(`${stats.actionInRange} of ${stats.actionTotal} action choices in range`);
  if(stats.frequencyTotal)parts.push(`${stats.frequencyCorrect} of ${stats.frequencyTotal} frequency questions correct`);
  parts.push(`${stats.mixedSeen} mixed-strategy hand${stats.mixedSeen===1?'':'s'} seen`);
  $('pf_review_summary').textContent=`${scenario.title}: ${parts.join(' · ')}.`;
  $('pf_review_rows').innerHTML=session.items.map((item,index)=>{
    const result=session.results[index],hand=pfHand(scenario,item.hand),frequency=item.kind==='frequency';
    const verdict=frequency?(result.ok?'Correct':`Off by ${Math.abs(result.answer-hand.actions[item.action])} pp`):(result.ok?(result.mixed?'In range · mixed':'In range'):'Not in range');
    return `<tr data-ok="${result.ok}"><td>${index+1}</td><th scope="row">${hand.hand}</th><td>${frequency?`How often ${PF_LABELS[item.action]}?`:'Action'}</td>`+
      `<td>${frequency?pfFrequencyLabel(result.answer):PF_LABELS[result.answer]}</td><td>${pfMixText(hand)}</td><td>${verdict}</td></tr>`;
  }).join('');
  const missed=stats.missed.length;
  $('pf_retry_missed').disabled=!missed;
  $('pf_retry_missed').textContent=missed?`Retry ${missed} missed`:'Nothing missed';
  $('pf_new_set').textContent=pfSetSize===169?'New 169-hand set':`New ${pfSetSize}-question set`;
  $('pf_status').textContent=`Review · ${missed} missed of ${stats.total}`;
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
  const reviewing=session.index>=session.items.length;
  $('pf_question').hidden=reviewing;$('pf_review').hidden=!reviewing;
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
  renderPfTrainer();
  $('pf_next_hand').focus?.();
}
function nextPfTrainerHand(){
  if(pfLoading||pfFailed)return;
  const scenario=trainerScenario();if(!scenario)return;
  const session=pfSessionFor(scenario);
  if(session.index>=session.items.length||!session.results[session.index])return;
  session.index+=1;
  renderPfTrainer();
  if(session.index>=session.items.length)$('pf_review_title').focus?.();
  else document.querySelector?.('#pf_decision_actions:not([hidden]) .pf-action-button:not([hidden]):not(:disabled), #pf_frequency_options:not([hidden]) button')?.focus();
}
function retryPfMissed(){
  const scenario=trainerScenario();if(!scenario||pfLoading||pfFailed)return;
  const missed=pfSessionStats(pfSessionFor(scenario)).missed;
  if(!missed.length)return;
  pfSessions.set(scenario.id,pfNewSession(scenario,missed.map(item=>({...item})),true));
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
  const item=existing>=0?session.items.splice(existing,1)[0]:{hand:name,kind:'action'};
  if(existing<0)session.added=(session.added||[]).concat(name);
  if(existing>=0)session.results.splice(existing,1);
  session.items.splice(at,0,item);session.results.splice(at,0,null);
  session.index=at;
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
['pf_scenario','pf_trainer_select'].forEach(id=>$(id).addEventListener('change',()=>loadPreflop($(id).value)));
$('pf_retry').addEventListener('click',()=>loadPreflop(pfRequestedScenario));
['pf_compare_a','pf_compare_b'].forEach(id=>$(id).addEventListener('change',renderPfCompare));
$('pf_swap').addEventListener('click',()=>{const a=$('pf_compare_a').value;$('pf_compare_a').value=$('pf_compare_b').value;$('pf_compare_b').value=a;renderPfCompare();});
['pf_matrix','pf_matrix_a','pf_matrix_b'].forEach(id=>$(id).addEventListener('click',event=>{const cell=event.target.closest('[data-pf-hand]');if(cell&&!pfLoading&&!pfFailed)selectPfHand(cell.dataset.pfHand,id);}));
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
  $('pf_find_status').textContent=`Showing ${parsed.hand}.`;
});
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
  renderPfTrainer();
});
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
  hands:Math.round(+$('lab_hn').value),paths:paths,seed:42,includeCurve};}
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
// Everything needed to understand a comparison later: inputs, results, seed and model version.
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
  [[a,C.median,'Saved A','rgba(251,191,36,.10)'],[b,C.accent,'Current B','rgba(56,189,248,.12)']].forEach(([r,color,name,fill])=>{
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
  $('lab_save_a').textContent='Replace A with current';
  $('lab_save_hint').textContent='A is saved. Next, change one assumption; B follows the current simulation and the comparison appears below.';
  $('lab_save_next').hidden=false;$('lab_view_compare').hidden=false;
}
// Saving A no longer jumps away: the next step is offered right here.
$('lab_save_a').addEventListener('click',()=>{
  if(!labCurrentResult||$('lab_live').dataset.state!=='current')return;
  setLabSavedA(structuredClone(labCurrentResult));
  renderLabComparison();renderLabGuide();
});
$('lab_clear_a').addEventListener('click',()=>{
  labSavedA=null;$('lab_compare').hidden=true;$('lab_save_a').textContent='Save current as A';
  $('lab_save_hint').textContent='Save a baseline, then change the assumptions to compare it with B.';
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
function renderLabSaved(message=null){
  const list=readLabSaved();
  if(message!=null)$('lab_saved_status').textContent=message;
  const items=list||[];
  $('lab_saved').hidden=!items.length&&!$('lab_saved_status').textContent;
  $('lab_saved_list').innerHTML=items.map(entry=>{
    const r=entry.record,pct=v=>(v*100).toFixed(1)+'%';
    return `<li><div><strong>${escapeHtml(r.a.name)} → ${escapeHtml(r.b.name)}</strong>`+
      `<span>Risk ${pct(r.a.results.risk_of_ruin)} → ${pct(r.b.results.risk_of_ruin)} (${escapeHtml(signedValue(r.difference.risk_b_minus_a_pp))} pp) · saved ${escapeHtml(r.saved_at.slice(0,16).replace('T',' '))} UTC · model ${escapeHtml(r.b.model?.version||'unknown')}</span></div>`+
      `<div class="lab-saved-actions"><button type="button" class="btn ghost" data-load="${escapeHtml(entry.id)}">Load</button><button type="button" class="btn ghost" data-json="${escapeHtml(entry.id)}">JSON</button><button type="button" class="btn ghost" data-delete="${escapeHtml(entry.id)}">Delete</button></div></li>`;
  }).join('');
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
  const list=readLabSaved();
  if(!list){renderLabSaved('This browser does not allow saving here. Use Download JSON or CSV instead.');return;}
  const a=labSavedA;
  // A is stored with the summary its chart needs; B is recomputed from its inputs and seed on load.
  const entry={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),record,
    snapshotA:{params:a.params,metrics:a.metrics,model:a.model||null,fan:{xs:a.fan.xs,p25:a.fan.p25,p50:a.fan.p50,p75:a.fan.p75}}};
  list.unshift(entry);
  const dropped=list.length>LAB_STORE_LIMIT?list.splice(LAB_STORE_LIMIT).length:0;
  if(!writeLabSaved(list)){renderLabSaved('Saving failed (storage may be full or blocked). Use Download JSON or CSV instead.');return;}
  renderLabSaved(`Saved “${record.a.name} → ${record.b.name}” in this browser.${dropped?` The oldest saved comparison was removed to stay within ${LAB_STORE_LIMIT}.`:''}`);
});
$('lab_saved_list').addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  const list=readLabSaved()||[],id=button.dataset.load||button.dataset.json||button.dataset.delete;
  const entry=list.find(item=>item.id===id);if(!entry)return;
  if(button.dataset.json){downloadLabRecord(entry.record,'json');return;}
  if(button.dataset.delete){writeLabSaved(list.filter(item=>item.id!==id));renderLabSaved(`Deleted “${entry.record.a.name} → ${entry.record.b.name}”.`);return;}
  const r=entry.record,b=r.b.inputs;
  setLabSavedA(structuredClone(entry.snapshotA),r.a.name);
  $('lab_b_name').value=r.b.name;$('lab_b_name').dataset.edited='true';
  $('lab_wr').value=b.winrate_bb100;$('lab_sd').value=b.std_bb100;$('lab_bank').value=b.bankroll_bi;$('lab_hn').value=b.hands;
  document.querySelectorAll('.labpreset').forEach(x=>x.setAttribute('aria-pressed','false'));
  document.querySelectorAll('.sdpreset').forEach(x=>x.setAttribute('aria-pressed',String(Number(x.dataset.sd)===b.std_bb100)));
  labLoadCheck={name:`${r.a.name} → ${r.b.name}`,risk:r.b.results.risk_of_ruin,version:r.b.model?.version,inputs:b};
  renderLabSaved(`Loading “${r.a.name} → ${r.b.name}”: A restored, recomputing B…`);
  runLab(b.paths);
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
  $('lab_u_posterior_note').textContent=`Posterior mean ${post.mean.toFixed(2)} bb/100 · posterior SD ${post.std.toFixed(2)} bb/100. Probability that the win rate is above zero: ${pct(post.prob_positive)}. The dashed line marks break-even at 0 bb/100.`;
  $('lab_u_settings').textContent=`Fixed case · ${estimate.total_hands.toLocaleString()} synthetic hands · ${cfg.risk.bankroll_bb/100} BI · ${cfg.risk.n_hands.toLocaleString()}-hand horizon · ${risk.n_draws.toLocaleString()} posterior draws · independent of the live controls`;
  const sources=[
    ['Synthetic history',`${cfg.data.n_blocks} blocks × ${cfg.data.block_hands.toLocaleString()} hands; generating win rate ${cfg.data.true_winrate} and SD ${cfg.data.true_std} bb/100; seed ${cfg.data.seed}.`],
    ['Observed estimate',`${estimate.winrate_bb100.toFixed(2)} bb/100; estimated SD ${estimate.std_bb100.toFixed(2)} bb/100.`],
    ['Estimation uncertainty',`Autocorrelation-adjusted SE ${estimate.se_winrate_adjusted.toFixed(2)} bb/100; effective blocks ${estimate.effective_n_blocks.toFixed(1)}. This SE enters the posterior.`],
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
  Plotly.react('lab_u_risk_chart',[{type:'bar',orientation:'h',x:[risk.expected_risk*100,risk.plug_in_risk*100],y:['With uncertainty','One estimate'],marker:{color:['#C4B5FD',C.median]},text:[pct(risk.expected_risk),pct(risk.plug_in_risk)],textposition:'outside',textfont:{color:C.text,size:13},cliponaxis:false,hovertemplate:'%{y}<br>Risk %{x:.1f}%<extra></extra>'}],riskLay,CFG);
  const start=post.mean-4*post.std,end=post.mean+4*post.std;
  const xs=Array.from({length:241},(_,i)=>start+(end-start)*i/240);
  const density=xs.map(x=>Math.exp(-.5*((x-post.mean)/post.std)**2)/(post.std*Math.sqrt(2*Math.PI)));
  const postLay=layout('','Win rate (bb/100)','Density');
  postLay.margin={l:50,r:12,t:12,b:49};postLay.showlegend=false;postLay.xaxis.fixedrange=true;postLay.yaxis.fixedrange=true;postLay.yaxis.rangemode='tozero';
  postLay.shapes=[{type:'line',x0:0,x1:0,yref:'paper',y0:0,y1:1,line:{color:C.muted,dash:'dash',width:1.5}}];
  Plotly.react('lab_u_posterior',[{x:xs,y:density,mode:'lines',fill:'tozeroy',fillcolor:'rgba(196,181,253,.12)',line:{color:'#C4B5FD',width:2.4},hovertemplate:'Win rate %{x:.2f} bb/100<br>Density %{y:.3f}<extra></extra>'},
    {x:[post.mean],y:[1/(post.std*Math.sqrt(2*Math.PI))],mode:'markers',marker:{color:'#C4B5FD',size:7},hovertemplate:'Posterior mean %{x:.2f} bb/100<extra></extra>'}],postLay,CFG);
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
  $('lab_paths').textContent=p.paths.toLocaleString();
  const riskCount=Math.round(ror*100);
  $('lab_insight').className='lab-insight';
  $('lab_insight').textContent=`About ${riskCount} in 100 simulated bankrolls hit zero within ${Math.round(p.hands/1000)}k hands at these settings.`;
  $('lab_active_scenario').textContent=`${p.bank/100} buy-ins · ${p.wr} bb/100 edge · ${p.sd} bb/100 swings · ${Math.round(p.hands/1000)}k hands`;
  labHasResult=true;
  $('lab_live').dataset.state='current';
  $('lab_live').setAttribute('aria-busy','false');
  $('lab_run_state').textContent='Current result';
  $('lab_save_a').disabled=false;
  renderLabComparison();
  renderLabGuide();
  if(labLoadCheck){
    const check=labLoadCheck;labLoadCheck=null;
    const same=check.inputs.winrate_bb100===p.wr&&check.inputs.std_bb100===p.sd&&check.inputs.bankroll_bi===p.bank/100&&check.inputs.hands===p.hands&&check.inputs.paths===p.paths;
    if(same){
      const pct=v=>(v*100).toFixed(2)+'%';
      renderLabSaved(Math.abs(ror-check.risk)<1e-12
        ?`Loaded “${check.name}”. B was recomputed from its saved inputs and seed and matches the saved result (${pct(ror)}).`
        :`Loaded “${check.name}”. Recomputed B is ${pct(ror)}; the saved value was ${pct(check.risk)}. ${check.version!==result.model?.version?'The model version has changed since it was saved.':'The engine gave a different result for the same inputs.'}`);
    }
  }
  $('lab_fan').setAttribute('aria-label',$('lab_insight').textContent+' Shaded bands show the middle 50 and 90 percent of stored paths; selected example paths and the median show how bankroll changes over time.');
  if(!plotlyReady()){chartUnavailable('lab_fan');return;}
  const tr=[],L=r.xs.length,p05=r.p05,p25=r.p25,p50=r.p50,p75=r.p75,p95=r.p95;
  if(r.paths.length>=20){
    tr.push({x:r.xs.concat(r.xs.slice().reverse()),y:p95.concat(p05.slice().reverse()),fill:'toself',fillcolor:'rgba(56,189,248,.065)',line:{color:'rgba(0,0,0,0)'},hoverinfo:'skip',showlegend:false});
    tr.push({x:r.xs.concat(r.xs.slice().reverse()),y:p75.concat(p25.slice().reverse()),fill:'toself',fillcolor:'rgba(56,189,248,.19)',line:{color:'rgba(0,0,0,0)'},hoverinfo:'skip',showlegend:false});
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
      line:{color:ruined?'rgba(248,113,113,.36)':'rgba(125,211,252,.19)',width:ruined?1.1:0.9,dash:ruined?'dot':'solid'},
      text:Array(L).fill(ruined?'Reached ruin':'Survived horizon'),
      hovertemplate:`Example ${displayIndex+1}<br>%{x:,} hands<br>%{y:.1f} BI<br>%{text}<extra></extra>`,showlegend:false});
  });
  tr.push({x:r.xs,y:p50,mode:'lines',line:{color:C.median,width:3},
    hovertemplate:'Median<br>%{x:,} hands<br>%{y:.1f} BI<extra></extra>',showlegend:false});
  tr.push({x:[0,p.hands],y:[p50[0],p50[L-1]],mode:'markers',marker:{color:C.median,size:[6,8],line:{color:'#0B1220',width:1.5}},hoverinfo:'skip',showlegend:false});
  const lay=layout('','Hands played','Bankroll (buy-ins)');
  lay.margin=compact?{l:48,r:12,t:15,b:46}:{l:60,r:24,t:18,b:52};lay.showlegend=false;lay.hovermode='closest';lay.yaxis.rangemode='tozero';
  lay.xaxis.tickformat='~s';lay.xaxis.fixedrange=true;lay.xaxis.automargin=true;
  lay.yaxis.fixedrange=true;lay.yaxis.automargin=true;
  lay.shapes=[{type:'line',x0:0,x1:p.hands,y0:p.bank/div,y1:p.bank/div,line:{color:C.muted,dash:'dot',width:1}},
              {type:'line',x0:0,x1:p.hands,y0:p.thr/div,y1:p.thr/div,line:{color:C.ruin,dash:'dash',width:1.4}}];
  lay.annotations=[
    {x:0,y:p.bank/div,xanchor:'left',yanchor:'bottom',xshift:8,yshift:7,text:`START ${(p.bank/div).toFixed(0)} BI`,showarrow:false,bgcolor:'rgba(11,18,32,.82)',borderpad:3,font:{color:C.muted,size:10,family:'ui-monospace'}},
    {x:0,y:p.thr/div,xanchor:'left',yanchor:'bottom',xshift:8,yshift:7,text:'0 BI · RUIN',showarrow:false,bgcolor:'rgba(11,18,32,.82)',borderpad:3,font:{color:C.ruin,size:10,family:'ui-monospace'}},
    {x:p.hands,y:p50[L-1],xanchor:'right',yanchor:'bottom',xshift:-7,yshift:8,text:`MEDIAN ${p50[L-1].toFixed(1)} BI`,showarrow:false,bgcolor:'rgba(11,18,32,.86)',bordercolor:'rgba(251,191,36,.24)',borderwidth:1,borderpad:4,font:{color:C.median,size:compact?10:11,family:'ui-monospace'}}
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
  $('lab_curve_context').textContent=`Current assumptions · ${curve.pathsPerPoint} Monte Carlo paths per point, with the same simulated swings at every bankroll · shaded band = pointwise 95% interval · finite-horizon Brownian comparison.`;
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
    else if(labCurveKey===key)$('lab_curve_context').textContent='Current assumptions · retained Monte Carlo curve · finite-horizon Brownian comparison.';
    $('lab_status').textContent=p.paths===LAB_DETAILED_PATHS?'Detailed run complete':'Quick run complete';
  }catch(error){if(request===labRequest){
    $('lab_status').textContent=errorMessage(error);
    $('lab_live').dataset.state='error';$('lab_live').setAttribute('aria-busy','false');
    $('lab_run_state').textContent=labHasResult?'Update failed · showing the previous calculation':'Update failed · no result yet';
    if(labSavedA){$('lab_compare').setAttribute('aria-busy','false');$('lab_compare_state').textContent='Update failed. A stays saved; B is the previous result.';}
    if(!labHasResult)$('lab_insight').textContent=errorMessage(error);
    renderLabGuide();
  }}
  finally{if(request===labRequest){labController=null;labTrigger=null;if(trigger)setBusy(trigger,false);}}
}
document.querySelectorAll('.labpreset').forEach(button=>button.addEventListener('click',()=>{
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
  else if(id==='bankroll')runBankroll();
  else if(id==='preflop')loadPreflop();
}
tabs.forEach(tab=>tab.addEventListener('click',()=>initializeModule(tab.dataset.mod)));
renderSlots();initializeModule(initialTab.dataset.mod);
