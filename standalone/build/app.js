/* ================= Poker Analytics Suite — public UI logic =================
   Core calculations run on the private same-origin API and are deliberately
   excluded from the browser bundle. */
"use strict";

/* ---------- shared: Plotly theme ---------- */
const RANKS="23456789TJQKA";
const C={bg:'#0B1220',grid:'#243247',accent:'#38BDF8',ruin:'#F87171',pos:'#4ADE80',
  median:'#FBBF24',text:'#E6EDF3',muted:'#94A3B8',band:'rgba(56,189,248,0.16)'};
const CFG={displayModeBar:false,responsive:true};
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
const initialTab=tabs.find(t=>'#'+t.dataset.mod===location.hash)||tabs[0];
activateTab(initialTab,false);

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
function markEquityDirty(){const verdict=$('eq_verdict');if(verdict.style.display!=='none'){verdict.className='result-insight caution';verdict.textContent='Cards or opponents changed — compute equity to refresh this result.';}}
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
$('eq_clear').addEventListener('click',()=>{Object.keys(cardState).forEach(k=>cardState[k]=null);activeOpponents=[0];randomOpponents.fill(false);renderSlots();markEquityDirty();});
// one-click example matchups (beginner friendly)
const EXAMPLES={
  aakk:{hero:[51,38],vill:[50,24],random:false},   // A♠A♥ vs K♠K♦
  aks22:{hero:[38,37],vill:[0,13],random:false},   // A♥K♥ vs 2♣2♦
  random:{hero:[51,50],random:true}                // A♠K♠ vs random
};
document.querySelectorAll('.exbtn').forEach(b=>b.addEventListener('click',()=>{
  const ex=EXAMPLES[b.dataset.ex]; if(!ex) return;
  Object.keys(cardState).forEach(k=>cardState[k]=null);
  activeOpponents=[0];randomOpponents.fill(false);
  cardState.hero0=ex.hero[0]; cardState.hero1=ex.hero[1];
  if(ex.vill){cardState.opp0a=ex.vill[0]; cardState.opp0b=ex.vill[1];}
  randomOpponents[0]=!!ex.random;
  renderSlots(); runEquity(true);
}));

