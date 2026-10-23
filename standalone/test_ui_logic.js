"use strict";
// Test the actual frontend state functions outside the browser:
//   node standalone/test_ui_logic.js
// Code is sliced out of standalone/build/app.js and run against a minimal DOM.
// Browser checks separately cover layout, pointer targets, focus and charts.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { computePreflop, computeEquity, compute } = require("../server/compute.js");
const { strToCard } = require("./engines/equity.js");
const source = fs.readFileSync(path.join(__dirname, "build", "app.js"), "utf8");
function slice(start, end) {
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,`Missing code boundary: ${start}`);
  return source.slice(a,b);
}
class Element {
  constructor(id){
    this.id=id;this.textContent="";this.innerHTML="";this.value="";this.children=[];
    this.hidden=false;this.disabled=false;this.dataset={};this.attributes={};
    this.style={setProperty:(k,v)=>this.style[k]=v};
    const classes=new Set();
    this.classList={toggle:(c,on)=>on?classes.add(c):classes.delete(c),add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)};
  }
  setAttribute(k,v){this.attributes[k]=v;}
  removeAttribute(k){delete this.attributes[k];}
  replaceChildren(...nodes){this.children=nodes;this.textContent=nodes.map(node=>node.textContent).join(" | ");}
}
function harness(storage=undefined){
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
  const buttons=["raise","call","jam","fold"].map(action=>{const e=new Element(action);e.dataset.action=action;return e;});
  const modes=["library","compare","trainer"].map(mode=>{const e=new Element(mode);e.dataset.pfMode=mode;return e;});
  const views=modes.map(e=>new Element(`pf-view-${e.id}`));
  const ctx=vm.createContext({console,$:get,...(storage?{localStorage:storage}:{}),RANKS:"23456789TJQKA",clamp:(v,lo,hi)=>Math.min(hi,Math.max(lo,v)),
    document:{createElement:()=>new Element(""),querySelectorAll:s=>s.includes("pf-action-button")?buttons:s===".pf-mode"?modes:s===".pf-view"?views:[]},
    renderPfContext:()=>{},pfCardHtml:hand=>hand,pfActionAria:hand=>JSON.stringify(hand.actions),renderPfMatrix:()=>{},
    renderPfLibrary:()=>{},errorMessage:error=>error.message,apiJSON:async(_p,input)=>computePreflop(input)});
  const code=[slice("const RESULT_STATE_LABELS=","function downloadText("),
    slice("const PF_ACTIONS=","function pfStrategyBackground"),
    slice("function pfScenarioAvailability(","function pfScenarioContext("),
    slice("function fillPfScenarioSelects(","function renderPfLibrary("),
    slice("async function getPfScenario(","function trainerScenario("),
    slice("function trainerScenario(","function selectPfHand("),
    slice("const LAB_INPUTS=","function renderLabComparison("),
    source.match(/function integerInput[^\n]+/)[0]].join("\n");
  vm.runInContext(code,ctx);
  return {get,buttons,ctx,run:code=>vm.runInContext(code,ctx)};
}
const scenarios=computePreflop({}).scenarios.map(summary=>computePreflop({scenarioId:summary.id}).scenario);
const mixedOf=hand=>Object.values(hand.actions).filter(v=>v>0).length>1;
// Load a scenario into a fresh harness with a fresh trainer state.
function trainerFor(scenario,size=20,storage=undefined){
  const h=harness(storage);h.ctx.scenario=scenario;
  h.run(`pfSetSize=${size};pfScenario=scenario;renderPfTrainer();`);
  return h;
}
const session=h=>h.run("pfSessionFor(pfScenario)");
const currentHand=h=>{const s=session(h);return h.run("pfScenario").hands.find(x=>x.hand===s.items[s.index].hand);};

