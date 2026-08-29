/* Per-course Course Simulator memory — the eight tests from the spec.
   node sim.check.mjs   → exits non-zero on any failure. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await b.newPage();
const fails = [], errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (t, c, extra='') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${t}${extra ? ' — ' + extra : ''}`); if (!c) fails.push(t); };

await p.goto('file://' + process.cwd() + '/ucc_budget_simulator.html');
await p.evaluate(() => localStorage.setItem('ucc_unlocked', 'ucc2026'));
await p.reload(); await p.waitForTimeout(400);

// drive the real UI path: the course dropdown + input handlers
const pick = i => p.evaluate(i => { ST.module='simulator'; ST.tab='overview'; render();
  const s=document.getElementById('coursesel'); s.value=String(i);
  s.dispatchEvent(new Event('change',{bubbles:true})); }, i);
const setSim = o => p.evaluate(o => { Object.assign(ST, o); saveToStorage(); render(); }, o);
const setOh  = (idx, v) => p.evaluate(([idx,v]) => { ST.oh[idx].cost=v; saveToStorage(); render(); }, [idx,v]);
const read   = () => p.evaluate(() => ({ ci:ST.ci, agent:ST.agent, tf:ST.tf, plan:ST.plan,
  act:ST.act, aAgent:ST.aAgent, oh0:ST.oh[0].cost, oh5:ST.oh[5].cost }));

// ── Test 1: basic isolation ────────────────────────────────────────────────
await pick(0); await setSim({ agent:40, tf:70, plan:9 });
await pick(1); await setSim({ agent:15, tf:100, plan:20 });
await pick(0); const a1 = await read();
await pick(1); const b1 = await read();
await pick(0); const a2 = await read();
await pick(1); const b2 = await read();
ok('Test 1  A keeps 40/70/9 across A→B→A→B',
   a1.agent===40&&a1.tf===70&&a1.plan===9 && a2.agent===40&&a2.tf===70&&a2.plan===9,
   `A=${a1.agent}/${a1.tf}/${a1.plan} then ${a2.agent}/${a2.tf}/${a2.plan}`);
ok('Test 1  B keeps 15/100/20 across A→B→A→B',
   b1.agent===15&&b1.tf===100&&b1.plan===20 && b2.agent===15&&b2.tf===100&&b2.plan===20,
   `B=${b1.agent}/${b1.tf}/${b1.plan} then ${b2.agent}/${b2.tf}/${b2.plan}`);

// ── Test 2: fixed overhead isolation ───────────────────────────────────────
await pick(0); await setOh(0, 2000); await setOh(5, 100);
await pick(1); await setOh(0, 5000); await setOh(5, 300);
await pick(0); const ao = await read();
await pick(1); const bo = await read();
await pick(0); const ao2 = await read();
ok('Test 2  overhead isolated per course',
   ao.oh0===2000&&ao.oh5===100 && bo.oh0===5000&&bo.oh5===300 && ao2.oh0===2000&&ao2.oh5===100,
   `A=${ao2.oh0}/${ao2.oh5}  B=${bo.oh0}/${bo.oh5}`);

// ── Test 3: actual performance isolation ───────────────────────────────────
await pick(0); await setSim({ act:33, aAgent:11 });
await pick(1); await setSim({ act:77, aAgent:44 });
await pick(0); const aa = await read();
await pick(1); const ba = await read();
ok('Test 3  actual performance isolated', aa.act===33&&aa.aAgent===11&&ba.act===77&&ba.aAgent===44,
   `A act=${aa.act}/${aa.aAgent}  B act=${ba.act}/${ba.aAgent}`);

// ── Test 4: untouched course uses its own defaults ─────────────────────────
await pick(9); const fresh = await read();
ok('Test 4  first-time course loads defaults, not the previous course',
   fresh.agent===40 && fresh.tf===70 && fresh.plan===9 && fresh.oh0===2000,
   `agent=${fresh.agent} tf=${fresh.tf} plan=${fresh.plan}`);

// ── Test 6: calculations follow the selected course ────────────────────────
const calcAt = i => p.evaluate(i => { const s=document.getElementById('coursesel');
  s.value=String(i); s.dispatchEvent(new Event('change',{bubbles:true}));
  const r=calc(ST); return { be:r.beStu, cost:Math.round(r.totalCost), tf:ST.tf, agent:ST.agent }; }, i);
const c0 = await calcAt(0), c1 = await calcAt(1), c0b = await calcAt(0);
ok('Test 6  calculations use the selected course only',
   c0.tf===70&&c1.tf===100 && c0.cost!==c1.cost && c0.cost===c0b.cost && c0.be===c0b.be,
   `A cost=${c0.cost} be=${c0.be} | B cost=${c1.cost} be=${c1.be}`);

// ── Test 8: export / import round trip ─────────────────────────────────────
const exported = await p.evaluate(() => { simSaveCurrent(ST);
  return JSON.stringify({ sim: ST.sim, ci: ST.ci }); });
const imp = await p.evaluate(json => { const d=JSON.parse(json);
  ST.sim = {}; simLoad(ST, ST.ci);                       // wipe memory
  ST.sim = { ...ST.sim, ...d.sim }; simLoad(ST, ST.ci);  // re-import
  const g = i => { const k=COURSES[i].name; return ST.sim[k]; };
  return { a:g(0), b:g(1) }; }, exported);
ok('Test 8  export/import keeps values on their own course',
   imp.a && imp.b && imp.a.agent===40 && imp.b.agent===15 && imp.a.tf===70 && imp.b.tf===100,
   `A agent=${imp.a&&imp.a.agent} B agent=${imp.b&&imp.b.agent}`);

// ── Test 7: cloud-save snapshot round trip ─────────────────────────────────
const snap = await p.evaluate(() => JSON.stringify(buildFullSnapshot()));
await p.evaluate(() => { const s=document.getElementById('coursesel');
  s.value='1'; s.dispatchEvent(new Event('change',{bubbles:true}));
  ST.agent=99; ST.tf=999; saveToStorage(); });
const restored = await p.evaluate(json => { applyFullSnapshot(JSON.parse(json)); saveToStorage();
  const g=i=>ST.sim[COURSES[i].name]; return { a:g(0), b:g(1) }; }, snap);
ok('Test 7  cloud snapshot restores each course, unrelated memory intact',
   restored.a.agent===40 && restored.b.agent===15 && restored.b.tf===100,
   `A agent=${restored.a.agent}  B agent=${restored.b.agent}/${restored.b.tf}`);

// ── Test 5: survives reload ────────────────────────────────────────────────
await p.reload(); await p.waitForTimeout(500);
const after = await p.evaluate(() => { const g=i=>ST.sim[COURSES[i].name];
  return { a:g(0), b:g(1), ci:ST.ci, agent:ST.agent, tf:ST.tf }; });
ok('Test 5  per-course memory survives reload',
   after.a && after.b && after.a.agent===40 && after.a.tf===70 && after.b.agent===15 && after.b.tf===100,
   `A=${after.a&&after.a.agent}/${after.a&&after.a.tf}  B=${after.b&&after.b.agent}/${after.b&&after.b.tf}`);
ok('Test 5  working copy matches the restored selected course',
   after.agent===(after.ci===0?40:after.ci===1?15:after.agent),
   `ci=${after.ci} agent=${after.agent}`);

// ── legacy migration: one global state must not spread to every course ─────
const legacy = await p.evaluate(() => {
  localStorage.setItem(LS_KEY, JSON.stringify({ ci:3, agent:77, tf:123, plan:5,
    oh:INIT_OH.map(o=>({...o})) }));                      // pre-per-course save shape
  return true; });
await p.reload(); await p.waitForTimeout(500);
const mig = await p.evaluate(() => ({ keys:Object.keys(ST.sim||{}), ci:ST.ci,
  target:(ST.sim||{})[COURSES[3].name], other:(ST.sim||{})[COURSES[0].name] }));
ok('Legacy  single global state attaches to its own course only',
   mig.keys.length===1 && mig.target && mig.target.agent===77 && !mig.other,
   `keys=${mig.keys.length} target agent=${mig.target&&mig.target.agent}`);

if (errs.length) fails.push(...errs);
console.log(errs.length ? '\nconsole errors: ' + errs.join(' | ') : '\nno console errors');
console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASS');
await b.close();
process.exit(fails.length ? 1 : 0);
