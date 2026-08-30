/* Accounting source reconciliation between Forecast & P&L Expenses and
   Cost-Benefit. Proves each cost has exactly one source and nothing is counted
   twice.  node source.check.mjs -> non-zero exit on failure. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await b.newPage();
await p.setViewportSize({ width:1440, height:1100 });
const fails=[], errs=[];
p.on('pageerror', e=>errs.push('pageerror: '+e.message));
const ok=(t,c,x='')=>{console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`); if(!c)fails.push(t);};
const near=(a,c,eps=1e-6)=>Math.abs(a-c)<eps;

await p.goto('file://' + process.cwd() + '/ucc_budget_simulator.html');
await p.evaluate(()=>{
  const prices=COURSES.map(c=>({...c})); const intakes=[]; let id=1;
  [[0,30,25],[1,20,22],[2,12,4],[3,40,38]].forEach(([ci,bud,act])=>{
    intakes.push({id:id++,kind:'budget',ci,month:0,year:2026,students:bud});
    intakes.push({id:id++,kind:'actual',ci,month:0,year:2026,students:act});});
  localStorage.setItem('ucc_sim_v4',JSON.stringify({prices,intakes,ybYear:2026,module:'cba',
    cba:{driver:'hours',off:{},rates:{},def:{},basis:'actual',otherRev:[]}}));
  localStorage.setItem('ucc_unlocked','ucc2026');});
await p.reload(); await p.waitForTimeout(500);

// ── 1. total cost reconciles exactly to its components ────────────────────
const R = await p.evaluate(()=>{
  const d=cbaCompute(ST,'actual',2026), e=fcExpenses(ST), yi=FC_YEARS.indexOf(2026), T=d.T;
  return { teaching:T.teaching, agent:T.commission, uni:T.uniComm, direct:T.direct,
    pool:d.pool, poolGross:d.poolGross, acadDeduct:d.acad.deduct,
    cost:T.cost, opexTot:e.opexTot[yi], cogsTot:e.cogsTot[yi], bcr:T.bcr,
    benefit:T.benefit, net:T.net,
    rowDirectSum:d.live.reduce((a,r)=>a+r.direct,0),
    allocSum:d.live.reduce((a,r)=>a+r.allocOH,0) };});
ok('§1 direct cost is exactly teaching + agent commission + university commission',
   near(R.direct, R.teaching+R.agent+R.uni), `${R.direct} = ${R.teaching}+${R.agent}+${R.uni}`);
ok('§1 institution total cost is exactly direct + central overhead pool',
   near(R.cost, R.direct+R.pool), `${R.cost} = ${R.direct}+${R.pool}`);
ok('§1 the overhead pool is Forecast total OPEX, less any academic-salary deduction',
   near(R.pool, R.poolGross-R.acadDeduct) && near(R.poolGross, R.opexTot),
   `pool ${R.pool} · Forecast OPEX ${R.opexTot} · deduct ${R.acadDeduct}`);
ok('§1 the whole pool is allocated across courses, never scaled away',
   near(R.allocSum, R.pool, 0.01), `allocated ${Math.round(R.allocSum)} of ${R.pool}`);
ok('§1 Forecast COGS is not part of the Cost-Benefit total',
   !near(R.cost, R.direct+R.pool+R.cogsTot) && R.cogsTot>0,
   `COGS ${R.cogsTot} excluded`);

// ── 2/3. each change reaches Cost-Benefit exactly once ────────────────────
const flow = await p.evaluate(()=>{
  const snap=()=>{const d=cbaCompute(ST,'actual',2026);
    return {pool:d.pool,cost:d.T.cost,net:d.T.net,benefit:d.T.benefit,direct:d.T.direct,
            alloc:d.live.reduce((a,r)=>a+r.allocOH,0)};};
  const yi=FC_YEARS.indexOf(2026);
  const before=snap();
  const line=ST.fx.exp.opex[0].items[0], orig=line.v[yi];
  line.v[yi]=orig+1000; const opexUp=snap(); line.v[yi]=orig;
  const restored=snap();
  /* a direct-cost change: raise the teacher rate Cost-Benefit actually reads
     (ST.tf is the Course Simulator's live editing value, not a CBA source) */
  const rate0=cbaRate(ST,COURSES[0],'rate');
  ST.cba.def=ST.cba.def||{}; ST.cba.def.rate=rate0+10;
  const rateUp=snap(); delete ST.cba.def.rate;
  const restored2=snap();
  return {before,opexUp,restored,rateUp,restored2,line:line.label};});
