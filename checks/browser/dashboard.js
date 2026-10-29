'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
const out=path.join(root,'outputs/dashboard-check');
const artifact=path.join(root,'outputs/github-pages');
const {main:pack}=require('../../scripts/package_dashboard');
const {dataset}=require('../../scripts/build_dashboard');
const data=dataset();
const report={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,playwright:require('playwright/package.json').version,platform:`${os.platform()} ${os.arch()}`,checks:[],passed:false};
let server,browser;
const errors=[],external=[];
async function check(name,fn){try{await fn();report.checks.push({name,passed:true});console.log('PASS: '+name);}catch(e){report.checks.push({name,passed:false,error:e.message});throw e;}}
async function main(){
 pack();await fs.mkdir(out,{recursive:true});
 server=http.createServer(async(req,res)=>{
  const prefix='/poker-risk-lab/';
  let name=new URL(req.url,'http://localhost').pathname;
  if(!name.startsWith(prefix)){res.writeHead(404);res.end();return;}
  name=name.slice(prefix.length);if(name.endsWith('/')||!name)name+='index.html';
  if(!['index.html','dashboard/index.html','case-study/index.html','case-study/validation.html','Chart.js-LICENSE.md','LICENSE'].includes(name)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',name.endsWith('.html')?'text/html':'text/plain');res.end(await fs.readFile(path.join(artifact,name)));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}/poker-risk-lab/`;
 browser=await chromium.launch();report.browser=browser.version();
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route('**/*',route=>{const u=route.request().url();if(u.startsWith(base)||u.startsWith('file:'))route.continue();else{external.push(u);route.abort();}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.waitForURL('**/dashboard/');
 await check('Static project-subpath entry opens the dashboard without external requests',async()=>{
  await page.locator('#research-kpis strong').first().waitFor();assert.equal(await page.locator('canvas').count(),4);assert.equal(await page.locator('#research-kpis strong').count(),3);assert.deepEqual(external,[]);
 });
 await check('History and simulation filters update only their corresponding evidence',async()=>{
  const before=await page.locator('#research-kpis strong').allTextContents();
  await page.locator('#history').selectOption('1000000');const history=await page.locator('#research-kpis strong').allTextContents();assert.equal(history[0],before[0]);assert.notEqual(history[1],before[1]);assert.equal(history[2],before[2]);
  await page.locator('#paths').selectOption('200000');const paths=await page.locator('#research-kpis strong').allTextContents();assert.notEqual(paths[0],history[0]);assert.equal(paths[1],history[1]);assert.equal(paths[2],history[2]);
  await page.locator('#history').selectOption('50000');await page.locator('#paths').selectOption('2000');
 });
 await check('Both bridge scenarios show all 40 paired runs and exact saved means',async()=>{
  for(const rate of ['0','3']){await page.locator('#bridge-rate').selectOption(rate);const row=data.calculation.multi_seed.rows.find(x=>x.winrate_bb100===Number(rate));assert((await page.locator('#bridge-summary').innerText()).includes((row.mean_risk_bridge*100).toFixed(2)+'%'));assert.equal(await page.locator('#bridge-table tr').count(),40);assert((await page.locator('#bridge-story').innerText()).includes('raised risk in 40 of 40 paired seeds'));}
 });
 await page.screenshot({path:path.join(out,'research-desktop.png'),fullPage:true});
 await check('All bankroll examples show saved values and conservative displayed amounts',async()=>{
  await page.locator('#tab-bankroll').click();
  for(const b of data.bankroll){await page.locator('#bank-case').selectOption(b.id);assert((await page.locator('#bank-kpis').innerText()).includes((b.risk.average*100).toFixed(2)+'%'));const amount=Number(await page.locator('#bank-readings tr').first().locator('td').nth(1).innerText());assert(amount>=b.bankroll.credible.buyIns);assert.equal(await page.locator('#bank-table tr').count(),b.curve.bankroll.length);}
  await page.locator('#bank-case').selectOption(data.bankroll[0].id);assert((await page.locator('#bank-posterior').innerText()).includes('0.02%'));
 });
 await page.screenshot({path:path.join(out,'bankroll-desktop.png'),fullPage:true});
 await check('Equity scenarios match their records; EV responds and rejects empty input',async()=>{
  await page.locator('#tab-equity').click();for(const e of data.equity){await page.locator('#equity-case').selectOption(e.id);assert.equal(await page.locator('#equity-number').innerText(),(e.ours*100).toFixed(2)+'%');assert.equal(await page.locator('#equity-range').innerText(),e.range);}
  await page.locator('#equity-case').selectOption(data.equity[0].id);await page.locator('#ev-pot').fill('20');assert((await page.locator('#ev-answer').innerText()).includes('+'+(data.equity[0].ours*25-5).toFixed(2)+' bb'));
  await page.locator('#ev-pot').fill('');assert((await page.locator('#ev-answer').innerText()).includes('Enter a pot'));assert.equal(await page.locator('#ev-answer strong').count(),0);await page.locator('#ev-pot').fill('10');
 });
 await page.screenshot({path:path.join(out,'equity-desktop.png'),fullPage:true});
 await check('Keyboard tabs and mobile layouts work at 375 CSS pixels',async()=>{
  await page.locator('#tab-equity').focus();await page.keyboard.press('Home');assert.equal(await page.locator('#tab-research').getAttribute('aria-selected'),'true');
  await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#tab-bankroll').getAttribute('aria-selected'),'true');
  await page.setViewportSize({width:375,height:812});
  for(const view of ['research','bankroll','equity']){await page.locator('#tab-'+view).click();await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);assert.equal(await page.evaluate(()=>innerWidth),375);await page.screenshot({path:path.join(out,view+'-phone.png'),fullPage:true});}
 });
 await check('Download is valid source JSON and static case-study links resolve',async()=>{
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#download').click()]);const file=await download.path();const saved=JSON.parse(await fs.readFile(file,'utf8'));assert.deepEqual(saved.sources,data.sources);assert.deepEqual(saved.equity,data.equity);
  await page.getByRole('link',{name:'Case study ↗',exact:true}).click();assert(page.url().endsWith('/case-study/'));await page.getByRole('link',{name:'Research dashboard',exact:true}).click();await page.getByRole('link',{name:'Validation ↗',exact:true}).click();assert(page.url().endsWith('/case-study/validation.html'));
 });
 await check('The standalone HTML also opens from disk without networking',async()=>{
  await page.goto('file://'+path.join(root,'dashboard/index.html'));await page.locator('#research-kpis strong').first().waitFor();assert.equal(await page.locator('#research-kpis strong').count(),3);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 });
 report.passed=true;
}
main().catch(e=>{report.error=e.stack;console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));report.pageErrors=errors;report.externalRequests=external;await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');});
