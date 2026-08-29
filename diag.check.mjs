/* Cost-Benefit accounting flow, diagnostics, and diagram/table reconciliation.
   node diag.check.mjs → non-zero exit on failure.

   Accounting flow under test:
     Gross fee revenue − scholarship discount = NET REVENUE  (BCR numerator)
     Agent commission + university commission + teaching = DIRECT COST
     Net revenue − direct = contribution; + allocated overhead = full cost
   No item appears both as a revenue deduction and as a cost. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const errs = [], fails = [];
const ok = (t,c,x='') => { console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`); if(!c) fails.push(t); };
const near = (a,b2,t=0.5) => Math.abs(a-b2) < t;

const p = await b.newPage(); await p.setViewportSize({width:1440,height:1100});
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if(m.type()==='error' && !/ERR_TUNNEL|Failed to load/.test(m.text())) errs.push(m.text()); });
await p.goto('file://' + process.cwd() + '/ucc_budget_simulator.html');
await p.evaluate(() => localStorage.setItem('ucc_unlocked','ucc2026'));
await p.reload(); await p.waitForTimeout(400);

const IE = await p.evaluate(() => {
  const i = COURSES.findIndex(c=>/IELTS/i.test(c.name)), y = cbaYear(ST);
  simSelectCourse(ST,i); ST.disc=10; ST.uni=5; ST.agent=40; ST.tf=70; saveToStorage();
  let id=1; ST.intakes=[];
  for(let m=0;m<12;m++) ST.intakes.push({id:id++,kind:'budget',ci:i,month:m,year:y,students:2});
  for(let m=0;m<9;m++)  ST.intakes.push({id:id++,kind:'actual',ci:i,month:m,year:y,students:m<8?2:1});
  ST.cba.runBasis='recorded'; ST.cba.runs={[cbaRunKey(i,y)]:2};
  ST.cba.chartCi=i; ST.cba.basis='actual'; ST.module='cba'; return i; });
const R = () => p.evaluate(IE => cbaCompute(ST,'actual').live.find(x=>x.ci===IE), IE);
const r = await R();
const c = r.c, n = r.students;

ok('gross = students × full price', near(r.gross, n*(c.fee+c.mat+c.exam+c.admin)), `${Math.round(r.gross)}`);
ok('net revenue = gross − scholarship discount', near(r.revenue, r.gross-r.discount) && near(r.discount, r.gross*r.disc),
   `${Math.round(r.gross)} − ${Math.round(r.discount)} = ${Math.round(r.revenue)}`);
ok('direct cost = teaching + agent + university commission',
   near(r.direct, r.teaching+r.commission+r.uniComm), `${Math.round(r.direct)}`);
ok('agent commission = students × course fee × rate', near(r.commission, n*c.fee*r.comm));
ok('university commission = students × course fee × rate', near(r.uniComm, n*c.fee*r.uni), `${Math.round(r.uniComm)}`);
ok('contribution = net revenue − direct', near(r.contribution, r.revenue-r.direct), `${Math.round(r.contribution)}`);
ok('full cost = direct + allocated overhead', near(r.total, r.direct+r.allocOH));
ok('BCR = net revenue ÷ full cost', near(r.bcr, r.revenue/r.total, 1e-9), `${r.bcr.toFixed(4)}×`);

// no double counting: discount is not also a cost, commissions are not also revenue cuts
ok('NO DOUBLE COUNT: discount reduces revenue only',
   near(r.direct, r.teaching+r.commission+r.uniComm) && !near(r.direct, r.teaching+r.commission+r.uniComm+r.discount));
ok('NO DOUBLE COUNT: commissions are costs, never deducted from revenue',
   near(r.revenue, r.gross-r.discount));

// discount must actually move the numbers
const noD = await p.evaluate(IE => { simSelectCourse(ST,IE); const keep=ST.disc; ST.disc=0; saveToStorage();
  const x=cbaCompute(ST,'actual').live.find(z=>z.ci===IE); const out={rev:x.revenue,con:x.contribution,bcr:x.bcr};
  ST.disc=keep; saveToStorage(); return out; }, IE);
ok('removing the discount raises net revenue, contribution and BCR',
   noD.rev>r.revenue && noD.con>r.contribution && noD.bcr>r.bcr,
   `BCR ${r.bcr.toFixed(3)}× → ${noD.bcr.toFixed(3)}×`);

// ── recorded runs ─────────────────────────────────────────────────────────
ok('recorded runs drive the requirement (BE/run × runs)',
   r.runs===2 && r.opReq===r.beRun*2 && r.opStatus==='not' && r.opGap===n-r.opReq,
   `${r.beRun}/run × 2 = ${r.opReq} vs ${n} actual → short ${Math.abs(r.opGap)}`);
const blank = await p.evaluate(IE => { const y=cbaYear(ST), k=cbaRunKey(IE,y), keep=ST.cba.runs[k];
  delete ST.cba.runs[k];
  const x=cbaCompute(ST,'actual').live.find(z=>z.ci===IE); const out={st:x.opStatus,req:x.opReq,runs:x.runs};
  ST.cba.runs[k]=keep; return out; }, IE);
ok('runs not recorded → N/A, never guessed', blank.st==='na' && blank.req===null && blank.runs===null);

// ── §K reconciliation: every tab and diagram shows the same figure ────────
const recon = await p.evaluate(IE => {
  const fmt = v => sgd(v);
  const x = cbaCompute(ST,'actual').live.find(z=>z.ci===IE);
  const want = { contribution: fmt(x.contribution), revenue: fmt(x.revenue), direct: fmt(x.direct) };
  const seen = {};
  ['diag','bycourse','status'].forEach(t => { ST.cba.tab=t; render();
    const txt = document.body.innerText;
    seen[t] = { contribution: txt.includes(want.contribution), revenue: txt.includes(want.revenue) }; });
  ST.cba.tab='diag'; render();
  const dtxt = document.body.innerText;
  return { want, seen,
    flowHasGross: dtxt.includes(fmt(x.gross)),
    flowHasNet: dtxt.includes(fmt(x.revenue)),
    flowHasContribution: dtxt.includes(fmt(x.contribution)),
    opDiagram: dtxt.includes(String(x.opReq)) && dtxt.includes(String(x.beRun)),
    perStudent: dtxt.includes(fmt(x.contribution/x.students)) }; }, IE);
ok('same contribution on Diagnostics, By course and Course status',
   recon.seen.diag.contribution && recon.seen.bycourse.contribution && recon.seen.status.contribution,
   recon.want.contribution);
ok('money-flow diagram reconciles with the table (gross, net, contribution)',
   recon.flowHasGross && recon.flowHasNet && recon.flowHasContribution);
ok('operating diagram shows the same BE/run and requirement', recon.opDiagram);
ok('per-student column present alongside course totals', recon.perStudent);

// ── scenarios still match the live engine ─────────────────────────────────
const sc = await p.evaluate(IE => { const x=cbaCompute(ST,'actual').live.find(z=>z.ci===IE);
  const f0=cbaFeeScenario(x,0), c0=cbaRateScenario(x,Math.round(x.comm*100),null,null);
  return { f:Math.abs(f0.contribution-x.contribution), c:Math.abs(c0.contribution-x.contribution),
           gain:cbaFeeScenario(x,0.05).perStu-f0.perStu }; }, IE);
ok('0% scenario reproduces the live figures exactly (one engine)', sc.f<0.01 && sc.c<0.01);
ok('fee +5% still nets out the extra commission', sc.gain>0, `+${Math.round(sc.gain)}/student`);

// ── rates come from the course's own saved simulator state ────────────────
const src = await p.evaluate(IE => { simSelectCourse(ST,IE); ST.tf=123; saveToStorage();
  const x=cbaCompute(ST,'actual').live.find(z=>z.ci===IE); const out={rate:x.rate,simTf:simFor(ST,COURSES[IE].name).tf};
  ST.tf=70; saveToStorage(); return out; }, IE);
ok('Diagnostics reads the teacher rate from the saved per-course simulator state',
   src.rate===123 && src.simTf===123, `set $123 → diagnostics used $${src.rate}`);

// ── layout ────────────────────────────────────────────────────────────────
for (const w of [1440,1300,768,375]) {
  await p.setViewportSize({width:w,height:1100});
  for (const t of ['status','overview','diag','courses','bycourse','charts']) {
    await p.evaluate(t => { ST.cba.tab=t; render(); if(t==='charts') cbaDrawCharts(ST); }, t);
    await p.waitForTimeout(150);
    const of = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (of>0) errs.push(`${w} ${t} overflow=${of}`);
  }
}
if (errs.length) fails.push(...errs);
console.log(errs.length ? '\nerrors: '+errs.join(' | ') : '\nno console errors, no overflow');
console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASS');
await b.close();
process.exit(fails.length ? 1 : 0);
