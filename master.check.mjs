/* Master Sheet <-> Course Simulator bidirectional sync, plus Price List
   protection. node master.check.mjs → exits non-zero on any failure. */
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

const master = () => p.evaluate(() => { ST.module='simmaster'; render(); });
// edit a cell through the real master-sheet DOM handler
const cell = (ci, field, val) => p.evaluate(([ci,field,val]) => {
  const k = COURSES[ci].name;
  const el = document.querySelector(`[data-smk="${CSS.escape(k)}"][data-smf="${field}"]`);
  if (!el) return 'no cell';
  el.value = String(val); el.dispatchEvent(new Event('change',{bubbles:true}));
  return 'ok'; }, [ci,field,val]);
const ohCell = (ci, idx, val) => p.evaluate(([ci,idx,val]) => {
  const k = COURSES[ci].name;
  const el = document.querySelector(`[data-smk="${CSS.escape(k)}"][data-smoh="${idx}"]`);
  if (!el) return 'no cell';
  el.value = String(val); el.dispatchEvent(new Event('change',{bubbles:true}));
  return 'ok'; }, [ci,idx,val]);
// read what the individual simulator would show for a course
const inSim = ci => p.evaluate(ci => { simSelectCourse(ST,ci); ST.module='simulator'; render();
  return { agent:ST.agent, tf:ST.tf, plan:ST.plan, act:ST.act, aAgent:ST.aAgent,
           ulecMgmt:ST.ulecMgmt, oh0:ST.oh[0].cost }; }, ci);
const inMaster = ci => p.evaluate(ci => { const v = simFor(ST, COURSES[ci].name);
  return { agent:v.agent, tf:v.tf, plan:v.plan, act:v.act, aAgent:v.aAgent,
           ulecMgmt:v.ulecMgmt, oh0:v.oh[0].cost }; }, ci);

// ── Test 1: Master Sheet → Simulator ───────────────────────────────────────
await master();
await cell(0,'agent',35); await cell(0,'tf',80); await cell(0,'plan',20);
const t1 = await inSim(0);
ok('Test 1  master edit reaches the Course Simulator',
   t1.agent===35 && t1.tf===80 && t1.plan===20, `${t1.agent}% $${t1.tf} ${t1.plan} students`);

// ── Test 2: Simulator → Master Sheet ───────────────────────────────────────
await p.evaluate(() => { simSelectCourse(ST,1); ST.agent=15; ST.tf=100; saveToStorage(); });
const t2 = await inMaster(1);
ok('Test 2  simulator edit reaches the Master Sheet', t2.agent===15 && t2.tf===100,
   `${t2.agent}% $${t2.tf}`);

// ── Test 3: isolation across both interfaces ───────────────────────────────
await master(); await cell(0,'tf',70); await cell(1,'tf',100); await cell(2,'tf',85);
const s0=await inSim(0), s1=await inSim(1), s2=await inSim(2);
await master();
const m0=await inMaster(0), m1=await inMaster(1), m2=await inMaster(2);
ok('Test 3  three courses stay independent in both views',
   s0.tf===70&&s1.tf===100&&s2.tf===85 && m0.tf===70&&m1.tf===100&&m2.tf===85,
   `sim ${s0.tf}/${s1.tf}/${s2.tf}  master ${m0.tf}/${m1.tf}/${m2.tf}`);

// ── Test 4: fixed overhead ─────────────────────────────────────────────────
await master(); await ohCell(0,0,2500); await ohCell(1,0,6100);
const o0=await inSim(0), o1=await inSim(1);
await master(); const om0=await inMaster(0), om1=await inMaster(1);
ok('Test 4  overhead course-specific in both views',
   o0.oh0===2500&&o1.oh0===6100&&om0.oh0===2500&&om1.oh0===6100,
   `sim ${o0.oh0}/${o1.oh0}  master ${om0.oh0}/${om1.oh0}`);

// ── Test 5: actual performance ─────────────────────────────────────────────
await master(); await cell(0,'act',31); await cell(0,'aAgent',12);
await cell(1,'act',64); await cell(1,'aAgent',48);
const a0=await inSim(0), a1=await inSim(1);
ok('Test 5  actual performance course-specific',
   a0.act===31&&a0.aAgent===12&&a1.act===64&&a1.aAgent===48,
   `A ${a0.act}/${a0.aAgent}  B ${a1.act}/${a1.aAgent}`);

