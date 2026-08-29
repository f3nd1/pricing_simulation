/* Cost-Benefit course-status integration: canonical Operating BE, run mapping,
   YTD budget attainment, four separate tests, allocation invariance.
   node status.check.mjs → non-zero exit on failure. */
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

// IELTS: budget 2/month all year (24), actual 2/month to Aug + 1 in Sep (17)
const seed = () => p.evaluate(() => {
  const y = cbaYear(ST), IE = COURSES.findIndex(c=>/IELTS/i.test(c.name));
  let id = 1; ST.intakes = [];
  for (let m=0;m<12;m++) ST.intakes.push({id:id++,kind:'budget',ci:IE,month:m,year:y,students:2});
  for (let m=0;m<9;m++)  ST.intakes.push({id:id++,kind:'actual',ci:IE,month:m,year:y,students:m<8?2:1});
  [1,2].forEach(ci => [0,6].forEach(m => {
    ST.intakes.push({id:id++,kind:'budget',ci,month:m,year:y,students:15});
    ST.intakes.push({id:id++,kind:'actual',ci,month:m,year:y,students:ci===1?16:3}); }));
  ST.cba.runBasis='one'; ST.cba.basis='actual'; ST.module='cba'; ST.cba.tab='status'; render();
  return IE; });
const IE = await seed();
const row = (basis='actual') => p.evaluate(([IE,basis]) =>
  cbaCompute(ST,basis).live.find(r=>r.ci===IE), [IE,basis]);

// ── canonical Operating BE ────────────────────────────────────────────────
const canon = await p.evaluate(IE => { simSelectCourse(ST,IE);
  return { sim: calc(ST).beStu, helper: simBeForCourse(COURSES[IE],ST).be,
           cba: cbaCompute(ST,'actual').live.find(r=>r.ci===IE).beRun }; }, IE);
ok('Operating BE is one canonical number (Simulator = Cost-Benefit)',
   canon.sim===canon.helper && canon.helper===canon.cba,
   `simulator ${canon.sim} · helper ${canon.helper} · cost-benefit ${canon.cba}`);

// changing a simulator assumption must move BOTH
const moved = await p.evaluate(IE => { simSelectCourse(ST,IE); ST.tf=140; saveToStorage();
  const out = { sim: calc(ST).beStu, cba: cbaCompute(ST,'actual').live.find(r=>r.ci===IE).beRun };
  ST.tf=70; saveToStorage(); return out; }, IE);
ok('Operating BE follows the Course Simulator when its assumptions change',
   moved.sim===moved.cba && moved.sim!==canon.sim, `teacher $140 → both ${moved.sim}`);

// ── run mapping is never fabricated ───────────────────────────────────────
const na = await p.evaluate(() => { ST.cba.runBasis='none'; render();
  const rs = cbaCompute(ST,'actual').live;
  return { allNa: rs.every(r=>r.opStatus==='na' && r.opReq===null),
           shown: /run mapping unavailable|operating status unavailable/i.test(document.body.innerText) }; });
ok('No run basis → status N/A, nothing fabricated', na.allNa && na.shown);

const bases = await p.evaluate(IE => { const o={};
  ['one','month','class'].forEach(bs => { ST.cba.runBasis=bs;
    const r=cbaCompute(ST,'actual').live.find(x=>x.ci===IE);
    o[bs]={runs:r.runs,req:r.opReq,st:r.opStatus}; });
  ST.cba.runBasis='one'; render(); return o; }, IE);
ok('Run basis drives the requirement, per run not per year',
   bases.one.req===canon.sim && bases.month.runs===9 && bases.month.req===canon.sim*9,
   `one:${bases.one.req} month:${bases.month.runs} runs→${bases.month.req} class:${bases.class.req}`);

// ── YTD vs annual target progress ─────────────────────────────────────────
const r1 = await row();
ok('YTD compares matching months, separate from annual progress',
   r1.ytd.actual===17 && r1.ytd.budget===18 && Math.round(r1.ytd.pct*100)===94 &&
   Math.round(r1.ytd.annualPct*100)===71,
   `YTD ${r1.ytd.actual}/${r1.ytd.budget}=${Math.round(r1.ytd.pct*100)}% · annual ${Math.round(r1.ytd.annualPct*100)}% of ${r1.ytd.fullBudget}`);

