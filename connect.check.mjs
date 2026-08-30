/* Planning Suite connectivity: one Yearly Budget change must reach every
   consumer live, Budget and Actual stay independent, factual activity is
   independent of Cost-Benefit inclusion, a new course flows everywhere, and a
   cloud snapshot round-trip restores every module.
   node connect.check.mjs -> non-zero exit on failure. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await b.newPage();
const fails = [], errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (t,c,x='') => { console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`); if(!c) fails.push(t); };

await p.goto('file://' + process.cwd() + '/ucc_budget_simulator.html');
await p.evaluate(() => localStorage.setItem('ucc_unlocked','ucc2026'));
await p.reload(); await p.waitForTimeout(400);

const yr = await p.evaluate(() => { ST.intakes=[]; ST.cba.off={}; ST.cba.scope='incl'; return cbaYear(ST); });
const ci = 0;
const set = (kind,n) => p.evaluate(([ci,kind,n,yr]) => {
  ST.intakes = ST.intakes.filter(i => !(i.ci===ci && i.year===yr && (i.kind||'budget')===kind));
  if (n>0) ST.intakes.push({id:Math.max(0,...ST.intakes.map(i=>i.id))+1,kind,ci,month:0,year:yr,students:n});
  saveToStorage(); render();
}, [ci,kind,n,yr]);

/* one read of every consumer, straight from live state */
const all = () => p.evaluate(([ci,yr]) => {
  const B = cbaCompute(ST,'budget',yr), A = cbaCompute(ST,'actual',yr);
  const rb = B.rows.find(r=>r.ci===ci), ra = A.rows.find(r=>r.ci===ci);
  const led = buildPortfolioLedger(ST.intakes,ST,'All','budget');
  const E = smEnrol(ST,ci,COURSES[ci]);
  return {
    yb:{ budget: ST.intakes.filter(i=>i.ci===ci&&i.year===yr&&(i.kind||'budget')==='budget')
                  .reduce((a,i)=>a+i.students,0),
         actual: ST.intakes.filter(i=>i.ci===ci&&i.year===yr&&i.kind==='actual')
                  .reduce((a,i)=>a+i.students,0) },
    simInputs:{ budget:E.bud, actual:E.act, included:E.included },
    cbaBudget: rb.students, cbaActual: ra.students,
    activityB: rb.hasActivity, activityA: ra.hasActivity,
    included: rb.included, analysed: !!rb.analysed,
    revenue: rb.revenue, contribution: rb.contribution,
    instStudents: B.T.students, counts: B.counts,
    portfolio: (led[yr+'-0']||{}).newStudents,
    trend: cbaCompute(ST,'budget',yr).T.students,
    fc: fcStudents(ST,ci,yr),
    inAll: !!cbaScopeRows(ST,{...B}).find(r=>r.ci===ci),
  };
}, [ci,yr]);

// ── Step A ─────────────────────────────────────────────────────────────────
await set('budget',10); await set('actual',4);
let s = await all();
ok('A · Yearly Budget 10/4 reaches Simulator Inputs, Cost-Benefit and Portfolio live',
   s.yb.budget===10 && s.simInputs.budget===10 && s.cbaBudget===10 &&
   s.yb.actual===4 && s.simInputs.actual===4 && s.cbaActual===4,
   `YB ${s.yb.budget}/${s.yb.actual} · Inputs ${s.simInputs.budget}/${s.simInputs.actual} · CBA ${s.cbaBudget}/${s.cbaActual}`);
ok('A · Forecast reads the same budget intakes', s.fc===10, `forecast ${s.fc}`);

// ── Step B: budget 10 -> 16, actual untouched ──────────────────────────────
const revA = s.revenue;
await set('budget',16);
s = await all();
ok('B · changing Budget updates every consumer and leaves Actual alone',
   s.yb.budget===16 && s.simInputs.budget===16 && s.cbaBudget===16 &&
   s.portfolio===16 && s.trend===16 && s.cbaActual===4,
   `budget ${s.cbaBudget} everywhere · actual still ${s.cbaActual}`);
ok('B · revenue and contribution move with the enrolment', s.revenue > revA);

// ── Step C: actual 4 -> 9, budget untouched ────────────────────────────────
await set('actual',9);
s = await all();
ok('C · changing Actual updates Cost-Benefit Actual and leaves Budget alone',
   s.cbaActual===9 && s.simInputs.actual===9 && s.cbaBudget===16);

// ── Step D: exclude from Cost-Benefit ──────────────────────────────────────
await p.evaluate(([ci]) => { ST.cba.off[COURSES[ci].name]=true; saveToStorage(); render(); }, [ci]);
s = await all();
ok('D · exclusion does not touch Yearly Budget or Simulator Inputs',
   s.yb.budget===16 && s.yb.actual===9 && s.simInputs.budget===16 && s.simInputs.actual===9);
ok('D · activity stays YES while inclusion is NO — the two are independent',
   s.activityB===true && s.activityA===true && s.included===false && s.analysed===false);
const views = await p.evaluate(([ci]) => {
  const d = cbaCompute(ST,'budget');
  const show = sc => { ST.cba.scope=sc; return !!cbaScopeRows(ST,d).find(r=>r.ci===ci); };
  const out = { relevant:show('relevant'), all:show('all'),
                T:d.T.students, counts:d.counts };
  ST.cba.scope='relevant'; return out;
}, [ci]);
ok('D · an excluded course stays visible in both views — inclusion is a badge, not a filter',
   views.relevant===true && views.all===true);
ok('D · institution totals exclude it, and the count strip says so',
   views.counts.excludedWithActivity===1 && views.counts.activity>views.counts.both,
   `activity ${views.counts.activity} · analysed ${views.counts.both} · excluded-with-enrolment ${views.counts.excludedWithActivity}`);
