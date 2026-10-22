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
function markEquityDirty(){
  ++equityRequest;equityController?.abort();equityController=null;
  $('eq_spin').style.display='none';setBusy($('eq_run'),false);
  window.__lastEquity=null;window.__lastEquityContext=null;$('eq_toev').disabled=true;
  const verdict=$('eq_verdict');verdict.style.display='block';verdict.className='result-insight caution';
  verdict.textContent='Cards or opponents changed — compute equity to refresh this result.';
  if(window.__equityMode!=='manual'){
    ++evRequest;evController?.abort();evController=null;
    $('ev_eq_display').textContent='Needs calculation';$('ev_eq_context').textContent='Cards changed. Calculate their equity before evaluating the call.';
    $('ev_results').dataset.state='pending';$('ev_result_state').textContent=evCurrentResult?'Previous result · card equity changed':'Calculate card equity first';
    $('ev_test_equity').disabled=true;$('ev_reset_test').disabled=true;
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
function showEquityError(message){
  $('eq_err').textContent=message;
  if(window.__equityMode!=='manual'){$('ev_err').textContent=message;$('ev_result_state').textContent=evCurrentResult?'Previous result · card calculation unavailable':'Card calculation unavailable';}
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
    vd.className='result-insight '+tone;vd.textContent=vtxt;
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
    if(window.__equityMode!=='manual')useCardEquity(true);
    if(showResult&&matchMedia('(max-width:860px)').matches)$('eq_results').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});
  }catch(error){
    if(request===equityRequest)showEquityError(errorMessage(error));
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
let evTestPct=null;
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
function renderEV(result){
  evCurrentResult=result;
  const gap=(result.equity-result.requiredEquity)*100,zero=Math.abs(result.evCall)<1e-9;
  $('ev_main_value').textContent=evAmount(zero?0:result.evCall);
  $('ev_gap').textContent=signedValue(Math.abs(gap)<1e-9?0:gap)+' pp';
  $('ev_gap_note').textContent=Math.abs(gap)<1e-9?'At break-even':gap>0?'Above break-even':'Below break-even';
  $('ev_current_pct').textContent=(result.equity*100).toFixed(1)+'%';
  $('ev_threshold_pct').textContent=(result.requiredEquity*100).toFixed(1)+'%';
  $('ev_verdict').textContent=zero?'Break-even in this model':result.evCall>0?'Positive EV relative to folding (0 bb)':'Negative EV relative to folding (0 bb)';
  $('ev_results').classList.toggle('is-positive',!zero&&result.evCall>0);
  $('ev_results').classList.toggle('is-negative',!zero&&result.evCall<0);
  $('ev_results').dataset.state='current';
  $('ev_result_state').textContent=`${window.__equityMode==='manual'?'Manual':'Card'} equity · pot and call held fixed`;
  $('ev_test_equity').disabled=false;$('ev_reset_test').disabled=false;
  evTestPct=result.equity*100;
  $('ev_test_equity').value=(result.equity*100).toFixed(1);
  $('ev_expl').textContent=`EV = equity × ${result.pot} − (1 − equity) × ${result.call} bb. Equity uses a 0–1 fraction. This assumes a fixed eligible pot and no future betting, rake or side pots. The curve explores equity assumptions; it is not a confidence interval.`;
  renderEVSensitivity();
}
async function runEV(){
  if(window.__equityMode!=='manual'&&window.__lastEquity==null){
    $('ev_result_state').textContent='Calculating card equity first…';
    if(!equityController)runEquity();
    return;
  }
  const pot=parseFloat($('ev_pot').value),bet=parseFloat($('ev_bet').value),equityPct=parseFloat($('ev_eq').value);
  const request=++evRequest;
  evController?.abort();evController=null;
  $('ev_err').textContent='';
  $('ev_results').dataset.state='pending';
  $('ev_test_equity').disabled=true;$('ev_reset_test').disabled=true;
  if(!Number.isFinite(pot)||!Number.isFinite(bet)||!Number.isFinite(equityPct)||pot<0||bet<=0||equityPct<0||equityPct>100){
    $('ev_err').textContent='Enter a non-negative pot, a call above 0, and equity from 0% to 100%.';
    $('ev_result_state').textContent=evCurrentResult?'Previous result · check inputs':'Check inputs';return;
  }
  $('ev_result_state').textContent=evCurrentResult?'Previous result · updating…':'Calculating…';
  const controller=new AbortController();evController=controller;
  try{
  const result=await apiJSON('/api/ev',{pot,call:bet,equityPct},15000,controller.signal);
  if(request!==evRequest)return;
  renderEV(result);
  }catch(error){if(request===evRequest){$('ev_err').textContent=errorMessage(error);$('ev_result_state').textContent=evCurrentResult?'Update failed · previous result':'Calculation unavailable';}}
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
function markBankrollDirty(message='Inputs changed — run the simulation to update the previous result.'){
  ++bankrollRequest;bankrollController?.abort();bankrollController=null;setBusy($('bk_run'),false);
  $('bk_insight').textContent=message;$('bk_insight').className='result-insight caution';
  $('bk_result_state').textContent=$('bk_kpis').children.length?'Previous simulation — the numbers below do not represent the edited inputs.':'No completed simulation yet.';
  $('bk_kpis').style.opacity='.5';
  $('bk_fan').style.opacity='.5';$('bk_curve').style.opacity='.5';
}
// Mirrors the server's work ceiling (MAX_PATH_STEPS in server/compute.js): the main fan plus nine curve runs of clamp(10% of paths, 200, 500) paths, each over ceil(hands/100) steps.
const BK_MAX_PATH_STEPS=100000000;
function bankrollPathSteps(hands,paths){return Math.ceil(hands/100)*(paths+9*clamp(Math.round(paths*0.1),200,500));}
function maxBankrollPaths(hands){let paths=20000;while(paths>100&&bankrollPathSteps(hands,paths)>BK_MAX_PATH_STEPS)paths-=100;return paths;}
async function runBankroll(){
  const BI=100;
  markBankrollDirty('Calculating the current assumptions…');
  const fields=['bk_wr','bk_sd','bk_bank','bk_thr','bk_hands','bk_paths','bk_seed'];
  if(fields.some(id=>$(id).value.trim()===''||!Number.isFinite(Number($(id).value)))){
    $('bk_insight').textContent='Fill in all numeric inputs before running the simulation.';return;
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
  if(p.bank<=p.thr||+$('bk_sd').value<0){$('bk_insight').textContent='Bankroll must exceed the threshold; game swings must be non-negative.';return;}
  const request=++bankrollRequest;
  bankrollController?.abort();const controller=new AbortController();bankrollController=controller;
  setBusy($('bk_run'),true,'Simulating…');
  try{
  const result=await apiJSON('/api/bankroll',p,60000,controller.signal);
  if(request!==bankrollRequest)return;
  const r=result.fan,curve=result.curve,metrics=result.metrics;
  $('bk_fan').style.opacity='1';$('bk_curve').style.opacity='1';
  $('bk_kpis').style.opacity='1';$('bk_result_state').textContent='Current simulation · '+p.paths.toLocaleString()+' paths · seed '+p.seed;
  const ror=metrics.risk,med=metrics.medianTerminal,p95=metrics.p95Drawdown,pp=metrics.profitProbability;
  const rorCount=Math.round(ror*100),riskTone=ror<0.05?'positive':ror<0.2?'caution':'negative';
  $('bk_insight').className='result-insight '+riskTone;
  $('bk_insight').textContent=`About ${rorCount} in 100 simulated bankrolls reach the ruin threshold within ${Math.round(p.hands/1000)}k hands under these assumptions.`;
  $('bk_kpis').innerHTML=kpiCard('Risk of ruin',(ror*100).toFixed(1)+'%','over '+p.hands.toLocaleString()+' hands')+
    kpiCard('P95 max drawdown',p95.toFixed(1)+' BI','')+
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
  Plotly.react('bk_curve',[{x:curve.xs,y:curve.monteCarlo,mode:'lines+markers',line:{color:C.accent,width:2.2},name:'Monte Carlo'},
    {x:curve.xs,y:curve.analytical,mode:'lines',line:{color:C.muted,dash:'dash',width:1.5},name:'Brownian (finite)'}],lay2,CFG);
  }catch(error){if(request===bankrollRequest)$('bk_insight').textContent=errorMessage(error);}
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
const pfTrainer={position:0,hand:'A5s',answered:false,attempts:0,correct:0,mixed:0,streak:0,scenarioId:null,order:[],answers:new Map()};

function pfHandMap(scenario){return new Map((scenario?.hands||[]).map(hand=>[hand.hand,hand]));}
function pfHand(scenario,name){return (scenario?.hands||[]).find(hand=>hand.hand===name)||scenario?.hands?.[0]||null;}
function pfSeed(text){return [...text].reduce((seed,char)=>(Math.imul(seed,31)+char.charCodeAt(0))>>>0,2166136261);}
function pfFullTrainerOrder(scenario){
  const order=scenario.hands.map(hand=>hand.hand);
  let seed=pfSeed(scenario.id);
  for(let index=order.length-1;index>0;index-=1){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const swapIndex=seed%(index+1);
    [order[index],order[swapIndex]]=[order[swapIndex],order[index]];
  }
  return order;
}
function resetPfTrainer(scenario,preferredHand='A5s'){
  pfTrainer.scenarioId=scenario.id;
  pfTrainer.order=pfFullTrainerOrder(scenario);
  pfTrainer.position=Math.max(0,pfTrainer.order.indexOf(preferredHand));
  pfTrainer.hand=pfTrainer.order[pfTrainer.position];
  pfTrainer.answered=false;pfTrainer.attempts=0;pfTrainer.correct=0;pfTrainer.mixed=0;pfTrainer.streak=0;
  pfTrainer.answers.clear();
}
function ensurePfTrainer(scenario){
  if(pfTrainer.scenarioId!==scenario.id||pfTrainer.order.length!==scenario.hands.length)resetPfTrainer(scenario,pfTrainer.hand);
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
  target.innerHTML=scenario.hands.map(hand=>{
    const active=hand.hand===selectedName;
    const mixed=PF_ACTIONS.filter(action=>hand.actions[action]>0).length>1;
    const dominant=PF_ACTIONS.reduce((best,action)=>hand.actions[action]>hand.actions[best]?action:best,'fold');
    const note=mixed?`<small>${hand.actions[dominant]}%</small>`:'';
    return `<button type="button" class="pf-cell${active?' is-selected':''}${hand.actions.jam>0?' has-jam':''}" role="gridcell" data-pf-hand="${hand.hand}" style="background:${pfStrategyBackground(hand.actions)}" aria-label="${pfActionAria(hand)}" aria-pressed="${active}">${hand.hand}${note}</button>`;
  }).join('');
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
    if(pfTrainer.scenarioId!==scenario.id)resetPfTrainer(scenario);
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
function renderPfTrainer(){
  const scenario=trainerScenario();
  if(!scenario||pfLoading||pfFailed){
    document.querySelectorAll('.pf-action-button').forEach(button=>button.disabled=true);
    $('pf_next_hand').disabled=true;$('pf_next_hand').textContent='Choose an action first';
    $('pf_trainer_guidance').textContent=pfFailed?'Range unavailable. Retry loading above.':'Loading the training scenario…';
    return;
  }
  ensurePfTrainer(scenario);
  const hand=pfHand(scenario,pfTrainer.hand)||pfHand(scenario,pfTrainer.order[pfTrainer.position]);
  pfTrainer.hand=hand.hand;
  const saved=pfTrainer.answers.get(hand.hand);
  pfTrainer.answered=Boolean(saved);
  $('pf_trainer_scenario').textContent=scenario.title+' · Demo strategy dataset';
  renderPfContext(scenario,'pf_trainer_context');
  $('pf_trainer_cards').innerHTML=pfCardHtml(hand.hand);
  $('pf_trainer_hand').textContent=hand.hand;
  $('pf_trainer_guidance').textContent=pfTrainer.answered?hand.guidance:'Choose an action to reveal the demonstration frequencies.';
  $('pf_trainer_bar').innerHTML=PF_ACTIONS.filter(action=>hand.actions[action]>0).map(action=>`<span style="width:${hand.actions[action]}%;background:${PF_COLORS[action]}"></span>`).join('');
  $('pf_trainer_bar').setAttribute('aria-label',pfActionAria(hand));
  $('pf_trainer_bar').hidden=!saved;
  const availability=pfScenarioAvailability(scenario);
  document.querySelectorAll('.pf-action-button').forEach(button=>{
    const unavailable=!availability[button.dataset.action];
    button.disabled=pfTrainer.answered||unavailable;
    button.hidden=unavailable;
    button.classList.toggle('is-chosen',saved?.action===button.dataset.action);
    button.classList.toggle('is-unavailable',unavailable);
    button.title=unavailable?'This action is not available in the selected scenario.':'';
  });
  $('pf_decision_actions').style.setProperty('--pf-choice-count',PF_ACTIONS.filter(action=>availability[action]).length);
  if(saved){
    const title=saved.acceptable?(saved.mixed?'Accepted choice · mixed demo strategy':'Accepted choice in this demo range'):'This choice has zero frequency in the demo range';
    $('pf_feedback').className='pf-feedback is-visible';
    $('pf_feedback').innerHTML=`<strong>${title}</strong><p>${PF_LABELS[saved.action]}: ${hand.actions[saved.action]}%. ${pfActionAria(hand)}.</p>`;
  }else{$('pf_feedback').className='pf-feedback';$('pf_feedback').innerHTML='';}
  $('pf_next_hand').disabled=!saved;
  $('pf_next_hand').textContent=pfTrainer.answers.size>=pfTrainer.order.length?'Start new session':saved?'Next hand':'Choose an action first';
  $('pf_stat_hands').textContent=`${Math.min(pfTrainer.attempts,pfTrainer.order.length)} / ${pfTrainer.order.length}`;
  $('pf_stat_accuracy').textContent=pfTrainer.attempts?Math.round(100*pfTrainer.correct/pfTrainer.attempts)+'%':'—';
  $('pf_stat_mixed').textContent=pfTrainer.mixed;
  $('pf_stat_streak').textContent=pfTrainer.streak;
  $('pf_status').textContent=saved?'Answer recorded · choose Next hand':`Trainer ready · choose an action · ${pfTrainer.order.length} hand classes`;
}
function answerPfTrainer(action,button){
  if(pfTrainer.answered||pfLoading||pfFailed||!PF_ACTIONS.includes(action))return;
  const scenario=trainerScenario(),hand=pfHand(scenario,pfTrainer.hand);if(!hand||!pfScenarioAvailability(scenario)[action])return;
  if(pfTrainer.answers.has(hand.hand))return;
  pfTrainer.answered=true;pfTrainer.attempts+=1;
  const acceptable=hand.actions[action]>0;
  const mixed=PF_ACTIONS.filter(name=>hand.actions[name]>0).length>1;
  if(acceptable){pfTrainer.correct+=1;pfTrainer.streak+=1;}else pfTrainer.streak=0;
  if(mixed)pfTrainer.mixed+=1;
  pfTrainer.answers.set(hand.hand,{action,acceptable,mixed});
  renderPfTrainer();
}
function nextPfTrainerHand(){
  const scenario=trainerScenario();if(!scenario||pfLoading||pfFailed)return;
  ensurePfTrainer(scenario);
  if(!pfTrainer.answered)return;
  if(pfTrainer.attempts>=pfTrainer.order.length){
    resetPfTrainer(scenario);
  }else{
    for(let offset=1;offset<=pfTrainer.order.length;offset++){
      const position=(pfTrainer.position+offset)%pfTrainer.order.length;
      if(!pfTrainer.answers.has(pfTrainer.order[position])){pfTrainer.position=position;pfTrainer.hand=pfTrainer.order[position];break;}
    }
  }
  pfTrainer.answered=false;
  renderPfTrainer();
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
$('pf_compare_hand').addEventListener('click',()=>{pfCompareHand=pfSelectedHand;activatePfMode('compare');});
$('pf_change_hand').addEventListener('click',()=>{
  cardState.pf0=null;cardState.pf1=null;renderPfHandSlots();
  $('pf_change_status').textContent='Choose your first card; the second card picker opens automatically.';
  openPicker('pf0');
});
$('pf_practice_hand').addEventListener('click',()=>{
  const scenario=trainerScenario();if(!scenario)return;
  ensurePfTrainer(scenario);
  pfTrainer.position=Math.max(0,pfTrainer.order.indexOf(pfSelectedHand));
  pfTrainer.hand=pfSelectedHand;pfTrainer.answered=false;activatePfMode('trainer');
});
$('pf_decision_actions').addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(button)answerPfTrainer(button.dataset.action,button);});
$('pf_next_hand').addEventListener('click',nextPfTrainerHand);
$('pf_view_range').addEventListener('click',()=>{pfSelectedHand=pfTrainer.hand;setPfCardsFromClass(pfSelectedHand);activatePfMode('library');renderPfLibrary();});

/* ================= RISK LAB (research dashboard) ================= */
const LAB_QUICK_PATHS=2000;
const LAB_DETAILED_PATHS=16000;
function labParams(paths,includeCurve=true){return {wr:+$('lab_wr').value,sd:+$('lab_sd').value,bank:(+$('lab_bank').value)*100,thr:0,
  hands:Math.round(+$('lab_hn').value),paths:paths,seed:42,includeCurve};}
let labHasResult=false;
let labCurrentResult=null;
let labSavedA=null;
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
  const rows=[['Win rate (bb/100)','wr',v=>v.toFixed(1)],['Bankroll (BI)','bank',v=>(v/100).toFixed(0)],
    ['Swings (bb/100)','sd',v=>v.toFixed(0)],['Horizon (hands)','hands',v=>v.toLocaleString()]];
  const changes=rows.filter(([,key])=>a.params[key]!==b.params[key]);
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
$('lab_save_a').addEventListener('click',()=>{
  if(!labCurrentResult||$('lab_live').dataset.state!=='current')return;
  const firstSave=!labSavedA;
  labSavedA=structuredClone(labCurrentResult);
  $('lab_save_a').textContent='Replace A with current';renderLabComparison();
  if(firstSave)$('lab_compare').scrollIntoView({behavior:reducedMotion()?'auto':'smooth',block:'start'});
});
$('lab_clear_a').addEventListener('click',()=>{labSavedA=null;$('lab_compare').hidden=true;$('lab_save_a').textContent='Save current as A';$('lab_save_a').focus();});
$('lab_edit_b').addEventListener('click',()=>{$('lab_adjust').open=true;$('lab_wr').focus();$('lab_adjust').scrollIntoView({behavior:reducedMotion()?'auto':'smooth',block:'start'});});
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
  $('lab_run_state').textContent=(labHasResult?'Previous result · ':'')+message;
  $('lab_save_a').disabled=true;
  if(labHasCurve)$('lab_curve_context').textContent='Previous curve · waiting for the updated assumptions.';
  if(labSavedA){$('lab_compare').dataset.state='pending';$('lab_compare').setAttribute('aria-busy',String(busy));$('lab_compare_state').textContent='A stays saved. B shows the previous result until the update completes.';}
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
  $('lab_run_state').textContent='Current simulation';
  $('lab_save_a').disabled=false;
  renderLabComparison();
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
function renderLabCurve(p,curve){
  $('lab_curve_context').textContent=`Current assumptions · ${curve.pathsPerPoint} Monte Carlo paths per point · finite-horizon Brownian comparison.`;
  if(!plotlyReady()){chartUnavailable('lab_curve');return;}
  const div=100;
  const compact=$('lab_curve').clientWidth<620;
  const lay=layout('','Bankroll (buy-ins)','Risk of ruin',{yaxis:{tickformat:'.0%',gridcolor:C.grid}});
  lay.margin=compact?{l:48,r:12,t:14,b:100}:{l:62,r:22,t:18,b:76};
  lay.legend={orientation:'h',x:0,y:compact?-.4:-.25,xanchor:'left',yanchor:'top',font:{color:C.muted,size:compact?11:12}};
  lay.shapes=[{type:'line',x0:p.bank/div,x1:p.bank/div,yref:'paper',y0:0,y1:1,line:{color:C.median,dash:'dot',width:1.3}}];
  Plotly.react('lab_curve',[{x:curve.xs,y:curve.monteCarlo,mode:'lines+markers',line:{color:C.accent,width:2.2},name:'Monte Carlo'},
    {x:curve.xs,y:curve.analytical,mode:'lines',line:{color:C.muted,dash:'dash',width:1.5},name:'Brownian (finite)'}],lay,CFG);
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
    $('lab_run_state').textContent=labHasResult?'Update failed · previous result':'Simulation unavailable';
    if(labSavedA){$('lab_compare').setAttribute('aria-busy','false');$('lab_compare_state').textContent='Update failed. A stays saved; B is the previous result.';}
    if(!labHasResult)$('lab_insight').textContent=errorMessage(error);
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