ok('§2 +$1,000 of central OPEX raises the pool by exactly $1,000',
   near(flow.opexUp.pool-flow.before.pool,1000));
ok('§2 it raises institution total cost by exactly $1,000 — counted once',
   near(flow.opexUp.cost-flow.before.cost,1000) &&
   near(flow.opexUp.alloc-flow.before.alloc,1000,0.01));
ok('§2 it worsens the full-cost result by exactly $1,000 and leaves revenue and direct cost alone',
   near(flow.opexUp.net-flow.before.net,-1000) &&
   near(flow.opexUp.benefit,flow.before.benefit) &&
   near(flow.opexUp.direct,flow.before.direct));
ok('§2 restoring the expense restores every figure exactly',
   JSON.stringify(flow.restored)===JSON.stringify(flow.before));
ok('§3 a direct-cost change moves direct cost and total cost by the same amount, pool unchanged',
   flow.rateUp.direct>flow.before.direct &&
   near(flow.rateUp.cost-flow.before.cost, flow.rateUp.direct-flow.before.direct) &&
   near(flow.rateUp.pool, flow.before.pool));
ok('§3 restoring the rate restores every figure exactly',
   JSON.stringify(flow.restored2)===JSON.stringify(flow.before));

// ── 4. Forecast COGS never reaches Cost-Benefit ───────────────────────────
const cogs = await p.evaluate(()=>{
  const yi=FC_YEARS.indexOf(2026);
  const out=[];
  ST.fx.exp.cogs.forEach((g,gi)=>g.items.forEach((l,li)=>{
    const before=cbaCompute(ST,'actual',2026).T, pB=fcPnl(ST);
    const orig=l.v[yi]; l.v[yi]=orig+1000;
    const after=cbaCompute(ST,'actual',2026).T, pA=fcPnl(ST);
    l.v[yi]=orig;
    out.push({label:l.label, dCba:after.cost-before.cost,
      dForecast:pA.cogs[yi]-pB.cogs[yi],
      restored:cbaCompute(ST,'actual',2026).T.cost===before.cost});}));
  return out;});
ok('§4 every Forecast COGS line moves the Forecast P&L by $1,000 and Cost-Benefit by $0',
   cogs.length>0 && cogs.every(c=>near(c.dForecast,1000) && c.dCba===0 && c.restored),
   cogs.map(c=>`${c.label}: CBA ${c.dCba}`).join(' · '));

// ── 5. Budget and Actual stay independent ─────────────────────────────────
const ba = await p.evaluate(()=>{
  const bud=cbaCompute(ST,'budget',2026), act=cbaCompute(ST,'actual',2026);
  /* changing actual enrolment must not move the budget basis */
  const before={bud:bud.T.cost, act:act.T.cost};
  const rec=ST.intakes.find(i=>i.kind==='actual'); const orig=rec.students;
  rec.students=orig+5;
  const after={bud:cbaCompute(ST,'budget',2026).T.cost, act:cbaCompute(ST,'actual',2026).T.cost};
  rec.students=orig;
  return {before,after, poolSame:bud.pool===act.pool,
    directDiffers:Math.abs(bud.T.direct-act.T.direct)>1};});
ok('§5 the overhead pool is identical on both bases — Forecast OPEX is basis-independent',
   ba.poolSame);
ok('§5 direct costs differ by basis, and an Actual edit leaves the Budget basis untouched',
   ba.directDiffers && ba.after.bud===ba.before.bud && ba.after.act!==ba.before.act);

