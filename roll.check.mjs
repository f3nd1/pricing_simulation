/* Rolling-intake operating model. node roll.check.mjs
   MANDATORY: evaluated over exactly one course duration, the rolling
   requirement must reconcile with the Course Simulator's standalone
   break-even, apart from display rounding. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const errs=[], fails=[];
const ok=(t,c,x='')=>{console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`);if(!c)fails.push(t);};
const p=await b.newPage(); await p.setViewportSize({width:1440,height:1100});
p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error'&&!/ERR_TUNNEL|Failed to load/.test(m.text()))errs.push(m.text());});
await p.goto('file://'+process.cwd()+'/ucc_budget_simulator.html');
await p.evaluate(()=>localStorage.setItem('ucc_unlocked','ucc2026'));
await p.reload(); await p.waitForTimeout(400);

// ── MANDATORY reconciliation, across every course ─────────────────────────
const rec = await p.evaluate(() => COURSES.map((c,i) => {
  const RO = cbaRolling(c===undefined?null:c, ST) || null; return null; }).length );
const recon = await p.evaluate(() => {
  const out=[];
  COURSES.forEach(c=>{
    const RO=cbaRolling(ST,c), B=simBeForCourse(c,ST);
    if(RO.pace==null||B.be==null)return;
    const overOneDuration = RO.pace*RO.mo;          // requirement over exactly one delivery
    const exact = B.totalCost/B.totalNet;           // simulator's unrounded break-even
    out.push({name:c.name, mo:RO.mo, pace:RO.pace, overOneDuration, exact,
      display:B.be, diff:Math.abs(overOneDuration-exact),
      roundOk: Math.ceil(overOneDuration-1e-9)===B.be});
  });
  return out; });
const worst = recon.reduce((a,x)=>Math.max(a,x.diff),0);
ok(`rolling requirement over one course duration = simulator break-even (${recon.length} courses)`,
   worst < 1e-9, `largest difference ${worst.toExponential(1)}`);
ok('rounds up to the same displayed break-even integer for every course',
   recon.every(x=>x.roundOk));
const ie = recon.find(x=>/IELTS/i.test(x.name));
console.log(`      IELTS: ${ie.exact.toFixed(3)} students over ${ie.mo} months → ${ie.pace.toFixed(3)}/month (displayed BE ${ie.display})`);

// ── the spec's worked example ─────────────────────────────────────────────
const ex = await p.evaluate(() => {
  const IE=COURSES.findIndex(c=>/IELTS/i.test(c.name)), y=cbaYear(ST);
  simSelectCourse(ST,IE); ST.disc=0; ST.uni=0; ST.agent=40; ST.tf=70; saveToStorage();
  let id=1; ST.intakes=[];
  for(let m=0;m<12;m++) ST.intakes.push({id:id++,kind:'budget',ci:IE,month:m,year:y,students:2});
  for(let m=0;m<9;m++)  ST.intakes.push({id:id++,kind:'actual',ci:IE,month:m,year:y,students:m<8?2:1});
  ST.cba.basis='actual'; ST.cba.chartCi=IE; ST.module='cba';
  const r=cbaCompute(ST,'actual').live.find(x=>x.ci===IE);
  return {students:r.students,months:r.months,paceReq:r.paceReq,paceAct:r.paceActual,
          req:r.reqPeriod,status:r.opStatus,gap:r.opGap,beExact:r.beExact,mo:r.mo,roll:r.roll}; });
ok('IELTS is no longer N/A — it has a real operating status', ex.status!=='na', ex.status.toUpperCase());
ok('required pace = break-even ÷ duration',
   Math.abs(ex.paceReq - ex.beExact/ex.mo) < 1e-9, `${ex.beExact.toFixed(2)} ÷ ${ex.mo} = ${ex.paceReq.toFixed(3)}/month`);
ok('actual pace = enrolments ÷ months in period',
   Math.abs(ex.paceAct - ex.students/ex.months) < 1e-9, `${ex.students} ÷ ${ex.months} = ${ex.paceAct.toFixed(2)}/month`);
ok('requirement scales to the period, not the full year',
   Math.abs(ex.req - ex.paceReq*ex.months) < 1e-9, `${ex.paceReq.toFixed(2)} × ${ex.months} = ${ex.req.toFixed(1)} required`);
ok('IELTS meets its rolling requirement (spec example)',
   ex.status==='met' && ex.gap>0,
   `${ex.students} actual vs ${ex.req.toFixed(1)} required → +${ex.gap.toFixed(1)}`);
console.log(`      pace ${ex.paceAct.toFixed(2)}/month vs ${ex.paceReq.toFixed(2)} required`);

// ── rolling window over one full duration ────────────────────────────────
ok('rolling window covers the course duration and reports met/short',
   ex.roll && ex.roll.len===Math.min(ex.mo,ex.months) && typeof ex.roll.met==='boolean',
   `last ${ex.roll.len} months: ${ex.roll.enrol} enrolled vs ${ex.roll.need.toFixed(1)} needed → ${ex.roll.met?'met':'short'}`);

// ── period follows basis and year ────────────────────────────────────────
const per = await p.evaluate(() => {
  const IE=COURSES.findIndex(c=>/IELTS/i.test(c.name));
  const a=cbaCompute(ST,'actual').live.find(x=>x.ci===IE);
  const b2=cbaCompute(ST,'budget').live.find(x=>x.ci===IE);
  return {aM:a.months,aS:a.students,aReq:a.reqPeriod,bM:b2.months,bS:b2.students,bReq:b2.reqPeriod}; });
ok('Actual measured over 9 months, Budget over 12 — same pace, different period',
   per.aM===9 && per.bM===12 && Math.abs(per.bReq/per.aReq - 12/9) < 1e-9,
   `actual ${per.aS}/${per.aReq.toFixed(1)} over ${per.aM}mo · budget ${per.bS}/${per.bReq.toFixed(1)} over ${per.bM}mo`);

// ── nothing depends on a recorded run count any more ─────────────────────
const gone = await p.evaluate(() => ({
  fnGone: typeof cbaRuns==='undefined' && typeof cbaRecordedRuns==='undefined',
  stateGone: ST.cba.runs===undefined && ST.cba.runBasis===undefined }));
ok('run model fully removed from code and state', gone.fnGone && gone.stateGone);
const dom = await p.evaluate(() => { const o={};
  ['status','diag','portfolio','bycourse','years'].forEach(t=>{ cbaGo(ST,t); render();
    o[t]={ runsInput:document.querySelectorAll('[data-cbaruns]').length,
           mentionsRuns:/runs \(recorded\)|course-run basis|per run ×/i.test(document.body.innerText) }; });
  cbaGo(ST,'status'); render(); return o; });
ok('no Runs field or run-basis wording on any tab',
   Object.values(dom).every(x=>x.runsInput===0 && !x.mentionsRuns),
   Object.entries(dom).map(([k,v])=>`${k}:${v.runsInput}`).join(' '));

// ── the other three tests stay separate ──────────────────────────────────
const sep = await p.evaluate(() => {
  const IE=COURSES.findIndex(c=>/IELTS/i.test(c.name));
  const r=cbaCompute(ST,'actual').live.find(x=>x.ci===IE);
  return {op:r.opStatus, budget:r.ytd&&Math.round(r.ytd.pct*100), contrib:r.contribution>=0, full:r.fullStatus}; });
ok('operating, budget, contribution and full cost remain four separate answers',
   sep.op==='met' && sep.budget===94 && sep.contrib===true && sep.full==='not',
   `operating ${sep.op} · budget ${sep.budget}% · contribution ${sep.contrib?'+':'−'} · full cost ${sep.full}`);

// ── layout ───────────────────────────────────────────────────────────────
for(const w of [1440,1300,768,375]){
  await p.setViewportSize({width:w,height:1100});
  for(const t of ['status','overview','portfolio','years','diag','courses','bycourse','charts']){
    for(const bs of ['budget','actual']){
      await p.evaluate(([t,bs])=>{cbaGo(ST,t);ST.cba.basis=bs;render();
        if(t==='charts')cbaDrawCharts(ST); if(t==='portfolio')cbaDrawPortfolio(ST); if(t==='years')cbaDrawTrend(ST);},[t,bs]);
      await p.waitForTimeout(120);
      const of=await p.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
      if(of>0)errs.push(`${w} ${t}/${bs} overflow=${of}`);
    }
  }
}
if(errs.length)fails.push(...errs);
console.log(errs.length?'\nerrors: '+errs.join(' | '):'\nno console errors, no overflow');
console.log(fails.length?`\nFAILED (${fails.length})`:'\nALL PASS');
await b.close();
process.exit(fails.length?1:0);
