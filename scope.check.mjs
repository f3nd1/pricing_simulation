/* Dynamic course discovery: a course added through the app's own flow must reach
   every Cost-Benefit tab with no source-code change. node scope.check.mjs */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const errs=[], fails=[];
const ok=(t,c,x='')=>{console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`);if(!c)fails.push(t);};
const p=await b.newPage(); await p.setViewportSize({width:1440,height:1100});
p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error'&&!/ERR_TUNNEL|Failed to load/.test(m.text()))errs.push(m.text());});
p.on('dialog',d=>d.accept());
await p.goto('file://'+process.cwd()+'/ucc_budget_simulator.html');
await p.evaluate(()=>localStorage.setItem('ucc_unlocked','ucc2026'));
await p.reload(); await p.waitForTimeout(400);

// baseline: a few courses with 2026 activity
const base = await p.evaluate(() => {
  const y=cbaYear(ST); let id=1; ST.intakes=[];
  [0,1,2].forEach(ci=>[0,6].forEach(m=>{
    ST.intakes.push({id:id++,kind:'budget',ci,month:m,year:y,students:12});
    ST.intakes.push({id:id++,kind:'actual',ci,month:m,year:y,students:9});}));
  ST.cba.basis='actual'; ST.cba.scope='active'; ST.module='cba'; ST.cba.tab='status'; render();
  const d=cbaCompute(ST,'actual');
  return {configured:d.configured.length, live:d.live.length, total:COURSES.length}; });
ok('configured and with-activity are different populations',
   base.configured>base.live && base.live===3,
   `${base.live} with enrolment · ${base.configured} configured · ${base.total} in registry`);

// ── §10: add a course through the app's own Price List button ─────────────
const added = await p.evaluate(() => {
  ST.module='simulator'; ST.tab='pricelist'; render();
  document.getElementById('addCourse').click();          // the legitimate flow
  const i=COURSES.length-1, c=COURSES[i];
  c.name='ZZ Test Course'; c.cat='Preparatory'; c.hrs=200; c.mo=4;
  c.fee=5000; c.mat=100; c.exam=100; c.admin=50;
  saveToStorage();
  return {i, name:c.name, total:COURSES.length}; });
ok('Course added through the app, not by editing source', added.total===base.total+1, added.name);

const seen = await p.evaluate(name => {
  const has = sel => [...document.querySelectorAll(sel+' option')].some(o=>o.textContent.includes(name));
  const out = {};
  ST.module='simulator'; ST.tab='overview'; render();
  out.simulator = has('#coursesel');
  ST.module='simmaster'; render();
  out.simInputs = document.body.innerText.includes(name);
  ST.module='simulator'; ST.tab='pricelist'; render();
  out.priceList = document.body.innerText.includes(name);
  ST.module='yearlybudget'; render();
  const i = COURSES.findIndex(c=>c.name===name);
  out.yearlyBudget = [...document.querySelectorAll('[data-addmonthsel="0"] option')]
    .some(o => +o.value===i && o.textContent.trim()===name);   // labelled distinctly, not "NEW"
  ST.module='cba'; ST.cba.tab='diag'; render();
  out.diagDropdown = has('#cbaDiagCourse');
  ST.cba.tab='courses'; render();
  out.activeCourses = document.body.innerText.includes(name);
  ST.cba.tab='status'; ST.cba.scope='all'; render();
  out.statusAll = document.body.innerText.includes(name);
  ST.cba.scope='active'; render();
  out.statusActiveHidden = !document.body.innerText.includes(name);
  ST.cba.tab='portfolio'; ST.cba.scope='all'; render();
  out.portfolioAll = document.body.innerText.includes(name);
  ST.cba.scope='active'; ST.cba.tab='status'; render();
  return out; }, added.name);
ok('new course reaches Course Simulator, Simulator Inputs, Price List, Yearly Budget',
   seen.simulator&&seen.simInputs&&seen.priceList&&seen.yearlyBudget);
ok('new course selectable in Diagnostics even with no enrolment', seen.diagDropdown);
ok('appears under All courses on Status and Portfolio', seen.statusAll&&seen.portfolioAll);
ok('correctly hidden under With activity (it has none yet)', seen.statusActiveHidden);

// no false financial activity
const zero = await p.evaluate(name => {
  const d=cbaCompute(ST,'actual'), r=d.rows.find(x=>x.name===name);
  return {inRows:!!r, hasActivity:r.hasActivity, students:r.students,
          inLive:d.live.some(x=>x.name===name), revenue:r.revenue,
          opStatus:r.opStatus, bcr:r.bcr, contribStatus:r.contribStatus,
          instStudents:d.T.students}; }, added.name);
ok('no fabricated activity: N/A statuses, excluded from totals',
   zero.inRows && !zero.hasActivity && zero.students===0 && !zero.inLive &&
   zero.opStatus==='na' && zero.bcr===null && zero.contribStatus==='na',
   `students ${zero.students} · operating ${zero.opStatus} · BCR ${zero.bcr}`);
ok('institution totals unaffected by a course with no activity', zero.instStudents===base.live*18,
   `${zero.instStudents} students across ${base.live} active courses`);

// ── §7: give it 2027 budget activity; it must become active there only ────
const yr = await p.evaluate(name => {
  const i=COURSES.findIndex(c=>c.name===name), y=cbaYear(ST);
  ST.intakes.push({id:99001,kind:'budget',ci:i,month:0,year:y+1,students:15});
  saveToStorage();
  const a26=cbaCompute(ST,'actual',y).live.some(x=>x.name===name);
  const b26=cbaCompute(ST,'budget',y).live.some(x=>x.name===name);
  const b27=cbaCompute(ST,'budget',y+1);
  const row27=b27.live.find(x=>x.name===name);
  return {a26,b26,in27:!!row27,students27:row27?row27.students:0,
          live26:cbaCompute(ST,'budget',y).live.length, live27:b27.live.length}; }, added.name);
ok('year-specific: inactive in 2026, active in 2027 Budget automatically',
   !yr.a26 && !yr.b26 && yr.in27 && yr.students27===15,
   `2026 no · 2027 budget ${yr.students27} students`);
ok('counts recalculate per year, never cached', yr.live26!==yr.live27,
   `${yr.live26} live in 2026 · ${yr.live27} in 2027`);

// ── §15: survives a cloud-snapshot round trip ─────────────────────────────
const cloud = await p.evaluate(name => {
  const snap=JSON.stringify(buildFullSnapshot());
  applyFullSnapshot(JSON.parse(snap)); saveToStorage();
  const d=cbaCompute(ST,'budget',cbaYear(ST)+1);
  return {present:COURSES.some(c=>c.name===name), live:d.live.some(x=>x.name===name)}; }, added.name);
ok('cloud snapshot round trip keeps the new course discoverable',
   cloud.present && cloud.live);

// ── removing activity updates counts dynamically ──────────────────────────
const removed = await p.evaluate(name => {
  const before=cbaCompute(ST,'budget',cbaYear(ST)+1).live.length;
  ST.intakes=ST.intakes.filter(k=>k.id!==99001);
  const after=cbaCompute(ST,'budget',cbaYear(ST)+1).live.length;
  const still=COURSES.some(c=>c.name===name);
  return {before,after,still}; }, added.name);
ok('removing activity drops it from live but keeps it configured',
   removed.after===removed.before-1 && removed.still, `${removed.before} → ${removed.after} live`);

// cleanup
await p.evaluate(name=>{const i=COURSES.findIndex(c=>c.name===name);if(i>=0)COURSES.splice(i,1);saveToStorage();},added.name);

// ── layout across both scopes ─────────────────────────────────────────────
for(const w of [1440,1300,768,375]){
  await p.setViewportSize({width:w,height:1100});
  for(const sc of ['active','all']){
    for(const t of ['status','overview','portfolio','years','diag','courses','bycourse','charts']){
      await p.evaluate(([t,sc])=>{ST.cba.tab=t;ST.cba.scope=sc;render();
        if(t==='charts')cbaDrawCharts(ST); if(t==='portfolio')cbaDrawPortfolio(ST); if(t==='years')cbaDrawTrend(ST);},[t,sc]);
      await p.waitForTimeout(110);
      const of=await p.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
      if(of>0)errs.push(`${w} ${t}/${sc} overflow=${of}`);
    }
  }
}
if(errs.length)fails.push(...errs);
console.log(errs.length?'\nerrors: '+errs.join(' | '):'\nno console errors, no overflow');
console.log(fails.length?`\nFAILED (${fails.length})`:'\nALL PASS');
await b.close();
process.exit(fails.length?1:0);