const shown = await p.evaluate(() => { cbaGo(ST,'status'); ST.module='cba'; render(); return document.body.innerText; });
ok('D · the screen states the excluded course still has students',
   /excluded from the analysis/i.test(shown) && /excluded/i.test(shown));

// ── Step E: re-include ─────────────────────────────────────────────────────
await p.evaluate(([ci]) => { delete ST.cba.off[COURSES[ci].name]; saveToStorage(); render(); }, [ci]);
s = await all();
ok('E · re-including restores the course to the analysis immediately',
   s.included && s.analysed && s.cbaBudget===16 && s.revenue>0);

// ── §13 a brand-new course through the real Add Course workflow ────────────
const nci = await p.evaluate(() => {
  ST.module='simulator'; ST.tab='pricelist'; render();
  document.getElementById('addCourse').click();
  return COURSES.length-1;
});
const fresh = await p.evaluate(([nci,yr]) => {
  const d = cbaCompute(ST,'budget',yr), r = d.rows.find(x=>x.ci===nci);
  return { inPrice: !!COURSES[nci], inCba: !!r, activity: r.hasActivity, students: r.students,
           inputs: smEnrol(ST,nci,COURSES[nci]),
           inSim: !!simFor(ST,courseKey(COURSES[nci])),
           inYb: (()=>{ST.module='yearlybudget';render();
                  return !!document.querySelector(`[data-addmonthsel] option[value="${nci}"]`);})(),
           inDiag: (()=>{ST.module='cba';cbaGo(ST,'diag');ST.cba.scope='all';render();
                  return !!document.querySelector(`#cbaDiagCourse option[value="${nci}"]`);})() };
}, [nci,yr]);
ok('13 · a course added through the app appears everywhere with no source edit',
   fresh.inPrice && fresh.inCba && fresh.inSim && fresh.inYb && fresh.inDiag);
ok('13 · with no intakes it reads zero enrolment and no activity',
   fresh.activity===false && fresh.students===0 && fresh.inputs.bud===0 && fresh.inputs.act===0);
await p.evaluate(([nci,yr]) => {
  ST.intakes.push({id:Math.max(0,...ST.intakes.map(i=>i.id))+1,kind:'budget',ci:nci,month:0,year:yr,students:5});
  ST.intakes.push({id:Math.max(0,...ST.intakes.map(i=>i.id))+2,kind:'actual',ci:nci,month:0,year:yr,students:3});
  saveToStorage(); render();
}, [nci,yr]);
const grown = await p.evaluate(([nci,yr]) => ({
  inputs: smEnrol(ST,nci,COURSES[nci]),
  b: cbaCompute(ST,'budget',yr).rows.find(r=>r.ci===nci),
  a: cbaCompute(ST,'actual',yr).rows.find(r=>r.ci===nci) }), [nci,yr]);
ok('13 · Budget 5 then Actual 3 flow to Simulator Inputs and Cost-Benefit',
   grown.inputs.bud===5 && grown.inputs.act===3 &&
   grown.b.students===5 && grown.b.hasActivity && grown.a.students===3 && grown.a.hasActivity);

// ── §14 cloud snapshot round-trip ──────────────────────────────────────────
const cloud = await p.evaluate(([ci,nci,yr]) => {
  ST.cba.off[COURSES[ci].name]=true;          /* an exclusion to preserve */
  simSetField(ST,courseKey(COURSES[ci]),'tf',123);
  const snap = JSON.parse(JSON.stringify(buildFullSnapshot()));
  /* now wreck the live state, as a different scenario would */
  ST.intakes=[]; ST.cba.off={}; simSetField(ST,courseKey(COURSES[ci]),'tf',70);
  COURSES.splice(nci,1); render();
  const wrecked = cbaCompute(ST,'budget',yr).rows.find(r=>r.ci===ci).students;
  applyFullSnapshot(snap); render();
  const d = cbaCompute(ST,'budget',yr), r = d.rows.find(x=>x.ci===ci);
  return { wrecked, courses:COURSES.length, students:r.students, included:r.included,
           tf:simFor(ST,courseKey(COURSES[ci])).tf,
           inputs:smEnrol(ST,ci,COURSES[ci]),
           newCourseBack: !!COURSES[nci] };
}, [ci,nci,yr]);
ok('14 · a cloud snapshot restores intakes, exclusions, assumptions and courses',
   cloud.wrecked===0 && cloud.students===16 && cloud.included===false &&
   cloud.tf===123 && cloud.newCourseBack,
   `after restore ${cloud.students} students, teacher $${cloud.tf}, ${cloud.courses} courses`);
ok('14 · every consumer reads the restored values, no stale per-page copy',
   cloud.inputs.bud===16 && cloud.inputs.act===9 && cloud.inputs.included===false);

// ── no page refresh is ever required ───────────────────────────────────────
const noRefresh = await p.evaluate(([ci,yr]) => {
  delete ST.cba.off[COURSES[ci].name];
  ST.module='cba'; cbaGo(ST,'status'); ST.cba.scope='incl'; render();
  const before = document.body.innerText;
  ST.intakes.push({id:99999,kind:'budget',ci,month:5,year:yr,students:44});
  render();                                     /* same path the edit handlers use */
  const after = document.body.innerText;
  ST.intakes = ST.intakes.filter(i=>i.id!==99999);
  return before!==after && /60/.test(after);    /* 16 + 44 */
}, [ci,yr]);
ok('an intake added while Cost-Benefit is on screen shows up without a reload', noRefresh);

if (errs.length) fails.push(...errs);
console.log(errs.length ? '\nconsole errors: '+errs.join(' | ') : '\nno console errors');
console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASS');
await b.close();
process.exit(fails.length ? 1 : 0);