async function main(){
  // --- Practice sets ---------------------------------------------------------------
  for(const scenario of scenarios){
    const h=harness();h.ctx.scenario=scenario;
    const mixedTotal=scenario.hands.filter(mixedOf).length;
    for(const size of [10,20,169]){
      const set=h.run(`pfBuildSet(scenario,${size},7)`);
      assert.equal(set.length,size);
      assert.equal(new Set(set.map(item=>item.hand)).size,size,"no hand repeats within a set");
      assert.deepEqual(JSON.parse(JSON.stringify(h.run(`pfBuildSet(scenario,${size},7)`))),JSON.parse(JSON.stringify(set)),"same serial, same set");
      const mixedInSet=set.filter(item=>mixedOf(scenario.hands.find(x=>x.hand===item.hand))).length;
      if(size<169)assert.ok(mixedInSet>=Math.min(mixedTotal,Math.ceil(size/2)),`${scenario.id}: about half of a ${size}-question set is mixed`);
      for(const item of set.filter(item=>item.kind==="frequency")){
        const hand=scenario.hands.find(x=>x.hand===item.hand),truth=hand.actions[item.action];
        assert.ok(mixedOf(hand),"frequency questions only use mixed hands");
        assert.notEqual(item.action,"fold");
        assert.equal(item.options.length,4);
        assert.equal(new Set(item.options).size,4);
        assert.ok(item.options.includes(truth)&&item.options.includes(100));
        const others=item.options.filter(v=>v!==100);
        for(const a of others)for(const b of others)if(a!==b)assert.ok(Math.abs(a-b)>=15,`${hand.hand}: options ${item.options} too close`);
      }
      if(size===20)assert.ok(set.some(item=>item.kind==="frequency"),"a 20-question set includes frequency questions");
    }
    assert.notDeepEqual(JSON.parse(JSON.stringify(h.run("pfBuildSet(scenario,20,1)"))),JSON.parse(JSON.stringify(h.run("pfBuildSet(scenario,20,2)"))),"a new set draws different hands");

    // Answer a whole 20-question set: alternate in-range and missed answers.
    const t=trainerFor(scenario,20);
    assert.equal(t.get("pf_next_hand").disabled,true);
    assert.equal(t.get("pf_trainer_bar").hidden,true);
    t.run("nextPfTrainerHand()");assert.equal(session(t).index,0,"cannot skip an unanswered question");
    let expectedMissed=0;
    const availability=Object.fromEntries(["raise","call","jam","fold"].map(a=>[a,scenario.hands.some(x=>x.actions[a]>0)]));
    for(let i=0;i<20;i++){
      const s=session(t),item=s.items[s.index],hand=currentHand(t);
      assert.equal(t.get("pf_question_count").textContent,`Question ${i+1} of 20`);
      assert.equal(t.get("pf_decision_actions").hidden,item.kind==="frequency");
      assert.equal(t.get("pf_frequency_options").hidden,item.kind!=="frequency");
      let answer;
      if(item.kind==="frequency"){
        const truth=hand.actions[item.action];
        answer=i%2===0?truth:item.options.find(v=>v!==truth);
        if(answer!==truth)expectedMissed++;
        t.ctx.answer=answer;t.run("answerPfTrainer(answer)");
        assert.ok(t.get("pf_frequency_options").innerHTML.includes("is-chosen"));
        assert.ok(t.get("pf_feedback").innerHTML.includes(answer===truth?"Correct":"Full mix"));
        if(answer===100)assert.ok(t.get("pf_feedback").innerHTML.includes("not played the same way every time"));
      }else{
        const inRange=["raise","call","jam","fold"].find(a=>hand.actions[a]>0);
        const zero=["raise","call","jam","fold"].find(a=>availability[a]&&hand.actions[a]===0);
        answer=i%2===1&&zero?zero:inRange;
        if(hand.actions[answer]===0)expectedMissed++;
        t.ctx.answer=answer;t.run("answerPfTrainer(answer)");
        const html=t.get("pf_feedback").innerHTML;
        if(hand.actions[answer]===0)assert.ok(html.includes("Not in this demo range"));
        else if(mixedOf(hand))assert.ok(html.includes("one answer cannot show the mix")&&(html.includes("in 10")||html.includes("in 20")),`mixed feedback for ${hand.hand}: ${html}`);
        else assert.ok(html.includes("always"));
      }
      assert.equal(t.get("pf_trainer_bar").hidden,false,"frequencies are revealed after answering");
      assert.equal(t.get("pf_next_hand").disabled,false);
      const before=t.get("pf_stat_progress").textContent;
      t.run(item.kind==="frequency"?"answerPfTrainer(answer)":"answerPfTrainer('fold')");
      assert.equal(t.get("pf_stat_progress").textContent,before,"a second answer is ignored");
      assert.equal(t.get("pf_stat_progress").textContent,`${i+1} / 20`);
      assert.equal(t.get("pf_next_hand").textContent,i===19?"See review":"Next question");
      t.run("nextPfTrainerHand()");
    }
    assert.equal(t.get("pf_question").hidden,true);
    assert.equal(t.get("pf_review").hidden,false);
    assert.equal((t.get("pf_review_rows").innerHTML.match(/<tr /g)||[]).length,20);
    assert.equal((t.get("pf_review_rows").innerHTML.match(/data-ok="false"/g)||[]).length,expectedMissed);
    assert.equal(t.get("pf_retry_missed").textContent,expectedMissed?`Retry ${expectedMissed} missed`:"Nothing missed");
    assert.ok(expectedMissed>0,`${scenario.id}: the test should produce misses`);
    t.run("retryPfMissed()");
    const retry=session(t);
    assert.equal(retry.retry,true);assert.equal(retry.items.length,expectedMissed);
    assert.ok(t.get("pf_question_count").textContent.endsWith("· retrying missed"));
    assert.equal(t.get("pf_stat_progress").textContent,`0 / ${expectedMissed}`);
  }

  // --- Progress is kept per scenario ---------------------------------------------
  {
    const t=trainerFor(scenarios[0]);
    for(let i=0;i<3;i++){const hand=currentHand(t),item=session(t).items[session(t).index];t.ctx.answer=item.kind==="frequency"?item.options[0]:["raise","call","jam","fold"].find(a=>hand.actions[a]>0);t.run("answerPfTrainer(answer);nextPfTrainerHand()");}
    assert.equal(t.get("pf_stat_progress").textContent,"3 / 20");
    t.ctx.other=scenarios[3];t.run("pfScenario=other;renderPfTrainer()");
    assert.equal(t.get("pf_stat_progress").textContent,"0 / 20","another scenario has its own set");
    t.ctx.first=scenarios[0];t.run("pfScenario=first;renderPfTrainer()");
    assert.equal(t.get("pf_stat_progress").textContent,"3 / 20","switching back restores progress");
    assert.equal(t.get("pf_question_count").textContent,"Question 4 of 20");

    // Changing the set size mid-set keeps the set and offers to start the new size.
    t.get("pf_set_size").value="10";t.run("pfSetSize=10;renderPfTrainer()");
    assert.equal(t.get("pf_stat_progress").textContent,"3 / 20");
    assert.ok(t.get("pf_set_note").textContent.includes("your next set will have 10 questions"));
    assert.equal(t.get("pf_start_set").hidden,false);
    t.run("newPfSet()");
    assert.equal(t.get("pf_stat_progress").textContent,"0 / 10");
    assert.equal(t.get("pf_start_set").hidden,true);
  }

  // --- "Practice this spot" makes the hand the next question ---------------------
  {
    const t=trainerFor(scenarios[0],10);
    const s=session(t),outside=scenarios[0].hands.find(x=>!s.items.some(item=>item.hand===x.hand)).hand;
    t.ctx.name=outside;t.run("practicePfHand(name);renderPfTrainer()");
    assert.equal(t.get("pf_trainer_hand").textContent,outside);
    assert.equal(session(t).items.length,11);
    assert.ok(t.get("pf_set_note").textContent.startsWith(`This set: 10 questions + 1 added from the Library (${outside}).`),"the extra question is explained");
    const later=session(t).items[5].hand;t.ctx.name=later;t.run("practicePfHand(name);renderPfTrainer()");
    assert.equal(t.get("pf_trainer_hand").textContent,later,"an unanswered later question moves forward");
    assert.equal(session(t).items.length,11,"no duplicate is added");
    assert.equal(new Set(session(t).items.map(item=>item.hand)).size,11);
  }

  // --- Unavailable actions, loading, races, retry -------------------------------------
  {
    const t=trainerFor(scenarios[0]);
    while(session(t).items[0].kind!=="action"){t.run("newPfSet()");}
    t.run("answerPfTrainer('call')");
    assert.equal(t.get("pf_stat_progress").textContent,"0 / 20","unavailable actions cannot be chosen");
    assert.equal(t.buttons.find(b=>b.dataset.action==="call").hidden,true);
    t.run("answerPfTrainer('raise')");assert.equal(t.get("pf_stat_progress").textContent,"1 / 20");
    t.run("activatePfMode('library')");assert.ok(t.get("pf_status").textContent.startsWith("Library ready"));
    assert.equal(t.get("pf_find_form").hidden,false);
    t.run("activatePfMode('trainer')");assert.ok(t.get("pf_status").textContent.startsWith("Answer recorded"));
    assert.equal(t.get("pf_find_form").hidden,true);
  }
  {
    const loading=harness();let release;
    loading.ctx.apiJSON=()=>new Promise(resolve=>{release=resolve;});
    const pending=loading.run("pfMode='trainer';loadPreflop()");loading.run("renderPfTrainer()");
    assert.ok(loading.buttons.every(b=>b.disabled));
    release(computePreflop({}));await pending;
    assert.ok(loading.buttons.some(b=>!b.hidden&&!b.disabled)||!loading.get("pf_frequency_options").hidden);
    assert.equal(loading.get("pf_trainer_bar").hidden,true);

    const racing=harness();const releases=new Map();
    racing.ctx.apiJSON=(_p,input)=>new Promise(resolve=>releases.set(input.scenarioId,resolve));
    racing.ctx.firstId=scenarios[0].id;racing.ctx.lastId=scenarios[4].id;
    const older=racing.run("loadPreflop(firstId)"),newer=racing.run("loadPreflop(lastId)");
    releases.get(scenarios[4].id)(computePreflop({scenarioId:scenarios[4].id}));await newer;
    releases.get(scenarios[0].id)(computePreflop({scenarioId:scenarios[0].id}));await older;
    assert.equal(racing.run("pfScenario.id"),scenarios[4].id);

    const retry=harness();retry.run("pfMode='trainer'");retry.ctx.apiJSON=async()=>{throw new Error("Test unavailable");};
    await retry.run("loadPreflop()");assert.equal(retry.get("pf_retry").hidden,false);assert.ok(retry.buttons.every(b=>b.disabled));
    retry.ctx.apiJSON=async(_p,input)=>computePreflop(input);await retry.run("loadPreflop()");
    assert.equal(retry.get("pf_retry").hidden,true);
  }

  // --- The report's case: retry, then add a hand from the Library -------------------------
  {
    const store=new Map(),storage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
    const t=trainerFor(scenarios[0],10,storage);
    let misses=0;
    while(session(t).index<session(t).items.length){
      const s=session(t),item=s.items[s.index],hand=currentHand(t);
      if(item.kind==="frequency"){t.ctx.answer=item.options.find(v=>v!==hand.actions[item.action]);misses++;}
      else{const zero=["raise","fold"].find(a=>hand.actions[a]===0);t.ctx.answer=zero||"raise";if(zero)misses++;}
      t.run("answerPfTrainer(answer);nextPfTrainerHand()");
    }
    assert.ok(misses>=2,"the setup should miss several questions");
    t.run("retryPfMissed()");
    const first=currentHand(t),firstItem=session(t).items[0];
    t.ctx.answer=firstItem.kind==="frequency"?first.actions[firstItem.action]:["raise","call","jam","fold"].find(a=>first.actions[a]>0);
    t.run("answerPfTrainer(answer)");
    const inSet=new Set(session(t).items.map(item=>item.hand));
    const extra=scenarios[0].hands.find(hand=>!inSet.has(hand.hand)).hand;
    t.ctx.name=extra;t.run("practicePfHand(name);renderPfTrainer()");
    assert.equal(t.get("pf_stat_progress").textContent,`1 / ${misses+1}`,"the answer is kept");
    assert.ok(t.get("pf_set_note").textContent.startsWith(`Retrying ${misses} missed question${misses===1?"":"s"} + 1 added from the Library (${extra}).`),t.get("pf_set_note").textContent);
    assert.equal(session(t).items.filter(item=>item.origin==="missed").length,misses,"added questions do not change the missed count");
    assert.equal(t.get("pf_trainer_hand").textContent,extra);
    // The added question is saved at once, before anything else is answered.
    const early=harness(storage);early.ctx.scenario=scenarios[0];
    early.run("loadPfProgress();pfScenario=scenario;renderPfTrainer()");
    assert.equal(early.get("pf_trainer_hand").textContent,extra,"the added question survives an immediate reload");
    // Then switch scenario, answer there, reload and come back: origins, progress,
    // position and the previous review all hold, and each scenario keeps its own set.
    t.ctx.other=scenarios[3];t.run("pfScenario=other;renderPfTrainer()");
    {const s=session(t),item=s.items[s.index],hand=currentHand(t);
     t.ctx.answer=item.kind==="frequency"?item.options[0]:["raise","call","jam","fold"].find(a=>hand.actions[a]>0);t.run("answerPfTrainer(answer)");}
    const back=harness(storage);back.ctx.scenario=scenarios[0];
    back.run("loadPfProgress();pfScenario=scenario;renderPfTrainer()");
    assert.equal(back.get("pf_stat_progress").textContent,`1 / ${misses+1}`,"the retry answer survives");
    assert.ok(back.get("pf_set_note").textContent.startsWith(`Retrying ${misses} missed question${misses===1?"":"s"} + 1 added from the Library (${extra}).`),back.get("pf_set_note").textContent);
    assert.equal(session(back).items.filter(item=>item.origin==="missed").length,misses,"missed origins survive");
    assert.deepEqual(JSON.parse(JSON.stringify(session(back).items.filter(item=>item.origin==="added").map(item=>item.hand))),[extra],"the added origin survives");
    assert.equal(back.get("pf_trainer_hand").textContent,extra,"the position survives");
    assert.equal(back.get("pf_previous").hidden,false,"the first set's review is still offered");
    back.run("pfViewingPrevious=true;renderPfTrainer()");
    assert.equal((back.get("pf_review_rows").innerHTML.match(/<tr /g)||[]).length,10,"the previous review lists the first set");
    back.ctx.other=scenarios[3];back.run("pfViewingPrevious=false;pfScenario=other;renderPfTrainer()");
    assert.match(back.get("pf_stat_progress").textContent,/^1 \/ /,"the other scenario keeps its own answer");
    assert.equal(session(back).retry,false,"the other scenario's set is not a retry");
  }

  // --- Progress survives a reload; the previous review stays available ------------------------
  {
    const store=new Map(),storage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
    const t=trainerFor(scenarios[1],20,storage);
    for(let i=0;i<3;i++){const s=session(t),item=s.items[s.index],hand=currentHand(t);t.ctx.answer=item.kind==="frequency"?item.options[0]:["raise","call","jam","fold"].find(a=>hand.actions[a]>0);t.run("answerPfTrainer(answer);nextPfTrainerHand()");}
    assert.ok(t.get("pf_set_note").textContent.includes("saved in this browser"));
    const reloaded=harness(storage);reloaded.ctx.scenario=scenarios[1];
    reloaded.run("loadPfProgress();pfScenario=scenario;renderPfTrainer()");
    assert.equal(reloaded.get("pf_stat_progress").textContent,"3 / 20","answers survive a reload");
    assert.equal(reloaded.get("pf_question_count").textContent,"Question 4 of 20");
    assert.equal(reloaded.get("pf_resume").hidden,false,"returning offers continue or new");
    assert.match(reloaded.get("pf_resume_text").textContent,/3 of 20 answered/);
    reloaded.run("pfResumePending.delete(scenario.id);renderPfTrainer()");
    assert.equal(reloaded.get("pf_resume").hidden,true);
    // An answer is saved at once, before Next is pressed.
    {const s=session(reloaded),item=s.items[s.index],hand=currentHand(reloaded);
     reloaded.ctx.answer=item.kind==="frequency"?item.options[0]:["raise","call","jam","fold"].find(a=>hand.actions[a]>0);reloaded.run("answerPfTrainer(answer)");}
    const midway=harness(storage);midway.ctx.scenario=scenarios[1];
    midway.run("loadPfProgress();pfScenario=scenario;renderPfTrainer()");
    assert.equal(midway.get("pf_stat_progress").textContent,"4 / 20","an answer survives a reload before Next");
    assert.equal(midway.get("pf_next_hand").disabled,false,"the answered question shows its feedback");
    reloaded.run("nextPfTrainerHand()");
    // Finish the set, retry: the finished set's review stays available.
    while(session(reloaded).index<session(reloaded).items.length){const s=session(reloaded),item=s.items[s.index],hand=currentHand(reloaded);
      reloaded.ctx.answer=item.kind==="frequency"?item.options.find(v=>v!==hand.actions[item.action]):["raise","call","jam","fold"].find(a=>hand.actions[a]>0);
      reloaded.run("answerPfTrainer(answer);nextPfTrainerHand()");}
    reloaded.run("retryPfMissed()");
    assert.equal(reloaded.get("pf_previous").hidden,false);
    assert.match(reloaded.get("pf_previous_text").textContent,/^Previous set: /);
    reloaded.run("pfViewingPrevious=true;renderPfTrainer()");
    assert.equal(reloaded.get("pf_review").hidden,false);assert.equal(reloaded.get("pf_review_title").textContent,"Previous set · review");
    assert.equal(reloaded.get("pf_review_back").hidden,false);assert.equal(reloaded.get("pf_retry_missed").hidden,true);
    assert.equal((reloaded.get("pf_review_rows").innerHTML.match(/<tr /g)||[]).length,20);
    // The previous review is saved too.
    const again=harness(storage);again.ctx.scenario=scenarios[1];
    again.run("loadPfProgress();pfScenario=scenario;renderPfTrainer()");
    assert.equal(again.get("pf_previous").hidden,false,"the previous review survives a reload");
    assert.ok(again.run("session=pfSessionFor(pfScenario);session.retry"),"the retry set is restored");
    // Saved data that no longer matches the scenario is replaced, not trusted.
    const data=JSON.parse(store.get("poker-analytics.trainer-progress.v1"));
    data.sessions[scenarios[1].id].items[0].hand="ZZ";store.set("poker-analytics.trainer-progress.v1",JSON.stringify(data));
    const tampered=harness(storage);tampered.ctx.scenario=scenarios[1];
    tampered.run("loadPfProgress();pfScenario=scenario;renderPfTrainer()");
    assert.equal(tampered.get("pf_stat_progress").textContent,"0 / 20");
    store.set("poker-analytics.trainer-progress.v1","{not json");
    const broken=harness(storage);broken.ctx.scenario=scenarios[1];
    broken.run("loadPfProgress();pfScenario=scenario;renderPfTrainer()");
    assert.equal(broken.get("pf_stat_progress").textContent,"0 / 20","unreadable saved data starts fresh");
    // A browser that blocks storage still works and says so.
    const blocked={getItem:()=>{throw new Error("blocked");},setItem:()=>{throw new Error("blocked");},removeItem:()=>{}};
    const b=trainerFor(scenarios[2],10,blocked);b.run("loadPfProgress();renderPfTrainer()");
    assert.ok(b.get("pf_set_note").textContent.includes("blocks saving"));
  }

  // --- Matrix search and keyboard movement --------------------------------------------
  {
    const h=harness();
    const parse=text=>{h.ctx.text=text;return JSON.parse(JSON.stringify(h.run("pfParseHand(text)")));};
    assert.deepEqual(parse("a5s"),{hand:"A5s"});assert.deepEqual(parse("5As"),{hand:"A5s"});
    assert.deepEqual(parse(" ako "),{hand:"AKo"});assert.deepEqual(parse("77"),{hand:"77"});assert.deepEqual(parse("77s"),{hand:"77"});
    assert.deepEqual(parse("10 9 s"),{hand:"T9s"});assert.deepEqual(parse("t9o"),{hand:"T9o"});
    assert.match(parse("AK").error,/AKs or AKo/);assert.match(parse("A1x").error,/two ranks/);assert.match(parse("").error,/two ranks/);
    const allHands=new Set(scenarios[0].hands.map(x=>x.hand));
    for(const hand of allHands)assert.equal(parse(hand.toLowerCase()).hand,hand,`search finds ${hand}`);
    const move=(r,c,k)=>{const v=h.run(`pfMatrixMove(${r},${c},'${k}')`);return v&&[...v];};
    assert.deepEqual(move(0,0,"ArrowUp"),[0,0]);assert.deepEqual(move(0,0,"ArrowRight"),[0,1]);
    assert.deepEqual(move(5,5,"ArrowDown"),[6,5]);assert.deepEqual(move(5,5,"ArrowLeft"),[5,4]);
    assert.deepEqual(move(12,12,"ArrowDown"),[12,12]);assert.deepEqual(move(4,7,"Home"),[4,0]);assert.deepEqual(move(4,7,"End"),[4,12]);
    assert.equal(move(4,7,"Enter"),null);
    // Every hand has a unique (row, column) so arrow movement can reach all 169.
    assert.equal(new Set(scenarios[0].hands.map(x=>`${x.row},${x.column}`)).size,169);
  }

  // --- "How often" wording never rounds a mix to never/always -------------------------
  {
    const h=harness(),often=p=>h.run(`pfHowOften(${p})`);
    assert.equal(often(60),"about 6 times in 10");assert.equal(often(10),"about 1 time in 10");
    assert.equal(often(95),"about 19 times in 20");assert.equal(often(5),"about 1 time in 20");assert.equal(often(15),"about 3 times in 20");
    for(const scenario of scenarios)for(const hand of scenario.hands.filter(mixedOf))for(const value of Object.values(hand.actions).filter(v=>v>0)){
      assert.doesNotMatch(often(value),/about (0 times|10 times in 10|20 times in 20)/,`${hand.hand} ${value}%`);
    }
  }

  // --- Risk Lab guide and comparison records ----------------------------------------
  {
    const h=harness();
    const result=(wr,bank,risk,model={version:"2026-10-21",ruinMonitoring:"continuous (Brownian-bridge correction)"})=>({
      params:{wr,sd:90,bank,thr:0,hands:100000,paths:2000,seed:42},model,
      metrics:{risk,confidenceInterval:[risk-0.01,risk+0.01],survival:1-risk,p95Drawdown:20}});
    h.ctx.A=result(0,3000,0.278);h.ctx.B=result(3,3000,0.078);
    const stage=code=>h.run(code);
    assert.equal(stage("labGuideStage(null,A,A.params,'current')"),"save");
    assert.equal(stage("labGuideStage(A,A,A.params,'current')"),"change");
    assert.equal(stage("labGuideStage(A,A,B.params,'pending')"),"compare","B still running");
    assert.equal(stage("labGuideStage(A,A,B.params,'current')"),"compare","the shown result is still A's inputs");
    assert.equal(stage("labGuideStage(A,B,B.params,'current')"),"read");
    assert.deepEqual([...h.run("labChangedInputs(A.params,B.params)")],["Win rate"]);
    const record=JSON.parse(JSON.stringify(h.run("labComparisonRecord('A · default',A,'=B +3',B,'2026-10-22T10:00:00.000Z')")));
    assert.equal(record.type,"poker-analytics/risk-lab-comparison");
    assert.deepEqual(record.a.inputs,{winrate_bb100:0,std_bb100:90,bankroll_bi:30,ruin_threshold_bi:0,hands:100000,paths:2000,seed:42});
    assert.equal(record.b.results.risk_of_ruin,0.078);assert.equal(record.b.model.version,"2026-10-21");
    assert.ok(Math.abs(record.difference.risk_b_minus_a_pp-(-20))<1e-9);
    assert.deepEqual(record.difference.changed_inputs,["Win rate"]);
    h.ctx.record=record;const csv=h.run("labComparisonCSV(record)");
    assert.ok(csv.startsWith("field,A,B\nname,A · default,'=B +3\n"),"formula-like names are neutralised");
    assert.ok(csv.includes("input.winrate_bb100,0,3\n")&&csv.includes("model.version,2026-10-21,2026-10-21\n"));
    assert.ok(csv.includes('model.ruin_monitoring,continuous (Brownian-bridge correction),continuous (Brownian-bridge correction)'));
    assert.equal(h.run("labSlug('A · 30 BI / +3!')"),"a-30-bi-3");

    // Import validation keeps only known fields and rejects malformed files.
    h.ctx.file={...record,extra:"<script>",a:{...record.a,name:"x".repeat(200),secret:1}};
    const valid=JSON.parse(JSON.stringify(h.run("labValidateRecord(file)")));
    assert.ok(valid.record);assert.equal(valid.record.extra,undefined);assert.equal(valid.record.a.secret,undefined);
    assert.equal(valid.record.a.name.length,80);assert.equal(valid.record.b.model.version,"2026-10-21");
    assert.ok(Math.abs(valid.record.difference.risk_b_minus_a_pp-(-20))<1e-9,"the difference is recomputed from the results");
    const reject=value=>{h.ctx.file=value;return h.run("labValidateRecord(file)").error;};
    assert.match(reject({type:"other",schema_version:1}),/not a Risk Lab comparison/);
    assert.match(reject(null),/not a Risk Lab comparison/);
    assert.match(reject({...record,b:{...record.b,inputs:{...record.b.inputs,seed:"42"}}}),/B: seed is missing or not a number/);
    assert.match(reject({...record,a:{...record.a,results:{...record.a.results,risk_of_ruin:null}}}),/A: risk_of_ruin/);
    // Impossible saved values are rejected, and the changed inputs come from the inputs.
    const withResults=(side,results)=>({...record,[side]:{...record[side],results:{...record[side].results,...results}}});
    const withInputs=(side,inputs)=>({...record,[side]:{...record[side],inputs:{...record[side].inputs,...inputs}}});
    assert.match(reject(withResults("a",{risk_of_ruin:1.2,ci95_high:1.3,survival:-0.2})),/A: risk_of_ruin must be between 0 and 1/);
    assert.match(reject(withResults("b",{survival:-0.1})),/B: survival must be between 0 and 1/);
    assert.match(reject(withResults("a",{ci95_low:0.3,ci95_high:0.25})),/A: the 95% interval must run from ci95_low up to ci95_high/);
    assert.match(reject(withResults("b",{ci95_low:0.1,ci95_high:0.2})),/B: the 95% interval .* contain risk_of_ruin/);
    assert.match(reject(withResults("a",{survival:0.5})),/A: survival must equal 1 − risk_of_ruin/);
    assert.match(reject(withResults("b",{p95_max_drawdown_bi:-1})),/B: p95_max_drawdown_bi cannot be negative/);
    assert.match(reject(withInputs("a",{bankroll_bi:0})),/A: bankroll_bi must be above ruin_threshold_bi/);
    assert.match(reject(withInputs("b",{paths:0.5})),/B: hands and paths/);
    h.ctx.file={...record,difference:{...record.difference,changed_inputs:["Bankroll","<b>anything</b>"]}};
    assert.deepEqual([...h.run("labValidateRecord(file)").record.difference.changed_inputs],["Win rate"],"changed inputs are recomputed");
    // Loadable inputs match the Risk Lab controls; the seed is restored as saved.
    const problem=inputs=>{h.ctx.inputs=inputs;return h.run("labInputsProblem(inputs)");};
    const ok=record.b.inputs;
    assert.equal(problem(ok),"");assert.equal(problem({...ok,seed:7}),"");assert.equal(problem({...ok,paths:16000}),"");
    assert.match(problem({...ok,ruin_threshold_bi:1}),/threshold/);assert.match(problem({...ok,winrate_bb100:0.3}),/win rate/);
    assert.match(problem({...ok,hands:25000}),/horizon/);assert.match(problem({...ok,bankroll_bi:61}),/bankroll/);
    assert.match(problem({...ok,seed:1.5}),/seed/);
    // Load messages say what was recomputed and under which calculation engine.
    const message=(checks,current)=>{h.ctx.checks=checks;h.ctx.current=current;return h.run("labLoadMessage('A → B',checks,current)");};
    assert.equal(message([{side:"B",saved:0.0635,now:0.0635,savedVersion:"2026-10-21"}],"2026-10-21"),"Loaded “A → B”. Recomputed with calculation engine 2026-10-21: B matches the saved 6.35%.");
    const older=message([{side:"A",saved:0.2775,now:0.289,savedVersion:"2026-10-05"},{side:"B",saved:0.0785,now:0.0635,savedVersion:"2026-10-05"}],"2026-10-21");
    assert.match(older,/A is 28\.90% now \(saved 27\.75%\); B is 6\.35% now \(saved 7\.85%\)\./);
    assert.match(older,/saved with calculation engine 2026-10-05\. The engine has been updated since \(2026-10-21: ruin monitoring and random-number streams changed\), so the numbers can differ although no input changed\./);
    assert.doesNotMatch(older,/edited|model/,"an engine update is not blamed on the file or called a model change");
    const unknown=message([{side:"B",saved:0.0785,now:0.0635}],"2026-10-21");
    assert.match(unknown,/does not say which calculation engine produced it\. The engine has been updated since \(2026-10-21:/);
    const newer=message([{side:"B",saved:0.0785,now:0.0635,savedVersion:"2027-01-01"}],"2026-10-21");
    assert.match(newer,/saved with calculation engine 2027-01-01\. With a different engine version, the numbers can differ/);
    assert.doesNotMatch(newer,/updated since/,"no update is listed for a file from a newer engine");
    // Same engine and seeds but different numbers: ask for a check first; editing is one possible cause.
    const mismatch=message([{side:"B",saved:0.2,now:0.198,savedVersion:"2026-10-21"}],"2026-10-21");
    assert.match(mismatch,/B is 19\.80% now \(saved 20\.00%\)\. The recomputed values do not match the saved record, although the engine version and seeds are the same\. Check the inputs, engine version and file contents; one possible cause/);
    assert.ok(mismatch.indexOf("Check the inputs")<mismatch.indexOf("edited"),"the check comes before the possible cause");
    // The files for the user-testing plan (docs/user-testing-files) still behave as the plan says.
    {
      const dir=path.join(__dirname,"..","docs","user-testing-files");
      const parse=name=>{try{return JSON.parse(fs.readFileSync(path.join(dir,name),"utf8"));}catch{return undefined;}};
      assert.equal(parse("4-broken.json"),undefined,"the broken file is not valid JSON");
      const loadMessage=name=>{
        h.ctx.file=parse(name);const r=JSON.parse(JSON.stringify(h.run("labValidateRecord(file)"))).record;
        assert.ok(r,`${name} validates`);
        let version;
        const checks=["a","b"].map(key=>{const i=r[key].inputs;
          const fresh=compute("risk-lab",{wr:i.winrate_bb100,sd:i.std_bb100,bank:i.bankroll_bi*100,hands:i.hands,paths:i.paths,seed:i.seed,includeCurve:false});
          version=fresh.model.version;return {side:key.toUpperCase(),saved:r[key].results.risk_of_ruin,now:fresh.metrics.risk,savedVersion:r[key].model?.version};});
        return message(checks,version);
      };
      assert.match(loadMessage("1-earlier-engine.json"),/A is 28\.90% now \(saved 27\.75%\); B is 6\.35% now \(saved 7\.85%\)\. It was saved with calculation engine 2026-10-05\. The engine has been updated since/);
      assert.equal(loadMessage("2-seed-7.json"),"Loaded “A → B”. Recomputed with calculation engine 2026-10-21: A matches the saved 29.75%; B matches the saved 6.80%.");
      assert.match(loadMessage("3-edited-by-hand.json"),/A matches the saved 28\.90%; B is 6\.35% now \(saved 5\.35%\)\. The recomputed values do not match the saved record/);
    }
  }

  // --- Shared result states ---------------------------------------------------------
  {
    const h=harness(),panel=h.get("panel"),state=h.get("state");
    h.ctx.panel=panel;h.ctx.stateEl=state;
    h.run("setResultState(panel,stateEl,'current',{basis:'A♠ A♥ vs K♠ K♦ · exact'})");
    assert.equal(panel.dataset.resultState,"current");assert.equal(state.dataset.state,"current");
    assert.equal(state.textContent,"Current result | Calculated for: A♠ A♥ vs K♠ K♦ · exact");
    h.run("setResultState(panel,stateEl,'stale',{note:'Cards changed.',basis:'A♠ A♥ vs K♠ K♦ · exact'})");
    assert.equal(state.textContent,"Previous calculation | Cards changed. | The numbers below are for: A♠ A♥ vs K♠ K♦ · exact");
    h.run("setResultState(panel,stateEl,'empty')");assert.equal(state.textContent,"No result yet");
    for(const s of ["current","pending","stale","error","empty"])assert.ok(h.run(`RESULT_STATE_LABELS['${s}']`));
  }

  // --- Bankroll from results: amounts and probabilities shown against a target --------
  {
    const { computeBankrollPosterior } = require("../server/bankroll_posterior.js");
    const ctx=vm.createContext({});
    vm.runInContext(slice("const bpPct=","const bpRange=")+";this.f={bpPct,bpBI,bpUp,bpNeed,bpShort,bpSpare,bpPctAgainst};",ctx);
    const f=ctx.f;
    // A review's case: the root is 64.0167 buy-ins, which plain rounding showed as 64.
    const input={hands:40000,winRate:3,sd:90,prior:"weak",bank:30,thr:0,bbPerBuyIn:100,horizon:100000,target:5,credibility:80};
    const need=computeBankrollPosterior(input).bankroll.credible;
    assert.ok(need.buyIns>64&&need.buyIns<64.02,`root ${need.buyIns}`);
    assert.equal(f.bpNeed(need.buyIns),"64.1");
    const at64=computeBankrollPosterior({...input,bank:64});
    assert.equal(at64.bankroll.credible.met,false);
    assert.equal(f.bpBI(f.bpShort(need.buyIns,64)),"0.1","shortfall is never shown as 0");
    assert.equal(f.bpPctAgainst(at64.risk.probAtMostTarget,0.8),"79.99%","79.987% must not read as 80.0%");
    const at641=computeBankrollPosterior({...input,bank:64.1});
    assert.ok(at641.bankroll.credible.met&&at641.risk.probAtMostTarget>=0.8,"typing the amount shown meets the target");
    assert.equal(f.bpSpare(need.buyIns,64.1),0,"spare rounds down");
    // The default example: 56.85 and the fixed-win-rate 28.03 round up.
    const def=computeBankrollPosterior({...input,winRate:4}).bankroll;
    assert.equal(f.bpNeed(def.credible.buyIns),"56.9");assert.equal(f.bpNeed(def.plugIn.buyIns),"28.1");
    // Over many settings, the amount shown is always enough, and from 100 up it is whole buy-ins.
    let checked=0;
    for(const hands of [5000,40000,640000])for(const winRate of [1,3,6])for(const target of [1,5])for(const credibility of [60,80,95]){
      const b=computeBankrollPosterior({...input,hands,winRate,target,credibility}).bankroll.credible;
      if(b.buyIns==null)continue;
      const shown=f.bpUp(b.buyIns),again=computeBankrollPosterior({...input,hands,winRate,target,credibility,bank:shown});
      assert.ok(again.bankroll.credible.met&&again.risk.probAtMostTarget>=credibility/100-1e-12,`${hands} ${winRate} ${target} ${credibility}: ${b.buyIns} shown ${shown}`);
      assert.ok(shown>=b.buyIns&&shown-b.buyIns<=(b.buyIns<100?0.1:1)+1e-9);
      checked++;
    }
    assert.ok(checked>=40,`${checked} settings`);
    // Against a level: extra decimals only where rounding would land on or cross it.
    assert.equal(f.bpPctAgainst(0.85,0.8),"85.0%");assert.equal(f.bpPctAgainst(0.80004,0.8),"80.004%");
    assert.equal(f.bpPctAgainst(0.0500049,0.05),"5.0005%");assert.equal(f.bpPctAgainst(0.0499,0.05),"4.99%");
    assert.equal(f.bpPctAgainst(0.8,0.8),"80.0%");
  }

  const seed=harness();seed.get("seed").value="0";assert.equal(seed.run("integerInput('seed',42)"),0);
  const showdown=computeEquity({hero:["Ah","Kd"].map(strToCard),opponents:[["As","Kc"].map(strToCard),["Ad","Kh"].map(strToCard)],board:["2c","3d","4h","5s","6c"].map(strToCard),trials:1000,seed:0});
  assert.equal(showdown.result.method,"exact");assert.equal(showdown.result.trials,1);assert.equal(showdown.result.equity,1/3);
  console.log("PASS: practice sets (10/20/169) in all 5 scenarios; retry + added origins; saved progress, resume, previous review, corrupt or blocked storage; frequency questions; answer gating, reveal, no double scoring; review and retry missed; per-scenario progress; set-size change; practice this spot; unavailable actions; loading, races, retry; hand search; matrix keys; Risk Lab guide; comparison JSON/CSV, import validation, load messages; result states; seed 0; exact multiway showdown; bankroll amounts rounded up and kept on the right side of the target.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
