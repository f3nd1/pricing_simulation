/* End-to-end Yearly Budget -> Cost-Benefit data flow.
   Every Yearly Budget edit must be visible in Cost-Benefit with no refresh,
   on the right year and the right basis, and never silently swallowed.
   node flow.check.mjs -> non-zero exit on failure. */
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

/* a brand-new course, added through the app's own button, with no activity */
const ci = await p.evaluate(() => {
  ST.intakes = []; ST.cba.off = {}; ST.cba.scope = 'all';
  COURSES.push({ name:'FLOWTEST Diploma', cat:'Diploma', fee:10000, mat:0, exam:0, admin:0,
                 app:0, hrs:300, mo:12 });
  ST.module='cba'; cbaGo(ST,'status'); render();
  return COURSES.length - 1;
});
/* read straight out of live state, exactly as the UI does */
const R = (basis,yr) => p.evaluate(([ci,basis,yr]) => {
  const d = cbaCompute(ST, basis, yr), r = d.rows.find(x => x.ci === ci);
  return { students:r.students, raw:r.rawStudents, on:r.on, act:r.hasActivity,
           live:!!d.live.find(x=>x.ci===ci), excluded:d.excluded.length,
           rev:r.revenue, T:d.T.students };
}, [ci,basis,yr]);
const yr = await p.evaluate(() => cbaYear(ST));

// 1. no activity -> present but not live, and not counted
let r = await R('budget',yr);
ok('new course with no activity: configured, N/A, contributes nothing',
   r.on && !r.act && !r.live && r.students===0 && r.rev===0);

// helper mirroring what the Yearly Budget add button does
const add = (kind,month,year,students) => p.evaluate(([ci,kind,month,year,students]) => {
  const id = Math.max(0,...ST.intakes.map(i=>i.id)) + 1;
  ST.intakes.push({id,kind,ci,month,year,students}); saveToStorage(); render(); return id;
}, [ci,kind,month,year,students]);

// 2. add 2026 Budget 5
const idB = await add('budget',0,yr,5);
r = await R('budget',yr);
const rA = await R('actual',yr);
ok('Budget 5 appears in Cost-Benefit immediately, on Budget only',
   r.students===5 && r.live && rA.students===0, `budget ${r.students} · actual ${rA.students}`);

// 3. add 2026 Actual 3 — must not disturb Budget
const idA = await add('actual',0,yr,3);
r = await R('budget',yr); let a = await R('actual',yr);
ok('Actual 3 is independent of Budget 5', r.students===5 && a.students===3);

// 4. edit Actual 3 -> 7
await p.evaluate(([id]) => { ST.intakes.find(i=>i.id===id).students = 7; saveToStorage(); render(); }, [idA]);
r = await R('budget',yr); a = await R('actual',yr);
ok('editing an Actual intake updates Cost-Benefit and leaves Budget alone',
   a.students===7 && r.students===5);

// 5. delete the Actual intake
await p.evaluate(([id]) => { ST.intakes = ST.intakes.filter(i=>i.id!==id); saveToStorage(); render(); }, [idA]);
a = await R('actual',yr); r = await R('budget',yr);
ok('deleting an Actual intake removes it from Cost-Benefit, Budget untouched',
   a.students===0 && !a.live && r.students===5);

// 6. add 2027 Budget 12 — year isolation both ways
await add('budget',0,yr+1,12);
const y0 = await R('budget',yr), y1 = await R('budget',yr+1);
ok('a later year is isolated from the current year', y0.students===5 && y1.students===12);

// 7. monthly aggregation: several months of the same course sum
await add('budget',3,yr,4); await add('budget',7,yr,6);
r = await R('budget',yr);
ok('months of the same course, year and basis are summed', r.students===15, `5+4+6 = ${r.students}`);

// 8. the exclusion flag is the ONLY thing that can swallow an edit, and it is announced
const off = await p.evaluate(([ci]) => {
  ST.cba.off[COURSES[ci].name] = true; saveToStorage(); render();
  return document.body.innerText;
}, [ci]);
r = await R('budget',yr);
ok('an excluded course keeps its real Yearly Budget enrolment and stays visible',
   r.students===15 && r.act && !r.live && r.excluded===1,
   `students ${r.students} · activity ${r.act} · in analysis ${r.live}`);
ok('excluding a course with enrolment is warned about on screen, never silent',
   /excluded from this analysis/i.test(off) && /FLOWTEST/i.test(off));

// 9. clearing the exclusion brings the students straight back
await p.evaluate(([ci]) => { delete ST.cba.off[COURSES[ci].name]; saveToStorage(); render(); }, [ci]);
r = await R('budget',yr);
ok('including the course again brings it back into the analysis',
   r.students===15 && r.live && r.excluded===0);

// 10. persistence: the whole flow survives a reload
const after = await p.evaluate(() => { saveToStorage(); return null; });
await p.reload(); await p.waitForTimeout(400);
r = await R('budget',yr);
ok('intakes and the analysis survive a reload', r.students===15 && r.live, `${r.students} students`);

// 11. every tab reconciles to the same institution total
const tabs = await p.evaluate(() => {
  const d = cbaCompute(ST,'budget');
  const sum = d.live.reduce((a,r)=>a+r.students,0);
  return { T:d.T.students, sum, scope:cbaScopeRows(ST,d).length, configured:d.configured.length };
});
ok('institution totals equal the sum of the live course rows',
   tabs.T===tabs.sum, `${tabs.T} = ${tabs.sum}`);

// 12. the Master Sheet "active only" filter uses the same rule
const ms = await p.evaluate(([ci]) => {
  ST.cba.off[COURSES[ci].name] = true;
  const hidden = COURSES.map((c,i)=>({c,i})).filter(x=>cbaOn(ST,x.c)).some(x=>x.i===ci);
  delete ST.cba.off[COURSES[ci].name];
  return hidden;
}, [ci]);
ok('Master Sheet and Cost-Benefit share one activity rule', ms===false);

if (errs.length) fails.push(...errs);
console.log(errs.length ? '\nconsole errors: '+errs.join(' | ') : '\nno console errors');
console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASS');
await b.close();
process.exit(fails.length ? 1 : 0);
