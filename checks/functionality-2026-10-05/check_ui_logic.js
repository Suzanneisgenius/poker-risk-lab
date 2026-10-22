"use strict";
// Test the actual frontend state functions outside the browser. Browser checks
// separately cover pointer hit targets, layout, card picking and chart rendering.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { computePreflop, computeEquity } = require("../../server/compute.js");
const { strToCard } = require("../../standalone/engines/equity.js");
const source = fs.readFileSync(path.join(__dirname, "../../standalone/build/app.js"), "utf8");
function slice(start, end) {
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,`Missing function boundary: ${start}`);
  return source.slice(a,b);
}
class Element {
  constructor(id){
    this.id=id;this.textContent="";this.innerHTML="";this.value="";
    this.hidden=false;this.disabled=false;this.dataset={};this.attributes={};
    this.style={setProperty:(k,v)=>this.style[k]=v};
    const classes=new Set();
    this.classList={toggle:(c,on)=>on?classes.add(c):classes.delete(c),add:c=>classes.add(c),remove:c=>classes.delete(c)};
  }
  setAttribute(k,v){this.attributes[k]=v;}
}
function harness(){
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
  const buttons=["raise","call","jam","fold"].map(action=>{const e=new Element(action);e.dataset.action=action;return e;});
  const modes=["library","compare","trainer"].map(mode=>{const e=new Element(mode);e.dataset.pfMode=mode;return e;});
  const views=modes.map(e=>new Element(`pf-view-${e.id}`));
  const ctx=vm.createContext({console,$:get,document:{querySelectorAll:s=>s.includes("pf-action-button")?buttons:s===".pf-mode"?modes:s===".pf-view"?views:[]},
    renderPfContext:()=>{},pfCardHtml:hand=>hand,pfActionAria:hand=>JSON.stringify(hand.actions),renderPfMatrix:()=>{},
    renderPfLibrary:()=>{},errorMessage:error=>error.message,apiJSON:async(_p,input)=>computePreflop(input)});
  const code=[slice("const PF_ACTIONS=","function pfStrategyBackground"),
    slice("function pfScenarioAvailability(","function pfScenarioContext("),
    slice("function fillPfScenarioSelects(","function renderPfLibrary("),
    slice("async function getPfScenario(","function trainerScenario("),
    slice("function trainerScenario(","function selectPfHand("),
    source.match(/function integerInput[^\n]+/)[0]].join("\n");
  vm.runInContext(code,ctx);
  return {get,buttons,ctx,run:code=>vm.runInContext(code,ctx)};
}
async function main(){
  const scenarios=computePreflop({}).scenarios;
  for(const summary of scenarios){
    const h=harness();h.ctx.scenario=computePreflop({scenarioId:summary.id}).scenario;
    h.run("pfScenario=scenario;resetPfTrainer(scenario);renderPfTrainer();");
    assert.equal(h.get("pf_next_hand").disabled,true);
    assert.equal(h.get("pf_trainer_bar").hidden,true);
    const first=h.get("pf_trainer_hand").textContent;
    h.run("nextPfTrainerHand()");assert.equal(h.get("pf_trainer_hand").textContent,first);
    const visited=new Set();
    for(let i=0;i<169;i++){
      const hand=h.get("pf_trainer_hand").textContent;
      assert.ok(!visited.has(hand),`Repeated ${hand} before completing ${summary.id}`);visited.add(hand);
      h.run("const current=pfHand(pfScenario,pfTrainer.hand);".replace("const current", "var current"));
      const decision=h.run("PF_ACTIONS.find(action=>current.actions[action]>0)");
      h.ctx.decision=decision;h.run("answerPfTrainer(decision,null)");
      assert.equal(h.get("pf_stat_hands").textContent,`${i+1} / 169`);
      assert.equal(h.get("pf_trainer_bar").hidden,false);
      assert.equal(h.get("pf_next_hand").disabled,false);
      h.run("answerPfTrainer(decision,null)");assert.equal(h.get("pf_stat_hands").textContent,`${i+1} / 169`);
      h.run("renderPfTrainer()");assert.ok(h.get("pf_feedback").innerHTML.includes("Accepted choice"));
      if(i<168)h.run("nextPfTrainerHand()");
    }
    assert.equal(visited.size,169);assert.equal(h.get("pf_next_hand").textContent,"Start new session");
    h.run("nextPfTrainerHand()");assert.equal(h.get("pf_stat_hands").textContent,"0 / 169");
  }
  const h=harness();h.ctx.scenario=computePreflop({}).scenario;
  h.run("pfScenario=scenario;resetPfTrainer(scenario);renderPfTrainer();answerPfTrainer('call',null)");
  assert.equal(h.get("pf_stat_hands").textContent,"0 / 169");
  assert.equal(h.buttons.find(b=>b.dataset.action==="call").hidden,true);
  h.run("answerPfTrainer('raise',null);pfTrainer.hand='A5s';pfTrainer.answered=false;renderPfTrainer();answerPfTrainer('fold',null)");
  assert.equal(h.get("pf_stat_hands").textContent,"1 / 169");
  h.run("activatePfMode('library')");assert.ok(h.get("pf_status").textContent.startsWith("Library ready"));
  h.run("activatePfMode('trainer')");assert.ok(h.get("pf_status").textContent.startsWith("Answer recorded"));
  h.get("seed").value="0";assert.equal(h.run("integerInput('seed',42)"),0);

  const loading=harness();let release;
  loading.ctx.apiJSON=()=>new Promise(resolve=>{release=resolve;});
  const pending=loading.run("pfMode='trainer';loadPreflop()");loading.run("renderPfTrainer()");
  assert.ok(loading.buttons.every(b=>b.disabled));
  release(computePreflop({}));await pending;
  assert.equal(loading.buttons.find(b=>b.dataset.action==="raise").disabled,false);
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
  assert.equal(retry.get("pf_retry").hidden,true);assert.equal(retry.buttons.find(b=>b.dataset.action==="raise").disabled,false);

  const result=computeEquity({hero:["Ah","Kd"].map(strToCard),opponents:[["As","Kc"].map(strToCard),["Ad","Kh"].map(strToCard)],board:["2c","3d","4h","5s","6c"].map(strToCard),trials:1000,seed:0});
  assert.equal(result.result.method,"exact");assert.equal(result.result.trials,1);assert.equal(result.result.equity,1/3);
  console.log("PASS: all 169 hands in all 5 scenarios; gated next hand; reveal-after-answer; no duplicate scoring; session restart; unavailable actions; load-while-Trainer; latest scenario wins; failure/retry; seed 0; exact multiway showdown.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