// ── four tests stay separate ──────────────────────────────────────────────
ok('IELTS acceptance: operating met, contribution positive, full cost not recovered',
   r1.opStatus==='met' && r1.contribution>0 && r1.fullStatus==='not' && r1.bcr<1,
   `op ${r1.opStatus} · contribution ${Math.round(r1.contribution)} · BCR ${r1.bcr.toFixed(2)}×`);
ok('Positive contribution is never labelled STOP because allocated BCR < 1',
   r1.verdict.k !== 'stop', `action "${r1.verdict.label}"`);

// ── Budget / Actual labels and values ─────────────────────────────────────
const bud = await row('budget');
ok('Budget and Actual bases give different students on the same cost model',
   bud.students===24 && r1.students===17, `budget ${bud.students} · actual ${r1.students}`);
const lbl = await p.evaluate(() => { ST.cba.basis='actual'; render();
  const a=document.body.innerText;
  ST.cba.basis='budget'; render();
  const b=document.body.innerText;
  return { actualShown:/ACTUAL/.test(a), budgetShown:/BUDGET/.test(b),
           noPlanned: !/\bPlanned\b/.test(a) }; });
ok('Labels follow the selected basis, never "Planned" in Actual mode',
   lbl.actualShown && lbl.budgetShown && lbl.noPlanned);

// ── allocation driver invariance ──────────────────────────────────────────
const inv = await p.evaluate(IE => { const snap = d2 => { ST.cba.driver=d2;
  const c=cbaCompute(ST,'actual'), r=c.live.find(x=>x.ci===IE);
  return { instCost:c.T.cost, instBcr:c.T.bcr, beRun:r.beRun, students:r.students,
           contribution:r.contribution, bcr:r.bcr }; };
  const h=snap('hours'), m=snap('months'), g=snap('revenue'); ST.cba.driver='hours';
  return {h,m,g}; }, IE);
const near=(a,b2,t=1e-9)=>Math.abs(a-b2)<t;
ok('Allocation driver never changes institution totals, Operating BE, enrolment or contribution',
   near(inv.h.instCost,inv.m.instCost) && near(inv.h.instBcr,inv.g.instBcr) &&
   inv.h.beRun===inv.g.beRun && inv.h.students===inv.g.students &&
   near(inv.h.contribution,inv.g.contribution,0.5),
   `inst BCR ${inv.h.instBcr.toFixed(4)} across all drivers, Operating BE ${inv.h.beRun}`);
ok('Allocation driver may change the allocated full-cost ratio',
   !near(inv.h.bcr,inv.m.bcr,1e-6) || !near(inv.h.bcr,inv.g.bcr,1e-6),
   `${inv.h.bcr.toFixed(3)} / ${inv.m.bcr.toFixed(3)} / ${inv.g.bcr.toFixed(3)}`);

// ── year selector ─────────────────────────────────────────────────────────
const yr = await p.evaluate(() => {
  const y = cbaYear(ST);
  ST.intakes.push({id:9999,kind:'budget',ci:1,month:0,year:y+1,students:40});
  render();
  const opts=[...document.getElementById('cbaYearSel').options].map(o=>+o.value);
  const before=cbaCompute(ST,'budget').T.students;
  ST.ybYear=y+1; render();
  const after=cbaCompute(ST,'budget').T.students;
  ST.ybYear=y; render();
  return { opts, before, after, hasNext:opts.includes(y+1) }; });
ok('Year selector is data-driven and switching years changes the figures',
   yr.hasNext && yr.before!==yr.after, `${yr.opts.join(',')} · ${yr.before} → ${yr.after} students`);

if (errs.length) fails.push(...errs);
console.log(errs.length ? '\nconsole errors: '+errs.join(' | ') : '\nno console errors');
console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASS');
await b.close();
process.exit(fails.length ? 1 : 0);