// ── Test 6: subcontract ────────────────────────────────────────────────────
await master(); await ohCell(0,0,2500);           // keep row rendered
await cell(0,'ulecMgmt',450); await cell(1,'ulecMgmt',1300);
const u0=await inSim(0), u1=await inSim(1);
ok('Test 6  subcontract course-specific', u0.ulecMgmt===450 && u1.ulecMgmt===1300,
   `A ${u0.ulecMgmt}  B ${u1.ulecMgmt}`);

// ── Test 7: Price List protection ──────────────────────────────────────────
const price = await p.evaluate(() => {
  const before = { ...COURSES[0] };
  simSelectCourse(ST,0);
  ST.disc=25; ST.agent=55; ST.tf=140; ST.plan=99; ST.oh[0].cost=9999;
  ST.act=88; ST.aDisc=9; ST.ulecMgmt=2222; saveToStorage(); render();
  const after = COURSES[0];
  return { same: before.fee===after.fee && before.mat===after.mat &&
                 before.exam===after.exam && before.admin===after.admin &&
                 before.hrs===after.hrs && before.mo===after.mo,
           fee: after.fee, wasFee: before.fee }; });
ok('Test 7  simulator changes never mutate the Price List', price.same,
   `fee stayed ${price.wasFee} → ${price.fee}`);

// price columns must be read-only in the master sheet
await master();
const ro = await p.evaluate(() => ({
  editablePrice: document.querySelectorAll('[data-smf="fee"],[data-smf="mat"],[data-smf="exam"],[data-smf="admin"]').length,
  hasReadonlyCols: document.body.innerText.includes('Price List') }));
ok('Test 8  Price List columns are read-only in the Master Sheet',
   ro.editablePrice===0 && ro.hasReadonlyCols, `${ro.editablePrice} editable price inputs`);

// ── Test 10: cloud snapshot round trip ─────────────────────────────────────
const snap = await p.evaluate(() => JSON.stringify(buildFullSnapshot()));
await p.evaluate(() => { simSelectCourse(ST,1); ST.tf=555; saveToStorage(); });
const rest = await p.evaluate(j => { applyFullSnapshot(JSON.parse(j)); saveToStorage();
  const g=i=>simFor(ST,COURSES[i].name); return { a:g(0), b:g(1), c:g(2) }; }, snap);
ok('Test 10  cloud snapshot restores every course',
   rest.a.tf===140 && rest.b.tf===100 && rest.c.tf===85,
   `${rest.a.tf}/${rest.b.tf}/${rest.c.tf}`);

// ── Test 9: persistence across reload ──────────────────────────────────────
await p.reload(); await p.waitForTimeout(500);
const after = await p.evaluate(() => { const g=i=>simFor(ST,COURSES[i].name);
  return { a:g(0), b:g(1), c:g(2), fee:COURSES[0].fee }; });
ok('Test 9  master-sheet edits survive reload',
   after.a.tf===140 && after.b.tf===100 && after.c.tf===85 &&
   after.a.oh[0].cost===9999 && after.b.ulecMgmt===1300,
   `tf ${after.a.tf}/${after.b.tf}/${after.c.tf}`);

// ── copy + reset ───────────────────────────────────────────────────────────
p.on('dialog', d => d.accept());
await master();
const copied = await p.evaluate(() => {
  document.getElementById('smCopyFrom').value='1';
  document.getElementById('smCopyTo').value='4';
  document.getElementById('smCopyGo').click();
  return { from:simFor(ST,COURSES[1].name).tf, to:simFor(ST,COURSES[4].name).tf,
           untouched:simFor(ST,COURSES[2].name).tf }; });
ok('Copy  copies one course only, leaves others alone',
   copied.to===copied.from && copied.untouched===85,
   `from ${copied.from} → to ${copied.to}, other still ${copied.untouched}`);
await master();
const reset = await p.evaluate(() => {
  const k=COURSES[4].name;
  document.querySelector(`[data-smreset="${CSS.escape(k)}"]`).click();
  return { target:simFor(ST,k).tf, other:simFor(ST,COURSES[1].name).tf }; });
ok('Reset  restores one course to defaults only',
   reset.target===70 && reset.other===100, `target ${reset.target}, other ${reset.other}`);

if (errs.length) fails.push(...errs);
console.log(errs.length ? '\nconsole errors: ' + errs.join(' | ') : '\nno console errors');
console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASS');
await b.close();
process.exit(fails.length ? 1 : 0);