let equityRequest=0;
let equityController=null;
async function runEquity(showResult=false){
  $('eq_err').textContent='';
  const hero=SLOTS.hero.map(s=>cardState[s]).filter(v=>v!=null);
  if(hero.length!==2){$('eq_err').textContent='Pick 2 cards for your hand.';return;}
  const board=SLOTS.board.map(s=>cardState[s]).filter(v=>v!=null);
  const opponents=[];
  for(let position=0;position<activeOpponents.length;position++){
    const idx=activeOpponents[position];
    if(randomOpponents[idx]){opponents.push(null);continue;}
    const hand=opponentSlots(idx).map(s=>cardState[s]).filter(v=>v!=null);
    if(hand.length!==2){$('eq_err').textContent=`Pick 2 cards for opponent ${position+1}, or mark that hand as unknown / random.`;return;}
    opponents.push(hand);
  }

  const trials=clamp(parseInt($('eq_trials').value)||30000,1000,200000);
  $('eq_trials').value=trials;
  const seed=parseInt($('eq_seed').value)||42;
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
      :'Monte Carlo estimate; standard error ≈ '+(Math.sqrt(res.equity*(1-res.equity)/res.trials)*100).toFixed(2)+' pts.';
    window.__lastEquity=eqp;
    const cardText=i=>RANKS[i%13]+SUIT_SYM[Math.floor(i/13)];
    const opponentText=opponents.map((hand,index)=>hand?hand.map(cardText).join(' '):`Opponent ${index+1} random`).join(' · ');
    window.__lastEquityContext=hero.map(cardText).join(' ')+' vs '+opponentText+(board.length?' · board '+board.map(cardText).join(' '):'');
    if(window.__equityMode!=='manual')useCardEquity(true);
    if(showResult&&matchMedia('(max-width:860px)').matches)$('eq_results').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});
  }catch(error){
    if(request===equityRequest)$('eq_err').textContent=errorMessage(error);
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
async function runEV(){
  const pot=parseFloat($('ev_pot').value),bet=parseFloat($('ev_bet').value),equityPct=parseFloat($('ev_eq').value);
  $('ev_err').textContent='';
  if(!Number.isFinite(pot)||!Number.isFinite(bet)||!Number.isFinite(equityPct)||pot<0||bet<=0||equityPct<0||equityPct>100){
    $('ev_err').textContent='Enter a non-negative pot, a call above 0, and equity from 0% to 100%.';return;
  }
  const request=++evRequest;
  evController?.abort();const controller=new AbortController();evController=controller;
  try{
  const result=await apiJSON('/api/ev',{pot,call:bet,equityPct},15000,controller.signal);
  if(request!==evRequest)return;
  const eq=result.equity,potOdds=result.potOdds,reqEq=result.requiredEquity,evCall=result.evCall,good=result.profitable;
  $('ev_kpis').innerHTML=
    kpiCard('Pot odds', (potOdds*100).toFixed(1)+'%','call / (pot+call)')+
    kpiCard('Required equity',(reqEq*100).toFixed(1)+'%','to break even')+
    kpiCard('Your equity',(eq*100).toFixed(1)+'%','')+
    kpiCard('EV of calling', (evCall>=0?'+':'')+evCall.toFixed(2)+' bb','vs folding (0 bb)');
  rollKpis('ev_kpis');
  const requiredPct=(reqEq*100).toFixed(1),equityValue=(eq*100).toFixed(1);
  $('ev_required_value').textContent=requiredPct+'%';
  $('ev_equity_value').textContent=equityValue+'%';
  $('ev_required_bar').style.width=Math.min(100,Math.max(0,reqEq*100))+'%';
  $('ev_equity_bar').style.width=Math.min(100,Math.max(0,eq*100))+'%';
  animateResultBar($('ev_required_bar'));animateResultBar($('ev_equity_bar'));
  $('ev_comparison').setAttribute('aria-label',`Required equity ${requiredPct} percent; your card equity ${equityValue} percent.`);
  $('ev_results').classList.toggle('is-positive',good);
  $('ev_results').classList.toggle('is-negative',!good);
  $('ev_verdict').innerHTML=`<span class="pill" style="background:${good?'rgba(74,222,128,.16)':'rgba(248,113,113,.16)'};color:${good?C.pos:C.ruin}">`+
    (good?'Call is +EV':'Fold — call is −EV')+`</span> <span class="neutral">at these pot odds you need ${(reqEq*100).toFixed(1)}% equity; you have ${(eq*100).toFixed(1)}%.</span>`;
  $('ev_expl').innerHTML=`Calling ${bet} bb into a ${pot} bb pot means you risk ${bet} to win ${(pot+bet).toFixed(0)}. `+
    `Break-even equity is ${(reqEq*100).toFixed(1)}%. This ignores future betting (implied/reverse-implied odds).`;
  }catch(error){if(request===evRequest)$('ev_err').textContent=errorMessage(error);}
  finally{if(request===evRequest)evController=null;}
}
$('ev_run').addEventListener('click',runEV);
$('ev_choose_hand').addEventListener('click',()=>document.querySelector('.nav .t[data-mod="equity"]').click());
$('ev_use_cards').addEventListener('click',()=>useCardEquity(true));
$('ev_eq').addEventListener('input',()=>{window.__equityMode='manual';updateEVEquitySource();runEV();});
let _evT=null;
['ev_pot','ev_bet'].forEach(id=>$(id).addEventListener('input',()=>{clearTimeout(_evT);_evT=setTimeout(runEV,100);}));

/* ================= 3. BANKROLL RISK ================= */
let bankrollRequest=0;
let bankrollController=null;
async function runBankroll(){
  const BI=100;
  const p={wr:+$('bk_wr').value,sd:Math.max(0,+$('bk_sd').value),bank:+$('bk_bank').value*BI,thr:+$('bk_thr').value*BI,
    hands:clamp(Math.round(+$('bk_hands').value)||100000,100,1000000),paths:clamp(Math.round(+$('bk_paths').value)||6000,100,20000),
    seed:Math.round(+$('bk_seed').value)};
  $('bk_hands').value=p.hands;$('bk_paths').value=p.paths;
  if(p.bank<=p.thr){$('bk_kpis').innerHTML=kpiCard('Error','—','bankroll must exceed threshold');return;}
  const request=++bankrollRequest;
  bankrollController?.abort();const controller=new AbortController();bankrollController=controller;
  setBusy($('bk_run'),true,'Simulating…');
  try{
  const result=await apiJSON('/api/bankroll',p,60000,controller.signal);
  if(request!==bankrollRequest)return;
  const r=result.fan,curve=result.curve,metrics=result.metrics;
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
  }catch(error){if(request===bankrollRequest)$('bk_kpis').innerHTML=kpiCard('Service error','—',errorMessage(error));}
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

/* ================= 4. GTO TRAINER ================= */
const KUHN_LABELS={J:'J (bet/check first)',Q:'Q (bet/check first)',K:'K (bet/check first)',
  Jp:'J after opp check',Qp:'Q after opp check',Kp:'K after opp check',
  Jb:'J facing a bet',Qb:'Q facing a bet',Kb:'K facing a bet',
  Jpb:'J facing a bet (after checking)',Qpb:'Q facing a bet (after checking)',Kpb:'K facing a bet (after checking)'};
let gtoRequest=0;
let gtoController=null;
async function runGTO(){
  const iters=clamp(parseInt($('gto_iters').value)||300000,10000,500000);
  const seed=parseInt($('gto_seed').value)||42;
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
    $('gto_check').innerHTML=`Equilibrium checks: value ≈ −1/18 ✓ · bluff-bet K/J ratio = ${ratio} (theory ≈ 3) · Q rarely bets first (${(bQ*100).toFixed(1)}%). These match the known Kuhn solution.`;
  }catch(error){if(request===gtoRequest)$('gto_check').textContent=errorMessage(error);}
  finally{if(request===gtoRequest){gtoController=null;$('gto_spin').style.display='none';setBusy($('gto_run'),false);}}
}
$('gto_run').addEventListener('click',runGTO);

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
const pfCache=new Map();
const pfTrainer={position:0,hand:'A5s',answered:false,attempts:0,correct:0,mixed:0,streak:0,scenarioId:null,order:[]};

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
function renderPfMeta(scenario){
  $('pf_meta').innerHTML=[
    ['Game',scenario.game],['Table',scenario.table],['Stack',scenario.stack+'bb'],['Hero',scenario.hero],
    ['Situation',scenario.situation],['Opponent',scenario.opponent],['Open size',scenario.openSize],
  ].map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
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
  ['pf_scenario','pf_compare_a','pf_compare_b'].forEach(id=>{const el=$(id);if(el)el.innerHTML=options;});
  $('pf_scenario').value=pfScenario.id;
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
  $('pf_status').textContent='Loading demonstration range…';
  try{
    const scenario=await getPfScenario(scenarioId||'cash-6max-100-btn-rfi-25');
    if(request!==pfRequest)return;
    pfScenario=scenario;
    if(pfTrainer.scenarioId!==scenario.id)resetPfTrainer(scenario);
    fillPfScenarioSelects();
    renderPfLibrary();
    $('pf_status').textContent=`${pfScenarios.length} demo scenarios · 169 starting hands · private range API`;
  }catch(error){if(request===pfRequest)$('pf_status').textContent=errorMessage(error);}
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
}
async function renderPfCompare(){
  if(!pfScenarios.length)return;
  $('pf_status').textContent='Loading compared ranges…';
  try{
    const [scenarioA,scenarioB]=await Promise.all([getPfScenario($('pf_compare_a').value),getPfScenario($('pf_compare_b').value)]);
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
    $('pf_status').textContent='Comparison ready · select any hand in either matrix';
  }catch(error){$('pf_status').textContent=errorMessage(error);}
}
function trainerScenario(){return pfScenario||pfCache.values().next().value;}
function renderPfTrainer(){
  const scenario=trainerScenario();if(!scenario)return;
  ensurePfTrainer(scenario);
  const hand=pfHand(scenario,pfTrainer.hand)||pfHand(scenario,pfTrainer.order[pfTrainer.position]);
  pfTrainer.hand=hand.hand;
  $('pf_trainer_scenario').textContent=scenario.title+' · Demo strategy dataset';
  $('pf_trainer_cards').innerHTML=pfCardHtml(hand.hand);
  $('pf_trainer_hand').textContent=hand.hand;
  $('pf_trainer_guidance').textContent=pfTrainer.answered?hand.guidance:'Choose an action to reveal the demonstration frequencies.';
  $('pf_trainer_bar').innerHTML=PF_ACTIONS.filter(action=>hand.actions[action]>0).map(action=>`<span style="width:${hand.actions[action]}%;background:${PF_COLORS[action]}"></span>`).join('');
  $('pf_trainer_bar').setAttribute('aria-label',pfActionAria(hand));
  document.querySelectorAll('.pf-action-button').forEach(button=>{button.disabled=pfTrainer.answered;button.classList.remove('is-chosen');});
  if(!pfTrainer.answered){$('pf_feedback').className='pf-feedback';$('pf_feedback').innerHTML='';}
  $('pf_stat_hands').textContent=`${Math.min(pfTrainer.attempts,pfTrainer.order.length)} / ${pfTrainer.order.length}`;
  $('pf_stat_accuracy').textContent=pfTrainer.attempts?Math.round(100*pfTrainer.correct/pfTrainer.attempts)+'%':'—';
  $('pf_stat_mixed').textContent=pfTrainer.mixed;
  $('pf_stat_streak').textContent=pfTrainer.streak;
  $('pf_status').textContent=`Trainer ready · all ${pfTrainer.order.length} starting hands included`;
}
function answerPfTrainer(action,button){
  if(pfTrainer.answered)return;
  const hand=pfHand(trainerScenario(),pfTrainer.hand);if(!hand)return;
  pfTrainer.answered=true;pfTrainer.attempts+=1;
  const acceptable=hand.actions[action]>0;
  const mixed=PF_ACTIONS.filter(name=>hand.actions[name]>0).length>1;
  if(acceptable){pfTrainer.correct+=1;pfTrainer.streak+=1;}else pfTrainer.streak=0;
  if(mixed)pfTrainer.mixed+=1;
  button.classList.add('is-chosen');
  document.querySelectorAll('.pf-action-button').forEach(item=>item.disabled=true);
  const title=acceptable?(mixed?'Good decision — mixed strategy':'Good decision for this demo range'):'Not included in this demo mix';
  $('pf_feedback').className='pf-feedback is-visible';
  $('pf_feedback').innerHTML=`<strong>${title}</strong><p>${PF_LABELS[action]} appears ${hand.actions[action]}% of the time. ${pfActionAria(hand)}.</p>`;
  $('pf_trainer_guidance').textContent=hand.guidance;
  $('pf_stat_hands').textContent=`${Math.min(pfTrainer.attempts,pfTrainer.order.length)} / ${pfTrainer.order.length}`;
  $('pf_stat_accuracy').textContent=Math.round(100*pfTrainer.correct/pfTrainer.attempts)+'%';
  $('pf_stat_mixed').textContent=pfTrainer.mixed;$('pf_stat_streak').textContent=pfTrainer.streak;
}
function nextPfTrainerHand(){
  const scenario=trainerScenario();if(!scenario)return;
  ensurePfTrainer(scenario);
  if(pfTrainer.attempts>=pfTrainer.order.length){
    resetPfTrainer(scenario);
  }else{
    pfTrainer.position=(pfTrainer.position+1)%pfTrainer.order.length;
    pfTrainer.hand=pfTrainer.order[pfTrainer.position];
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

document.querySelectorAll('.pf-mode').forEach(button=>button.addEventListener('click',()=>activatePfMode(button.dataset.pfMode)));
$('pf_scenario').addEventListener('change',async()=>{
  const scenario=await getPfScenario($('pf_scenario').value);
  pfScenario=scenario;resetPfTrainer(scenario);renderPfLibrary();$('pf_status').textContent='Range loaded · select a hand for its exact mix';
});
['pf_compare_a','pf_compare_b'].forEach(id=>$(id).addEventListener('change',renderPfCompare));
$('pf_swap').addEventListener('click',()=>{const a=$('pf_compare_a').value;$('pf_compare_a').value=$('pf_compare_b').value;$('pf_compare_b').value=a;renderPfCompare();});
['pf_matrix','pf_matrix_a','pf_matrix_b'].forEach(id=>$(id).addEventListener('click',event=>{const cell=event.target.closest('[data-pf-hand]');if(cell)selectPfHand(cell.dataset.pfHand,id);}));
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
function updateLabLabels(){
  $('lab_wr_v').textContent=(+$('lab_wr').value).toFixed(1)+' bb/100';
  $('lab_bank_v').textContent=(+$('lab_bank').value)+' buy-ins';
  $('lab_sd_v').textContent=(+$('lab_sd').value)+' bb/100';
  $('lab_hn_v').textContent=(Math.round(+$('lab_hn').value/1000))+'k hands';
}
function renderLab(result){
  const div=100,p=result.params,r=result.fan,ror=result.metrics.risk,[lo,hi]=result.metrics.confidenceInterval;
  rollNumber($('lab_ror'),(ror*100).toFixed(1)+'%');
  $('lab_ci').textContent=`95% CI ${(lo*100).toFixed(1)}–${(hi*100).toFixed(1)}%`;
  rollNumber($('lab_surv'),(result.metrics.survival*100).toFixed(1)+'%');
  rollNumber($('lab_dd'),result.metrics.p95Drawdown.toFixed(1)+' BI');
  rollNumber($('lab_paths'),p.paths.toLocaleString());
  const riskCount=Math.round(ror*100),riskTone=ror<0.05?'positive':ror<0.2?'caution':'negative';
  $('lab_insight').className='result-insight '+riskTone;
  $('lab_insight').textContent=`About ${riskCount} in 100 simulated bankrolls hit zero within ${Math.round(p.hands/1000)}k hands at these settings.`;
  rollNumber($('lab_chart_risk'),`${riskCount}%`);
  $('lab_chart_risk_badge').className='lab-risk-badge '+riskTone;
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
  $('lab_chart_meta').textContent=`${p.paths.toLocaleString()} simulations · ${shown} examples shown · ${Math.round(p.hands/1000)}k hands`;
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
  if(!plotlyReady()){chartUnavailable('lab_curve');return;}
  const div=100;
  const lay=layout('Risk of ruin vs bankroll','Bankroll (buy-ins)','Risk of ruin',{yaxis:{tickformat:'.0%',gridcolor:C.grid}});
  lay.shapes=[{type:'line',x0:p.bank/div,x1:p.bank/div,yref:'paper',y0:0,y1:1,line:{color:C.median,dash:'dot',width:1.3}}];
  Plotly.react('lab_curve',[{x:curve.xs,y:curve.monteCarlo,mode:'lines+markers',line:{color:C.accent,width:2.2},name:'Monte Carlo'},
    {x:curve.xs,y:curve.analytical,mode:'lines',line:{color:C.muted,dash:'dash',width:1.5},name:'Brownian (finite)'}],lay,CFG);
}
let _labT=null;
let labRequest=0;
let labController=null;
let labTrigger=null;
let labHasCurve=false;
async function runLab(paths,trigger=null){
  const reuseCurve=Boolean(trigger&&labHasCurve);
  const p=labParams(paths||LAB_QUICK_PATHS,!reuseCurve);
  updateLabLabels();
  labController?.abort();
  if(labTrigger)setBusy(labTrigger,false);
  const controller=new AbortController();labController=controller;labTrigger=trigger;
  $('lab_status').textContent=p.paths.toLocaleString()+' paths · seed 42 · simulating…';
  if(trigger)setBusy(trigger,true,`Running ${Math.round(p.paths/1000)}k paths…`);
  const request=++labRequest;
  try{
    const result=await apiJSON('/api/risk-lab',p,70000,controller.signal);
    if(request!==labRequest)return;
    renderLab(result);
    if(result.curve){renderLabCurve(result.params,result.curve);labHasCurve=true;}
    $('lab_status').textContent=p.paths.toLocaleString()+' paths · seed 42 · private server';
  }catch(error){if(request===labRequest){$('lab_status').textContent=errorMessage(error);$('lab_insight').className='result-insight negative';$('lab_insight').textContent=errorMessage(error);}}
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
    updateLabLabels();clearTimeout(_labT);$('lab_status').textContent='Release the slider to update the simulation.';
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
  if(id==='risklab')runLab(LAB_QUICK_PATHS);
  else if(id==='equity')runEquity();
  else if(id==='ev')runEV();
  else if(id==='bankroll')runBankroll();
  else if(id==='preflop')loadPreflop();
}
tabs.forEach(tab=>tab.addEventListener('click',()=>initializeModule(tab.dataset.mod)));
renderSlots();initializeModule(initialTab.dataset.mod);