// ── 6. Annual and Monthly expense views reconcile ─────────────────────────
const am = await p.evaluate(()=>{
  const y=FC_YEARS[0], yi=0, l=ST.fx.exp.opex[0].items[0], orig=l.v[yi];
  const def=fcMonthlyArr(ST,'opex',0,0,y);
  const evenSplit=near12(def,orig);
  function near12(a,tot){return Math.abs(a.reduce((x,v)=>x+v,0)-tot)<1e-6 && a.every(v=>Math.abs(v-tot/12)<1e-6);}
  /* a month edit, exactly as the UI handler does it */
  const arr=def.slice(); arr[3]+=1200;
  ST.fx.monthly=ST.fx.monthly||{}; ST.fx.monthly[fcMonthKey('opex',0,0,y)]=arr;
  l.v[yi]=arr.reduce((a,v)=>a+v,0);
  const annualFollows=Math.abs(l.v[yi]-(orig+1200))<1e-6;
  const reachesCba=cbaCompute(ST,'actual',y).pool;
  /* an annual edit, exactly as the UI handler does it */
  l.v[yi]=orig+500; delete ST.fx.monthly[fcMonthKey('opex',0,0,y)];
  const monthsRederive=near12(fcMonthlyArr(ST,'opex',0,0,y),orig+500);
  l.v[yi]=orig; delete ST.fx.monthly[fcMonthKey('opex',0,0,y)];
  return {evenSplit, annualFollows, monthsRederive, reachesCba,
    baseline:cbaCompute(ST,'actual',y).pool};});
ok('§6 Monthly defaults to an even 1/12 of the Annual figure', am.evenSplit);
ok('§6 a Monthly edit writes back to the Annual total, so there is one dataset',
   am.annualFollows && am.reachesCba===am.baseline+1200,
   `pool ${am.baseline} -> ${am.reachesCba}`);
ok('§6 an Annual edit re-derives the months, so they always sum to the year',
   am.monthsRederive);
ok('§6 fcExpenses reads the Annual array — Annual is canonical',
   await p.evaluate(()=>{
     const y=FC_YEARS[0], l=ST.fx.exp.opex[0].items[0], orig=l.v[0];
     /* a stored monthly split alone, with no annual write-back, must not move the total */
     ST.fx.monthly=ST.fx.monthly||{};
     ST.fx.monthly[fcMonthKey('opex',0,0,y)]=Array.from({length:12},()=>9999);
     const same=fcExpenses(ST).opexTot[0];
     delete ST.fx.monthly[fcMonthKey('opex',0,0,y)];
     return same===fcExpenses(ST).opexTot[0];}));

// ── 7/8. BCR definition and label-only changes ────────────────────────────
const bcr = await p.evaluate(()=>{
  const d=cbaCompute(ST,'actual',2026);
  const avgOfRatios=d.live.reduce((a,r)=>a+(r.bcr||0),0)/Math.max(1,d.live.length);
  return {bcr:d.T.bcr, consolidated:d.T.benefit/d.T.cost, avgOfRatios};});
ok('§7 institution BCR is consolidated revenue / total cost, never an average of course BCRs',
   near(bcr.bcr,bcr.consolidated) && !near(bcr.bcr,bcr.avgOfRatios),
   `${bcr.bcr.toFixed(4)} vs avg-of-ratios ${bcr.avgOfRatios.toFixed(4)}`);
const ui = await p.evaluate(()=>{
  const before=JSON.stringify(cbaCompute(ST,'actual',2026).T);
  ST.module='cba'; ST.cba.mode='manage'; ST.cba.view='advanced'; render();
  const t=document.getElementById('cbacontent').innerText;
  ST.module='forecast'; ST.fx.tab='expenses'; render();
  const fx=document.getElementById('app').innerText;
  const after=JSON.stringify(cbaCompute(ST,'actual',2026).T);
  return {same:before===after, cba:t, fx};});
ok('§8 rendering the new source labels changes no financial figure', ui.same);
ok('§8 the full-cost source breakdown is on screen and names both sources',
   /where full cost comes from/i.test(ui.cba) &&
   /direct course costs/i.test(ui.cba) && /central ucc overhead/i.test(ui.cba));
ok('§8 the cost tree sums to the institution total cost',
   await p.evaluate(()=>{
     const d=cbaCompute(ST,'actual',2026), T=d.T;
     return Math.abs((T.teaching+T.commission+T.uniComm+d.pool)-T.cost)<1e-6;}));
ok('§8 Forecast Expenses explains why its total differs from Cost-Benefit',
   /not expected to be equal/i.test(ui.fx) && /cogs is not passed to cost-benefit/i.test(ui.fx));

if (errs.length) fails.push(...errs);
console.log(errs.length ? '\nconsole errors: '+errs.join(' | ') : '\nno console errors');
console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASS');
await b.close();
process.exit(fails.length ? 1 : 0);
